import { decimal, id, instant, invalidContract, list, nullable, record, text } from "./contracts";

function parseFill(value: unknown) {
  const row = record(value);
  return { fillId: id(row.fillId), quantity: decimal(row.quantity), price: decimal(row.price),
    priceEventTime: instant(row.priceEventTime), executedAt: instant(row.executedAt), realizedPnl: decimal(row.realizedPnl) };
}
export function parseOrder(value: unknown) {
  const row = record(value);
  if (!["MARKET", "LIMIT"].includes(text(row.type)) || !["OPEN", "CLOSE", "LIQUIDATE"].includes(text(row.action))
    || !["LONG", "SHORT"].includes(text(row.side)) || !["PENDING", "FILLED", "CANCELED", "REJECTED"].includes(text(row.status))) return invalidContract();
  return { orderId: id(row.orderId), positionId: nullable(row.positionId, id), tradingSymbolId: id(row.tradingSymbolId),
    type: text(row.type), action: text(row.action), side: text(row.side), status: text(row.status), quantity: decimal(row.quantity),
    leverage: id(row.leverage), limitPrice: nullable(row.limitPrice, decimal), reservedMargin: decimal(row.reservedMargin),
    reservedCloseQuantity: decimal(row.reservedCloseQuantity), createdAt: instant(row.createdAt),
    completedAt: nullable(row.completedAt, instant), reason: nullable(row.reason, text), fill: nullable(row.fill, parseFill) };
}
export type TradingOrder = ReturnType<typeof parseOrder>;
export function parseOrders(value: unknown) { return list(value, parseOrder); }
