import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrders } from "../src/features/trading/api/orders";

const pending = { orderId: 3, positionId: null, tradingSymbolId: 927, type: "LIMIT", action: "OPEN", side: "LONG", status: "PENDING",
  quantity: "0.25000000", leverage: 10, limitPrice: "63500.000000000000000001", reservedMargin: "1587.500000000000000000", reservedCloseQuantity: "0.00000000",
  createdAt: "2026-10-13T00:00:00Z", completedAt: null, reason: null, fill: null };

test("orders preserve decimal and nullable pending fields, accepting empty results", () => {
  assert.deepEqual(parseOrders([]), []);
  assert.equal(parseOrders([pending])[0].limitPrice, pending.limitPrice);
  assert.equal(parseOrders([pending])[0].fill, null);
  const close = parseOrders([{ ...pending, positionId: 4, action: "CLOSE", reservedCloseQuantity: "0.25000000", reservedMargin: "0" }])[0];
  assert.equal(close.action, "CLOSE"); assert.equal(close.reservedCloseQuantity, "0.25000000");
});
test("filled history uses the server fill price, including liquidation", () => {
  const fill = { fillId: 5, quantity: "0.25", price: "63510.000000000000000001", priceEventTime: pending.createdAt, executedAt: pending.createdAt, realizedPnl: "-12.250000000000000001" };
  const order = parseOrders([{ ...pending, type: "MARKET", action: "LIQUIDATE", positionId: 4, status: "FILLED", limitPrice: null, completedAt: pending.createdAt, fill }])[0];
  assert.equal(order.fill?.price, fill.price);
  assert.equal(order.fill?.realizedPnl, fill.realizedPnl);
});
test("invalid order shapes fail closed without fabricating history", () => {
  for (const value of [{ data: [] }, [{ ...pending, quantity: 0.25 }], [{ ...pending, status: "UNKNOWN" }], [{ ...pending, fill: {} }], [{ ...pending, orderId: 0 }]]) assert.throws(() => parseOrders(value));
});
