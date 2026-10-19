import { decimal, id, instant, invalidContract, list, nullable, record, text } from "./contracts";
import type { TradingSymbol } from "../market/catalog";

export function parsePosition(value: unknown) {
  const row = record(value);
  if (row.side !== "LONG" && row.side !== "SHORT") return invalidContract();
  return {
    id: id(row.id), tradingSymbolId: id(row.tradingSymbolId), side: row.side,
    quantity: decimal(row.quantity), reservedCloseQuantity: decimal(row.reservedCloseQuantity),
    freeCloseQuantity: decimal(row.freeCloseQuantity), entryPrice: decimal(row.entryPrice),
    leverage: id(row.leverage), margin: decimal(row.margin), status: text(row.status),
    realizedPnl: decimal(row.realizedPnl), markPrice: nullable(row.markPrice, decimal),
    unrealizedPnl: nullable(row.unrealizedPnl, decimal), priceStatus: text(row.priceStatus),
    priceEventTime: nullable(row.priceEventTime, instant), openedAt: instant(row.openedAt),
  };
}
export type Position = ReturnType<typeof parsePosition>;

export function parseSummary(value: unknown, accountId: number | null) {
  const row = record(value);
  if (id(row.accountId) !== accountId) return invalidContract();
  const wallet = record(row.wallet);
  if (wallet.quoteAsset !== "USDT") return invalidContract();
  const positions = list(row.positions, parsePosition);
  const sides = new Set<string>(), ids = new Set<number>();
  const leverages = new Map<number, number>();
  for (const position of positions) {
    const key = `${position.tradingSymbolId}:${position.side}`;
    if (position.status !== "OPEN" || position.leverage > 100 || sides.has(key) || ids.has(position.id)
      || (leverages.has(position.tradingSymbolId) && leverages.get(position.tradingSymbolId) !== position.leverage)) return invalidContract();
    sides.add(key); ids.add(position.id); leverages.set(position.tradingSymbolId, position.leverage);
  }
  return {
    accountId, status: text(row.status), createdAt: instant(row.createdAt), valuedAt: instant(row.valuedAt),
    wallet: {
      quoteAsset: "USDT", balance: decimal(wallet.balance), usedMargin: decimal(wallet.usedMargin),
      reservedMargin: decimal(wallet.reservedMargin), realizedPnl: decimal(wallet.realizedPnl),
      unrealizedPnl: nullable(wallet.unrealizedPnl, decimal), equity: nullable(wallet.equity, decimal),
      availableBalance: nullable(wallet.availableBalance, decimal), valuationStatus: text(wallet.valuationStatus),
    },
    positions,
  };
}

export function symbolLabel(id: number, symbols: readonly TradingSymbol[]) {
  return symbols.find((symbol) => symbol.id === id)?.displaySymbol ?? `종목 #${id}`;
}
export function portfolioPositions(positions: readonly Position[], symbols: readonly TradingSymbol[]) {
  return positions.map((position) => ({ symbol: symbolLabel(position.tradingSymbolId, symbols), margin: position.margin }));
}
// String formatting only: no floating-point rounding of financial values.
export function formatQuantity(value: string | null | undefined) {
  if (value == null) return "—";
  const [whole, fraction] = value.split(".");
  const significant = fraction?.replace(/0+$/, "");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(significant ?? "").padEnd(2, "0")}`;
}
// Display only. Round decimal strings to cents without changing server values or inputs.
export function formatDecimal(value: string | null | undefined) {
  if (value == null || !/^-?\d+(\.\d+)?$/.test(value)) return "—";
  const negative=value.startsWith("-"), [whole,fraction=""]=value.replace(/^-/,'').split('.');
  let cents=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0').slice(0,2));
  if (fraction.charAt(2)>='5') cents+=BigInt(1);
  const digits=cents.toString().padStart(3,'0');
  return `${negative && cents>BigInt(0) ? '-' : ''}${digits.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,",")}.${digits.slice(-2)}`;
}
export function pnlTrend(value: string | null) {
  if (value === null || !/[1-9]/.test(value)) return undefined;
  return value.startsWith("-") ? "down" : "up";
}
