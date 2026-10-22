import { test } from "node:test";
import assert from "node:assert/strict";
import { historyPath, parseClosedPositions, parseFills, validHistoryDates, type HistoryFilters } from "../src/features/trading/api/history";

const filters: HistoryFilters = { symbolId: "", side: "", action: "", type: "", status: "", from: "", before: "" };
const when = "2026-10-22T01:02:03Z";
const fill = { fillId: 53, orderId: 42, positionId: 17, lifecyclePositionId: 16, tradingSymbolId: 1,
  type: "MARKET", action: "CLOSE", side: "LONG", leverage: 100, quantity: "0.00000001", price: "123456.123456789012345678",
  realizedPnl: "-1.123456789012345678", fee: "0.000000000000000001", settlementAdjustment: "0", marginMode: "ISOLATED",
  priceEventTime: when, executedAt: when };
const closed = { positionId: 16, tradingSymbolId: 1, side: "LONG", status: "CLOSED", initialQuantity: "0.00500000",
  entryPrice: "100000.00", exitPrice: "101000.00", leverage: 100, initialMargin: "5.00", realizedPnl: "5.00",
  feesPaid: "0.20", settlementAdjustment: "0", netRealizedPnl: "4.80", openedMarginMode: "ISOLATED", closingMarginMode: "ISOLATED",
  openedAt: when, closedAt: when };

test("immutable fills keep ledger decimal strings and lifecycle link", () => {
  assert.deepEqual(parseFills([]), []);
  assert.deepEqual(parseFills([fill])[0], fill);
  const first = parseFills(Array.from({ length: 50 }, (_, index) => ({ ...fill, fillId: 100 - index })));
  const second = parseFills(Array.from({ length: 50 }, (_, index) => ({ ...fill, fillId: 50 - index })), first.at(-1)!.fillId);
  assert.equal(new Set([...first, ...second].map(row => row.fillId)).size, 100);
  assert.throws(() => parseFills([fill, fill]));
  assert.throws(() => parseFills([fill], fill.fillId));
  for (const bad of [null, { items: [fill] }, [{ ...fill, fee: 0.1 }], [{ ...fill, lifecyclePositionId: null }], [{ ...fill, action: "UNKNOWN" }]]) {
    assert.throws(() => parseFills(bad));
  }
});
test("closed lifecycle page uses opaque nextCursor and server net PnL", () => {
  assert.deepEqual(parseClosedPositions({ items: [], nextCursor: null }), { items: [], nextCursor: null });
  const page = parseClosedPositions({ items: [closed], nextCursor: "opaque_01" });
  assert.equal(page.items[0].netRealizedPnl, "4.80");
  assert.equal(page.nextCursor, "opaque_01");
  assert.throws(() => parseClosedPositions({ items: [closed], nextCursor: "opaque_01" }, "opaque_01"));
  for (const bad of [[closed], { items: [closed] }, { items: [{ ...closed, netRealizedPnl: 4.8 }], nextCursor: null }, { items: [closed], nextCursor: 3 }]) {
    assert.throws(() => parseClosedPositions(bad));
  }
});
test("history paths preserve filters and cursor form per endpoint", () => {
  const selected = { ...filters, symbolId: "1", side: "LONG", action: "CLOSE", type: "MARKET", status: "FILLED", from: "2026-10-22T10:00", before: "2026-10-23T10:00" };
  const order = new URL(historyPath("orders", selected, 52), "https://example.test/");
  assert.equal(order.pathname, "/account/orders");
  assert.equal(order.searchParams.get("beforeId"), "52");
  assert.equal(order.searchParams.get("status"), "FILLED");
  assert.equal(order.searchParams.has("executedFrom"), false);
  const fills = new URL(historyPath("fills", selected, 53), "https://example.test/");
  assert.equal(fills.pathname, "/account/fills");
  assert.equal(fills.searchParams.get("executedFrom"), new Date(selected.from).toISOString());
  assert.equal(fills.searchParams.has("status"), false);
  const positions = new URL(historyPath("closed", { ...selected, status: "CLOSED" }, "abc+/="), "https://example.test/");
  assert.equal(positions.pathname, "/account/positions/history");
  assert.equal(positions.searchParams.get("cursor"), "abc+/=");
  assert.equal(positions.searchParams.get("closedBefore"), new Date(selected.before).toISOString());
  assert.equal(positions.searchParams.has("action"), false);
  assert.throws(() => historyPath("closed", { ...filters, status: "FILLED" }));
  assert.throws(() => historyPath("orders", filters, 0));
  assert.equal(validHistoryDates("closed", { ...filters, from: "2026-10-23T10:00", before: "2026-10-22T10:00" }), false);
  assert.throws(() => historyPath("fills", { ...filters, from: "invalid" }));
});
