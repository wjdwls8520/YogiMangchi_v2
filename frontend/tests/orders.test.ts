import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrders, orderStatusLabel } from "../src/features/trading/api/orders";

test("order status distinguishes acceptance from execution and never renders an unknown server status", () => {
  assert.equal(orderStatusLabel("PENDING"), "접수 · 체결 대기");
  assert.equal(orderStatusLabel("FILLED"), "체결 완료");
  assert.equal(orderStatusLabel("CANCELED"), "취소 완료");
  assert.equal(orderStatusLabel("REJECTED"), "거절");
  assert.equal(orderStatusLabel("internal details"), "상태 확인 필요");
});

const pending = { orderId: 3, positionId: null, tradingSymbolId: 927, type: "LIMIT", action: "OPEN", side: "LONG", status: "PENDING",
  quantity: "0.25000000", leverage: 10, requestedLeverage: 10, feeRate:"0.0005",reservedFee:"0", limitPrice: "63500.000000000000000001", reservedMargin: "1587.500000000000000000", reservedCloseQuantity: "0.00000000",
  createdAt: "2026-10-13T00:00:00Z", completedAt: null, reason: null, fill: null };

test("orders preserve decimal and nullable pending fields, accepting empty results", () => {
  assert.deepEqual(parseOrders([]), []);
  assert.equal(parseOrders([pending])[0].limitPrice, pending.limitPrice);
  assert.equal(parseOrders([pending])[0].fill, null);
  const close = parseOrders([{ ...pending, positionId: 4, action: "CLOSE", reservedCloseQuantity: "0.25000000", reservedMargin: "0" }])[0];
  assert.equal(close.action, "CLOSE"); assert.equal(close.reservedCloseQuantity, "0.25000000");
});
test("filled history uses the server fill price, including liquidation", () => {
  const fill = { fee:"0",settlementAdjustment:"0",marginMode:"ISOLATED",fillId: 5, quantity: "0.25", price: "63510.000000000000000001", priceEventTime: pending.createdAt, executedAt: pending.createdAt, realizedPnl: "-12.250000000000000001" };
  const order = parseOrders([{ ...pending, type: "MARKET", action: "LIQUIDATE", positionId: 4, status: "FILLED", limitPrice: null, completedAt: pending.createdAt, fill }])[0];
  assert.equal(order.fill?.price, fill.price);
  assert.equal(order.fill?.realizedPnl, fill.realizedPnl);
});
test("invalid order shapes fail closed without fabricating history", () => {
  for (const value of [{ data: [] }, [{ ...pending, quantity: 0.25 }], [{ ...pending, status: "UNKNOWN" }], [{ ...pending, fill: {} }], [{ ...pending, orderId: 0 }]]) assert.throws(() => parseOrders(value));
});
