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
  return {
    accountId, status: text(row.status), createdAt: instant(row.createdAt), valuedAt: instant(row.valuedAt),
    wallet: {
      quoteAsset: "USDT", balance: decimal(wallet.balance), usedMargin: decimal(wallet.usedMargin),
      reservedMargin: decimal(wallet.reservedMargin), realizedPnl: decimal(wallet.realizedPnl),
      unrealizedPnl: nullable(wallet.unrealizedPnl, decimal), equity: nullable(wallet.equity, decimal),
      availableBalance: nullable(wallet.availableBalance, decimal), valuationStatus: text(wallet.valuationStatus),
    },
    positions: list(row.positions, parsePosition),
  };
}

export function symbolLabel(id: number, symbols: readonly TradingSymbol[]) {
  return symbols.find((symbol) => symbol.id === id)?.displaySymbol ?? `종목 #${id}`;
}
export function portfolioPositions(positions: readonly Position[], symbols: readonly TradingSymbol[]) {
  return positions.map((position) => ({ symbol: symbolLabel(position.tradingSymbolId, symbols), margin: position.margin }));
}
// String formatting only: no floating-point rounding of financial values.
export function formatDecimal(value: string | null | undefined) {
  if (value == null) return "—";
  const [whole, fraction] = value.split(".");
  const significant = fraction?.replace(/0+$/, "");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(significant ?? "").padEnd(2, "0")}`;
}
export function pnlTrend(value: string | null) {
  if (value === null || !/[1-9]/.test(value)) return undefined;
  return value.startsWith("-") ? "down" : "up";
}
