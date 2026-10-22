import { test } from "node:test";
import assert from "node:assert/strict";
import { eventId, openTradingEvents, parseTradingEvent, parseTradingEvents, tradingEventNotice, type EventState, type TradingEvent } from "../src/features/trading/api/trading-events";
import { TradingApiError } from "../src/features/trading/api/client";

const at = "2026-10-22T00:00:00Z";
const order = { orderId: 3, positionId: null, tradingSymbolId: 1, type: "LIMIT", action: "OPEN", side: "LONG", status: "PENDING",
  quantity: "0.001", leverage: 100, requestedLeverage: 100, feeRate: "0.0003", reservedFee: "0.03", limitPrice: "100000", reservedMargin: "1", reservedCloseQuantity: "0",
  createdAt: at, completedAt: null, reason: null, fill: null };
const event = (eventId: string) => ({ eventId, type: "ORDER_PENDING", occurredAt: at, order });
class Socket {
  readyState = 0;
  onopen: WebSocket["onopen"] = null; onclose: WebSocket["onclose"] = null;
  onerror: WebSocket["onerror"] = null; onmessage: WebSocket["onmessage"] = null;
  sent: string[] = [];
  send(value: string | ArrayBufferLike | Blob | ArrayBufferView) { this.sent.push(String(value)); }
  close() { this.readyState = 3; }
  frame(type: string, data: unknown = {}) { this.readyState = 1; this.onmessage?.call(this as unknown as WebSocket, new MessageEvent("message", { data: JSON.stringify({ type, data }) })); }
  disconnect(code = 1006) { this.readyState = 3; this.onclose?.call(this as unknown as WebSocket, { code } as CloseEvent); }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness(read: (cursor: string, signal: AbortSignal) => Promise<unknown> = async () => []) {
  let now = 0, next = 0, current = true;
  const timers = new Map<number, { at: number; fn: () => void }>(), sockets: Socket[] = [];
  const states: EventState[] = [], delivered: TradingEvent[] = [], resumes: string[] = [];
  const clock = { now: () => now, socket: (url: string) => {
    assert.equal(url, "ws://localhost:8081/ws/trading"); const socket = new Socket(); sockets.push(socket); return socket;
  }, later: (fn: () => void, ms: number) => { const key = ++next; timers.set(key, { at: now + ms, fn }); return key as unknown as ReturnType<typeof setTimeout>; },
  cancel: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer as unknown as number); } };
  const stop = openTradingEvents({ url: "ws://localhost:8081/ws/trading", read, current: () => current,
    authenticate: (_socket, cursor) => { resumes.push(cursor); }, onEvent: value => delivered.push(value), onState: value => states.push(value), onReady: () => {} }, clock);
  return { stop, timers, sockets, states, delivered, resumes, changeAccount: () => { current = false; },
    handshake: (socket = sockets.at(-1)!) => { socket.frame("CONNECTED"); socket.frame("AUTHENTICATED", { afterEventId: resumes.at(-1), expiresAt: at }); },
    advance: async (ms: number) => {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
      }
      now = until;
    } };
}

test("silent REST baseline pages into exact Long string cursor, WS ignores duplicate/reverse replay and resumes after disconnect", async () => {
  const reads: string[] = [];
  const h = harness(async cursor => {
    reads.push(cursor);
    return cursor === "0" ? Array.from({ length: 100 }, (_, i) => event(String(i + 1))) : [event("9007199254740993")];
  });
  await flush(); h.handshake();
  assert.deepEqual(reads, ["0", "100"]); assert.deepEqual(h.resumes, ["9007199254740993"]); assert.equal(h.delivered.length, 0);
  const socket = h.sockets[0];
  socket.frame("TRADING_EVENT", event("9007199254740993")); socket.frame("TRADING_EVENT", event("9007199254740994")); socket.frame("TRADING_EVENT", event("3"));
  assert.deepEqual(h.delivered.map(value => value.eventId), ["9007199254740994"]);
  socket.disconnect(); await h.advance(1000); h.handshake();
  assert.equal(h.resumes.at(-1), "9007199254740994"); assert.equal(reads.length, 2);
  h.sockets[1].frame("TRADING_EVENT", event("9007199254740995"));
  assert.equal(h.delivered.length, 2); h.stop(); assert.equal(h.timers.size, 0);
});
test("initial replay errors retry with a bounded backoff, auth/contract errors stop immediately", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new TradingApiError(503); });
  await flush(); await h.advance(120000);
  assert.equal(calls, 3); assert.equal(h.states.at(-1), "unavailable"); assert.equal(h.timers.size, 0); h.stop();
  for (const status of [401, 403, 422]) {
    const blocked = harness(async () => { throw new TradingApiError(status); }); await flush();
    assert.equal(blocked.states.at(-1), "unavailable"); assert.equal(blocked.timers.size, 0); blocked.stop();
  }
});
test("heartbeat sends only PING, stale sockets reconnect, policy close stops and account changes reject late frames", async () => {
  const h = harness(); await flush(); h.handshake();
  await h.advance(20000); assert.deepEqual(h.sockets[0].sent, [JSON.stringify({ type: "PING" })]);
  await h.advance(41000); assert.equal(h.sockets.length, 2); h.handshake();
  h.changeAccount(); h.sockets[1].frame("TRADING_EVENT", event("1"));
  assert.equal(h.delivered.length, 0); assert.equal(h.timers.size, 0); h.stop();
  const denied = harness(); await flush(); denied.sockets[0].disconnect(1008);
  assert.equal(denied.states.at(-1), "unavailable"); assert.equal(denied.timers.size, 0); denied.stop();
});
test("cleanup aborts even cancellation-resistant baseline and never opens an old-account socket", async () => {
  let resolve!: (value: unknown) => void, signal!: AbortSignal;
  const h = harness(async (_cursor, requestSignal) => { signal = requestSignal; return new Promise(done => { resolve = done; }); });
  h.stop(); assert.equal(signal.aborted, true); resolve([event("1")]); await flush();
  assert.equal(h.sockets.length, 0); assert.equal(h.delivered.length, 0);
});
test("event contracts reject invalid IDs/order status and notices never render arbitrary server reasons", () => {
  assert.equal(eventId("9223372036854775807"), "9223372036854775807");
  for (const value of [1, "-1", "01", "9223372036854775808"]) assert.throws(() => eventId(value));
  assert.throws(() => parseTradingEvents([event("2"), event("1")]));
  assert.throws(() => parseTradingEvent({ ...event("1"), type: "ORDER_FILLED" }));
  const rejected = parseTradingEvent({ ...event("1"), type: "ORDER_REJECTED", order: { ...order, status: "REJECTED", reason: "Bearer secret-credential" } });
  assert.equal(JSON.stringify(tradingEventNotice(rejected)).includes("secret-credential"), false);
  assert.equal(tradingEventNotice(parseTradingEvent(event("1"))), null);
});
test("asynchronous LIMIT fills and liquidation have distinct controlled notifications", () => {
  const filled = { ...order, positionId: 1, status: "FILLED", completedAt: at,
    fill: { fillId: 1, quantity: "0.001", price: "100000", priceEventTime: at, executedAt: at, realizedPnl: "0", fee: "0.03", settlementAdjustment: "0", marginMode: "ISOLATED" } };
  assert.equal(tradingEventNotice(parseTradingEvent({ ...event("2"), type: "ORDER_FILLED", order: filled }))?.title, "지정가 주문이 체결되었습니다");
  const liquidated = parseTradingEvent({ ...event("3"), type: "POSITION_LIQUIDATED", order: { ...filled, type: "MARKET", action: "LIQUIDATE" } });
  assert.equal(tradingEventNotice(liquidated)?.kind, "error");
  assert.equal(tradingEventNotice(parseTradingEvent({ ...event("4"), type: "ORDER_FILLED", order: { ...filled, type: "MARKET" } })), null);
});
