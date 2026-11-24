import { id, instant, invalidContract, list, nullable, record, text } from "./contracts";
import { count } from "./recovery-contract";

// Fill price × quantity aggregates can have more than 18 fractional digits.
// Keep the server string intact; this wider bound applies only to aggregate amounts.
function decimal(value: unknown): string {
  if (typeof value !== "string" || !/^-?\d{1,60}(\.\d{1,36})?$/.test(value)) return invalidContract();
  return value;
}

export type PerformanceFilters = { from?: string; before?: string; roundId?: number; tradingSymbolId?: number };
export function performancePath(filters: PerformanceFilters): `account/performance/symbols?${string}` {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", instant(filters.from));
  if (filters.before) params.set("before", instant(filters.before));
  if (filters.from && filters.before && Date.parse(filters.from) >= Date.parse(filters.before)) return invalidContract();
  if (filters.roundId !== undefined) params.set("roundId", String(id(filters.roundId)));
  if (filters.tradingSymbolId !== undefined) params.set("tradingSymbolId", String(id(filters.tradingSymbolId)));
  return `account/performance/symbols?${params}`;
}
function totals(value: unknown) {
  const row = record(value);
  return { fillCount: count(row.fillCount), turnover: decimal(row.turnover), grossRealizedPnl: decimal(row.grossRealizedPnl),
    fees: decimal(row.fees), settlementAdjustment: decimal(row.settlementAdjustment),
    economicTradingPnl: decimal(row.economicTradingPnl), cashTradingPnl: decimal(row.cashTradingPnl) };
}
export function parsePerformance(value: unknown, filters: PerformanceFilters) {
  const row = record(value), scope = record(row.scope), ids = new Set<number>();
  const roundId = nullable(scope.roundId, id), tradingSymbolId = nullable(scope.tradingSymbolId, id);
  const fromInclusive = instant(scope.fromInclusive), beforeExclusive = instant(scope.beforeExclusive);
  if (roundId !== (filters.roundId ?? null) || tradingSymbolId !== (filters.tradingSymbolId ?? null)
    || Date.parse(fromInclusive) >= Date.parse(beforeExclusive)
    || filters.from && Date.parse(filters.from) !== Date.parse(fromInclusive)
    || filters.before && Date.parse(filters.before) !== Date.parse(beforeExclusive)) return invalidContract();
  const symbols = list(row.symbols, value => {
    const item = record(value), symbolId = id(item.tradingSymbolId);
    if (ids.has(symbolId) || tradingSymbolId !== null && symbolId !== tradingSymbolId || item.quoteAsset !== "USDT") return invalidContract();
    ids.add(symbolId);
    const symbol = text(item.symbol);
    if (!/^[A-Z0-9]{1,30}$/.test(symbol)) return invalidContract();
    const valuationStatus = text(item.valuationStatus);
    if (!["FRESH", "STALE", "MISSING", "UNAVAILABLE", "NO_OPEN_EXPOSURE"].includes(valuationStatus)) return invalidContract();
    const currentUnrealizedPnl = nullable(item.currentUnrealizedPnl, decimal);
    if (!["FRESH", "NO_OPEN_EXPOSURE"].includes(valuationStatus) && currentUnrealizedPnl !== null) return invalidContract();
    return { ...totals(item), tradingSymbolId: symbolId, symbol, turnoverSharePercent: decimal(item.turnoverSharePercent),
      currentUnrealizedPnl, valuationStatus, priceEventTime: nullable(item.priceEventTime, instant),
      priceReceivedAt: nullable(item.priceReceivedAt, instant), valuedAt: instant(item.valuedAt) };
  });
  const roundReturn = nullable(row.roundReturn, value => {
    if (!filters.roundId || filters.from || filters.before || filters.tradingSymbolId) return invalidContract();
    const item = record(value), status = text(item.status);
    if (!["CURRENT", "FINAL", "LEGACY_UNVERIFIED", "PRICE_UNAVAILABLE"].includes(status)) return invalidContract();
    const returnPercent = nullable(item.returnPercent, decimal);
    if (!["CURRENT", "FINAL"].includes(status) && returnPercent !== null) return invalidContract();
    return { status, initialCapital: nullable(item.initialCapital, decimal), capitalAdjustment: nullable(item.capitalAdjustment, decimal),
      cashPerformance: nullable(item.cashPerformance, decimal), returnPercent, valuedAt: instant(item.valuedAt) };
  });
  return { scope: { fromInclusive, beforeExclusive, roundId, tradingSymbolId }, totals: totals(row.totals), symbols,
    capitalAdjustment: decimal(row.capitalAdjustment), roundReturn, capturedAt: instant(row.capturedAt) };
}
