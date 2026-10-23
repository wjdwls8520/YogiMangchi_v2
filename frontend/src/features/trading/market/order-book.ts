import { comparePrices } from "./price-format";

export type BookLevel = { price: string; quantity: string };
export type OrderBook = { symbolId: number | null; status: "FRESH" | "STALE" | "UNAVAILABLE";
  bids: readonly BookLevel[]; asks: readonly BookLevel[]; eventTime: number | null; receivedAt: number | null; expiresAt?: number };
export const emptyOrderBook = (symbolId: number | null, status: "STALE" | "UNAVAILABLE" = "UNAVAILABLE"): OrderBook =>
  ({ symbolId, status, bids: [], asks: [], eventTime: null, receivedAt: null });
export function selectedOrderBook(book: OrderBook, symbolId: number | null) {
  return book.symbolId === symbolId ? book : emptyOrderBook(symbolId);
}
export function freshOrderBook(book: OrderBook, now = Date.now()) {
  return book.status === "FRESH" && (book.expiresAt === undefined || book.expiresAt > now) ? book : emptyOrderBook(book.symbolId, "STALE");
}
function levels(value: unknown, ascending: boolean): BookLevel[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 20) return null;
  const rows: BookLevel[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { price, quantity } = item;
    for (const decimal of [price, quantity]) {
      if (typeof decimal !== "string" || decimal.length > 120 || !/^\d+(\.\d+)?$/.test(decimal) || comparePrices(decimal, "0") <= 0) return null;
    }
    if (rows.length && (ascending ? comparePrices(price, rows[rows.length-1].price) <= 0 : comparePrices(price, rows[rows.length-1].price) >= 0)) return null;
    rows.push({ price, quantity });
  }
  return rows;
}
// Complete, display-only snapshots. No historical book or liquidity is accumulated.
export function parseOrderBook(input: Record<string, unknown>, symbolId: number, now: number): OrderBook {
  if (input.status !== "FRESH") return emptyOrderBook(symbolId, input.status === "STALE" ? "STALE" : "UNAVAILABLE");
  const instant = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) ? Date.parse(value) : NaN;
  const eventTime = instant(input.eventTime), receivedAt = instant(input.receivedAt);
  const bids = levels(input.bids, false), asks = levels(input.asks, true);
  if (!bids || !asks || !Number.isFinite(eventTime) || !Number.isFinite(receivedAt)
    || receivedAt <= now-3000 || receivedAt > now+1000 || eventTime < receivedAt-3000 || eventTime > receivedAt+10_000
    || comparePrices(bids[0].price, asks[0].price) >= 0) return emptyOrderBook(symbolId);
  return { symbolId, status: "FRESH", bids, asks, eventTime, receivedAt };
}
