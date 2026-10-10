import { test } from "node:test";
import assert from "node:assert/strict";
import { openMarketStream, retryDelay, type MarketPrice, type MarketState } from "../src/features/trading/market/stream";

class FakeSocket {
  readyState = 0;
  onopen: WebSocket["onopen"] = null;
  onclose: WebSocket["onclose"] = null;
  onerror: WebSocket["onerror"] = null;
  onmessage: WebSocket["onmessage"] = null;
  sent: Record<string, unknown>[] = [];
  send(input: string | ArrayBufferLike | Blob | ArrayBufferView) { this.sent.push(JSON.parse(String(input))); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.call(this as unknown as WebSocket, new Event("open")); }
  message(input: object) { this.onmessage?.call(this as unknown as WebSocket, new MessageEvent("message", { data: JSON.stringify({ version: 1, ...input }) })); }
  disconnect() { this.readyState = 3; this.onclose?.call(this as unknown as WebSocket, new Event("close") as CloseEvent); }
}
function harness() {
  let now = Date.UTC(2026, 9, 11);
  let nextId = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const sockets: FakeSocket[] = [];
  const states: MarketState[] = [];
  const prices: MarketPrice[] = [];
  const runtime = {
    socket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    now: () => now, random: () => 0.5,
    later: (fn: () => void, ms: number) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel: (id: ReturnType<typeof setTimeout>) => { timers.delete(id as unknown as number); },
  };
  const start = (id = 927) => openMarketStream({ url: "ws://localhost:8081/ws/market", symbolId: id, onState: (state) => states.push(state), onPrice: (price) => prices.push(price) }, runtime);
  const handshake = (socket = sockets.at(-1)!, clockOffset = 0) => { socket.open(); socket.message({ type: "CONNECTED", maxSubscriptions: 32, heartbeatSeconds: 20, idleTimeoutSeconds: 60 }); socket.message({ type: "PONG", serverTime: new Date(now + clockOffset).toISOString() }); };
  const tick = (overrides = {}) => ({ type: "MARKET_PRICE", tradingSymbolId: 927, price: "64579.80000000", status: "FRESH", eventTime: new Date(now).toISOString(), receivedAt: new Date(now).toISOString(), ...overrides });
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers].filter(([, value]) => value.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].fn();
    }
    now = until;
  };
  return { start, handshake, tick, advance, sockets, states, prices, timers };
}
test("handshake, heartbeat, valid price, expiry and recovery follow v1", () => {
  const h = harness(); const stop = h.start(); h.handshake();
  assert.deepEqual(h.states, ["CONNECTING", "WAITING_FOR_FIRST_PRICE"]);
  assert.deepEqual(h.sockets[0].sent, [{ type: "PING" }, { type: "SUBSCRIBE", tradingSymbolIds: [927] }]);
  h.sockets[0].message(h.tick()); assert.equal(h.states.at(-1), "READY");
  assert.equal(h.prices[0].decimal, "64579.80000000");
  h.advance(5000); assert.equal(h.states.at(-1), "UNAVAILABLE");
  h.sockets[0].message({ type: "MARKET_STATUS", status: "RECOVERED", affectedTradingSymbolIds: [927] });
  assert.equal(h.states.at(-1), "UNAVAILABLE");
  h.sockets[0].message(h.tick()); assert.equal(h.states.at(-1), "READY");
  h.advance(15_000); assert.equal(h.sockets[0].sent.at(-1)?.type, "PING");
  stop(); assert.equal(h.timers.size, 0); assert.equal(h.sockets[0].readyState, 3);
});
test("wrong symbol, reverse ticks, malformed versions and stale snapshots cannot become READY", () => {
  const h = harness(); const stop = h.start(); h.handshake();
  h.sockets[0].message(h.tick({ tradingSymbolId: 5 }));
  h.sockets[0].message(h.tick({ version: 2 }));
  assert.equal(h.prices.length, 0);
  h.sockets[0].message({ type: "SNAPSHOT", prices: [h.tick({ status: "STALE" })] });
  assert.equal(h.states.at(-1), "UNAVAILABLE");
  h.sockets[0].message(h.tick()); h.advance(1000); h.sockets[0].message(h.tick({ eventTime: "2026-10-11T00:00:00.000Z" }));
  assert.equal(h.prices.length, 1);
  h.sockets[0].message({ type: "INFRA_STATUS", component: "REDIS", status: "UNAVAILABLE" });
  assert.equal(h.states.at(-1), "READY");
  h.sockets[0].message(h.tick({ eventTime: "2020-01-01T00:00:00Z" }));
  assert.equal(h.states.at(-1), "UNAVAILABLE"); stop();
});
test("reconnect backs off even when sockets open, cleanup removes old callbacks and all retries", () => {
  const h = harness(); const stop = h.start();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) {
    h.handshake(); h.sockets.at(-1)!.disconnect();
    const count = h.sockets.length;
    h.advance(delay - 1); assert.equal(h.sockets.length, count);
    h.advance(1); assert.equal(h.sockets.length, count + 1);
  }
  assert.equal(h.states.at(-1), "RECONNECTING");
  stop(); h.advance(300_000);
  assert.equal(h.timers.size, 0); assert.equal(h.sockets.length, 7);
  for (const socket of h.sockets) assert.equal(socket.onmessage, null);
  assert.equal(retryDelay(100, 1), 30_000);
});
test("Strict Mode cleanup and symbol switch leave only the new subscription alive", () => {
  const h = harness(); const first = h.start(); first();
  const second = h.start(528); h.handshake();
  h.sockets[0].message(h.tick()); assert.equal(h.prices.length, 0);
  h.sockets[1].message(h.tick({ tradingSymbolId: 528 })); assert.equal(h.prices.length, 1);
  assert.deepEqual(h.sockets[1].sent[1], { type: "SUBSCRIBE", tradingSymbolIds: [528] });
  second(); assert.equal(h.timers.size, 0);
});
test("handshake timeout and silent first-price timeout are bounded", () => {
  const h = harness(); const stop = h.start();
  h.advance(10_000); assert.equal(h.states.at(-1), "RECONNECTING");
  h.advance(1000); h.handshake();
  h.advance(10_000); assert.equal(h.states.at(-1), "UNAVAILABLE");
  stop(); assert.equal(h.timers.size, 0);
});
test("server errors and lost heartbeats reconnect without accumulating timers", () => {
  const h = harness(); const stop = h.start(); h.handshake();
  h.sockets[0].message({ type: "ERROR", code: "TEMPORARILY_UNAVAILABLE", message: "The subscription could not be processed" });
  assert.equal(h.states.at(-1), "RECONNECTING");
  assert.equal(h.timers.size, 1);
  h.advance(1000); h.handshake();
  h.advance(60_000);
  assert.equal(h.states.at(-1), "RECONNECTING");
  assert.equal(h.sockets[1].readyState, 3);
  assert.equal(h.timers.size, 1);
  stop(); assert.equal(h.timers.size, 0);
});
test("server PONG clock handles browser clock differences, while delayed prices remain unavailable", () => {
  const h = harness(); const stop = h.start(); h.handshake(h.sockets[0], 60_000);
  h.sockets[0].message(h.tick({ eventTime: "2026-10-11T00:01:00.000Z", receivedAt: "2026-10-11T00:01:00.000Z" }));
  assert.equal(h.states.at(-1), "READY");
  h.advance(6000);
  h.sockets[0].message(h.tick({ eventTime: "2026-10-11T00:01:00.000Z", receivedAt: "2026-10-11T00:01:00.000Z" }));
  assert.equal(h.states.at(-1), "UNAVAILABLE");
  stop();
});
test("heartbeat network delay is not subtracted from the age of delayed prices", () => {
  const h = harness(); const stop = h.start(); const socket = h.sockets[0]; socket.open();
  socket.message({ type: "CONNECTED", heartbeatSeconds: 20, idleTimeoutSeconds: 60, maxSubscriptions: 32 });
  h.advance(6000);
  socket.message({ type: "PONG", serverTime: "2026-10-11T00:00:03.000Z" });
  socket.message(h.tick({ eventTime: "2026-10-11T00:00:00.000Z", receivedAt: "2026-10-11T00:00:00.000Z" }));
  assert.equal(h.prices.length, 0); assert.equal(h.states.at(-1), "UNAVAILABLE"); stop();
});
