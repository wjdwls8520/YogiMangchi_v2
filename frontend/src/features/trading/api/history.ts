import { decimal, id, instant, invalidContract, list, nullable, record, text } from "./contracts";
import { parseOrders } from "./orders";

export type HistoryKind = "orders" | "fills" | "closed";
export type HistoryFilters = { symbolId: string; side: string; action: string; type: string; status: string; from: string; before: string };
export const HISTORY_LIMIT = 50;
export function validHistoryDates(kind: HistoryKind, filters: HistoryFilters) {
  if (kind === "orders") return true;
  const from = filters.from ? Date.parse(filters.from) : undefined;
  const before = filters.before ? Date.parse(filters.before) : undefined;
  return (from === undefined || Number.isFinite(from) && from >= 0)
    && (before === undefined || Number.isFinite(before) && before >= 0)
    && (from === undefined || before === undefined || from < before);
}

function choice(value: unknown, choices: readonly string[]) {
  const parsed = text(value);
  return choices.includes(parsed) ? parsed : invalidContract();
}
function validateIds(ids: readonly number[], before?: number | string) {
  if (ids.length > HISTORY_LIMIT || ids.some((value, index) => index > 0 && value >= ids[index - 1]
    || before !== undefined && (typeof before !== "number" || value >= before))) return invalidContract();
}
export function parseOrderHistory(value: unknown, before?: number | string) {
  const orders = parseOrders(value);
  validateIds(orders.map(order => order.orderId), before);
  return orders;
}
export function parseFills(value: unknown, before?: number | string) {
  const fills = list(value, item => {
    const row = record(item);
    return { fillId: id(row.fillId), orderId: id(row.orderId), positionId: id(row.positionId), lifecyclePositionId: id(row.lifecyclePositionId),
      tradingSymbolId: id(row.tradingSymbolId), type: choice(row.type, ["MARKET", "LIMIT"]),
      action: choice(row.action, ["OPEN", "CLOSE", "LIQUIDATE"]), side: choice(row.side, ["LONG", "SHORT"]),
      leverage: id(row.leverage), quantity: decimal(row.quantity), price: decimal(row.price),
      realizedPnl: decimal(row.realizedPnl), fee: decimal(row.fee), settlementAdjustment: decimal(row.settlementAdjustment),
      marginMode: choice(row.marginMode, ["ISOLATED", "CROSS"]), priceEventTime: instant(row.priceEventTime), executedAt: instant(row.executedAt) };
  });
  validateIds(fills.map(fill => fill.fillId), before);
  return fills;
}
export function parseClosedPositions(value: unknown, previous?: number | string) {
  const page = record(value);
  const items = list(page.items, item => {
    const row = record(item);
    return { positionId: id(row.positionId), tradingSymbolId: id(row.tradingSymbolId), side: choice(row.side, ["LONG", "SHORT"]),
      status: choice(row.status, ["CLOSED", "LIQUIDATED"]), initialQuantity: decimal(row.initialQuantity),
      entryPrice: decimal(row.entryPrice), exitPrice: decimal(row.exitPrice), leverage: id(row.leverage),
      initialMargin: decimal(row.initialMargin), realizedPnl: decimal(row.realizedPnl), feesPaid: decimal(row.feesPaid),
      settlementAdjustment: decimal(row.settlementAdjustment), netRealizedPnl: decimal(row.netRealizedPnl),
      openedMarginMode: choice(row.openedMarginMode, ["ISOLATED", "CROSS"]), closingMarginMode: choice(row.closingMarginMode, ["ISOLATED", "CROSS"]),
      openedAt: instant(row.openedAt), closedAt: instant(row.closedAt) };
  });
  if (items.length > HISTORY_LIMIT || new Set(items.map(item => item.positionId)).size !== items.length) return invalidContract();
  const nextCursor = nullable(page.nextCursor, text);
  if (nextCursor !== null && (nextCursor === previous || !items.length)) return invalidContract();
  return { items, nextCursor };
}
export type FillHistory = ReturnType<typeof parseFills>[number];
export type ClosedPositionHistory = ReturnType<typeof parseClosedPositions>["items"][number];

function iso(value: string) {
  const time = new Date(value);
  if (!Number.isFinite(time.valueOf())) return invalidContract();
  return time.toISOString();
}
export function historyPath(kind: HistoryKind, filters: HistoryFilters, cursor?: number | string) {
  if (!validHistoryDates(kind, filters)) return invalidContract();
  const path = kind === "orders" ? "account/orders" : kind === "fills" ? "account/fills" : "account/positions/history";
  const params = new URLSearchParams({ limit: String(HISTORY_LIMIT) });
  if (filters.symbolId) params.set("tradingSymbolId", String(id(Number(filters.symbolId))));
  if (filters.side) params.set("side", choice(filters.side, ["LONG", "SHORT"]));
  if (kind !== "closed") {
    if (filters.action) params.set("action", choice(filters.action, ["OPEN", "CLOSE", "LIQUIDATE"]));
    if (filters.type) params.set("type", choice(filters.type, ["MARKET", "LIMIT"]));
  }
  if (kind !== "fills" && filters.status) params.set("status", choice(filters.status, kind === "closed" ? ["CLOSED", "LIQUIDATED"] : ["PENDING", "FILLED", "CANCELED", "REJECTED"]));
  if (kind !== "orders") {
    if (filters.from) params.set(kind === "fills" ? "executedFrom" : "closedFrom", iso(filters.from));
    if (filters.before) params.set(kind === "fills" ? "executedBefore" : "closedBefore", iso(filters.before));
  }
  if (cursor !== undefined) params.set(kind === "closed" ? "cursor" : "beforeId", kind === "closed" ? text(cursor) : String(id(cursor)));
  return `${path}?${params}` as const;
}
