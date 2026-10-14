import { test } from "node:test";
import assert from "node:assert/strict";
import { createTradingIntent, mutationMessage, mutationRequest, type TradingCommand } from "../src/features/trading/api/mutation-request";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { TradingApiError } from "../src/features/trading/api/client";
import { estimatedOrder, ratioQuantity, validQuantity, validLimitPrice } from "../src/features/trading/api/order-input";
import { parseOrder } from "../src/features/trading/api/orders";

const snapshot = { phase: "ready" as const, accountId: 7, generation: 1 };
const command: TradingCommand = { kind: "open", type: "MARKET", side: "LONG", tradingSymbolId: 927, quantity: "0.00100000", leverage: 10 };
const response = { orderId: 3, positionId: 4, tradingSymbolId: 927, type: "MARKET", action: "OPEN", side: "LONG", status: "FILLED", quantity: "0.00100000", leverage: 10, limitPrice: null, reservedMargin: "0", reservedCloseQuantity: "0", createdAt: "2026-10-13T00:00:00Z", completedAt: "2026-10-13T00:00:00Z", reason: null, fill: { fillId: 5, quantity: "0.00100000", price: "64000.000000000000000001", priceEventTime: "2026-10-13T00:00:00Z", executedAt: "2026-10-13T00:00:00Z", realizedPnl: "0" } };

test("mutation payloads match OPEN, CLOSE, LIMIT CLOSE and CANCEL without client execution prices", () => {
  assert.deepEqual(mutationRequest({ ...command, limitPrice: "wrong-unused-value" }), { path: "account/orders", body: { type: "MARKET", side: "LONG", tradingSymbolId: 927, quantity: "0.00100000", leverage: 10 }, keyed: true });
  const limit = mutationRequest({ ...command, type: "LIMIT", limitPrice: "63000.000000000000000001" });
  assert.equal(limit.body?.limitPrice, "63000.000000000000000001");
  assert.deepEqual(mutationRequest({ kind: "close", positionId: 4 }), { path: "account/positions/4/close", body: {}, keyed: true });
  assert.deepEqual(mutationRequest({ kind: "limitClose", positionId: 4, quantity: "0.0005", limitPrice: "65000" }), { path: "account/positions/4/close-orders", body: { quantity: "0.0005", limitPrice: "65000" }, keyed: true });
  assert.deepEqual(mutationRequest({ kind: "cancel", orderId: 3 }), { path: "account/orders/3/cancel", body: undefined, keyed: false });
});
test("input validation and estimates never round financial strings through Number", () => {
  for (const value of ["0", "-1", "NaN", "1e-8", "0.000000001", "1000000000001"]) assert.equal(validQuantity(value), false);
  assert.equal(validQuantity("0.00000001"), true);
  assert.equal(validLimitPrice("64000.000000000000000001"), true);
  assert.equal(validLimitPrice("0.0000000000000000001"), false);
  assert.deepEqual(estimatedOrder("1", "64000.000000000000000001", 1), { notional: "64000.000000000000000001", margin: "64000.000000000000000001" });
  assert.equal(ratioQuantity("10000", "64000", 10, 25), "0.390625");
  assert.equal(ratioQuantity("1", "3", 1, 100), "0.33333333");
  assert.equal(ratioQuantity(null, "3", 1, 100), "");
  assert.throws(() => mutationRequest({ ...command, leverage: 21 }));
  assert.throws(() => mutationRequest({ ...command, quantity: "0.000000001" }));
});
test("double clicks share one in-flight order and use one idempotency key", async () => {
  let finish!: (value: ReturnType<typeof parseOrder>) => void; let calls = 0;
  const intent = createTradingIntent(async (request) => { calls++; assert.equal(request.key, "order-key-0001"); return new Promise((resolve) => { finish = resolve; }); }, () => "order-key-0001");
  const first = intent.execute(command, snapshot); const second = intent.execute(command, snapshot);
  assert.equal(first, second); assert.equal(calls, 1);
  finish(parseOrder(response)); await first;
});
test("uncertain result has no automatic retry and explicit retry preserves key, payload and identity", async () => {
  const requests: { key: string; command: TradingCommand }[] = []; let keys = 0;
  const intent = createTradingIntent(async (request) => { requests.push(request); if (requests.length === 1) throw new TradingApiError(0); return parseOrder(response); }, () => `order-key-${++keys}`);
  await assert.rejects(intent.execute(command, snapshot)); assert.equal(requests.length, 1);
  await assert.rejects(intent.execute({ ...command, side: "SHORT" }, snapshot)); assert.equal(requests.length, 1);
  await intent.execute(command, snapshot);
  assert.equal(requests[0].key, requests[1].key); assert.deepEqual(requests[0].command, requests[1].command); assert.equal(keys, 1);
  await intent.execute(command, snapshot); assert.equal(keys, 2);
});
test("known business rejection permits a new intent without GET-style automatic retries", async () => {
  let keys = 0; let calls = 0;
  const intent = createTradingIntent(async () => { calls++; throw new TradingApiError(409, undefined, "INSUFFICIENT_MARGIN"); }, () => `order-key-${++keys}`);
  await assert.rejects(intent.execute(command, snapshot)); assert.equal(calls, 1);
  await assert.rejects(intent.execute(command, snapshot)); assert.equal(keys, 2);
  assert.equal(mutationMessage(new TradingApiError(409, "never use this server message", "INSUFFICIENT_MARGIN")), "사용 가능한 증거금이 부족합니다.");
});
test("authenticated writes keep Bearer private, send decimal strings and never recreate/replay on 401", async () => {
  const store = new Map<string, string>(); let creates = 0; let writes = 0;
  const token = `guest_${"x".repeat(43)}`;
  const session = createGuestSession("http://trade.example", () => ({ getItem: (key) => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); }, removeItem: (key) => { store.delete(key); } }), async (url, options) => {
    if (String(url).endsWith("accounts/guest")) { creates++; return new Response(JSON.stringify({ accountId: 7, status: "ACTIVE", quoteAsset: "USDT", initialBalance: "10000", accessToken: token, tokenType: "Bearer", expiresAt: "2099-01-01T00:00:00Z" })); }
    writes++; assert.equal(String(url).includes(token), false);
    assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    assert.equal((options?.headers as Record<string, string>)["Idempotency-Key"], "order-key-0001");
    assert.equal(JSON.parse(String(options?.body)).quantity, "0.00100000");
    return new Response(JSON.stringify({ detail: token }), { status: 401 });
  });
  await session.ensure();
  await assert.rejects(session.write(command, session.getSnapshot(), "order-key-0001"), (error: unknown) => error instanceof TradingApiError && !String(error).includes(token));
  assert.equal(creates, 1); assert.equal(writes, 1);
  await assert.rejects(session.write(command, { ...session.getSnapshot(), generation: 999 }, "order-key-0002")); assert.equal(writes, 1);
});
