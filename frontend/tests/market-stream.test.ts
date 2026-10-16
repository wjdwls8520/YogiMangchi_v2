import { test } from "node:test";
import assert from "node:assert/strict";
import { openMarketStream, retryDelay, type MarketPrice, type MarketState } from "../src/features/trading/market/stream";
import type { OrderBook } from "../src/features/trading/market/order-book";

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
  fail() { this.onerror?.call(this as unknown as WebSocket, new Event("error")); }
}
function harness() {
  let now = Date.UTC(2026, 9, 11);
  let nextId = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const sockets: FakeSocket[] = [];
  const states: MarketState[] = [];
  const prices: MarketPrice[] = [];
  const books: OrderBook[] = [];
  const unavailableSymbols: number[] = [];
  const runtime = {
    socket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    now: () => now, random: () => 0.5,
    later: (fn: () => void, ms: number) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel: (id: ReturnType<typeof setTimeout>) => { timers.delete(id as unknown as number); },
  };
  const start = (id = 927) => openMarketStream({ url: "ws://localhost:8081/ws/market", symbolId: id, onState: (state) => states.push(state), onPrice: (price) => prices.push(price), onOrderBook: (book) => books.push(book), onSymbolUnavailable: (symbolId) => unavailableSymbols.push(symbolId) }, runtime);
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
  return { start, handshake, tick, advance, sockets, states, prices, books, timers, unavailableSymbols };
}
const bookMessage = (tick: ReturnType<ReturnType<typeof harness>["tick"]>, overrides = {}) => ({ ...tick, type: "ORDER_BOOK",
  bids: [{ price: "99.000000000000000001", quantity: "2" }], asks: [{ price: "101", quantity: "3" }], ...overrides });
test("ORDER_BOOK replaces snapshots on the existing socket and expires independently of Mark Price", () => {
  const h=harness(), stop=h.start();h.handshake();h.sockets[0].message(h.tick());
  h.sockets[0].message(bookMessage(h.tick()));assert.equal(h.books.at(-1)?.bids[0].price,"99.000000000000000001");
  h.advance(500);h.sockets[0].message(bookMessage(h.tick(),{bids:[{price:"98",quantity:"4"}]}));
  assert.equal(h.books.at(-1)?.bids.length,1);assert.equal(h.books.at(-1)?.bids[0].price,"98");assert.equal(h.sockets.length,1);
  h.advance(2999);assert.equal(h.books.at(-1)?.status,"FRESH");h.advance(1);
  assert.equal(h.books.at(-1)?.status,"STALE");assert.deepEqual(h.books.at(-1)?.bids,[]);assert.equal(h.states.at(-1),"READY");
  h.sockets[0].message(bookMessage(h.tick()));assert.equal(h.books.at(-1)?.status,"FRESH");stop();assert.equal(h.timers.size,0);
});
test("wrong symbol, malformed, duplicate and reverse book events never contaminate current data", () => {
  const h=harness(),stop=h.start();h.handshake();h.sockets[0].message(bookMessage(h.tick()));const count=h.books.length;
  h.sockets[0].message(bookMessage(h.tick(),{tradingSymbolId:5}));h.sockets[0].message(bookMessage(h.tick()));assert.equal(h.books.length,count);
  h.advance(500);h.sockets[0].message(bookMessage(h.tick()));const latest=h.books.at(-1);
  h.sockets[0].message(bookMessage(h.tick(),{eventTime:"2026-10-10T23:59:59.999Z"}));assert.equal(h.books.at(-1),latest);
  h.sockets[0].message(bookMessage(h.tick(),{bids:[{price:99,quantity:"2"}]}));assert.equal(h.books.at(-1)?.status,"UNAVAILABLE");
  assert.deepEqual(h.books.at(-1)?.bids,[]);stop();
});
test("book stale/unavailable and connection outages clear levels; Mark status alone does not clear a fresh book", () => {
  const h=harness(),stop=h.start();h.handshake();h.sockets[0].message(bookMessage(h.tick()));
  h.sockets[0].message({type:"MARKET_STATUS",status:"STALE",affectedTradingSymbolIds:[927]});assert.equal(h.books.at(-1)?.status,"FRESH");
  for(const status of ["STALE","UNAVAILABLE"]) {h.sockets[0].message(bookMessage(h.tick(),{status}));assert.deepEqual(h.books.at(-1)?.asks,[]);}
  h.advance(500);h.sockets[0].message(bookMessage(h.tick()));h.sockets[0].disconnect();assert.equal(h.books.at(-1)?.status,"UNAVAILABLE");
  stop();h.advance(60_000);assert.equal(h.timers.size,0);
});
test("book receipt TTL follows server clock offset without prolonging it for provider clock skew", () => {
  const h=harness(),stop=h.start();h.handshake(h.sockets[0],60_000);
  const receivedAt="2026-10-11T00:01:00.000Z",eventTime="2026-10-11T00:01:10.000Z";
  h.sockets[0].message(bookMessage(h.tick(),{receivedAt,eventTime}));assert.equal(h.books.at(-1)?.status,"FRESH");
  h.advance(3000);assert.equal(h.books.at(-1)?.status,"STALE");stop();
});
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
test("TEMPORARILY_UNAVAILABLE retries with existing backoff; lost heartbeats still reconnect", () => {
  const h = harness(); const stop = h.start(); h.handshake();
  h.sockets[0].message({ type: "ERROR", code: "TEMPORARILY_UNAVAILABLE", message: "The subscription could not be processed" });
  assert.equal(h.states.at(-1), "RECONNECTING");
  assert.equal(h.timers.size, 1);
  h.advance(999); assert.equal(h.sockets.length, 1);
  h.advance(1); assert.equal(h.sockets.length, 2); h.handshake();
  h.advance(60_000);
  assert.equal(h.states.at(-1), "RECONNECTING");
  assert.equal(h.sockets[1].readyState, 3);
  assert.equal(h.timers.size, 1);
  stop(); assert.equal(h.timers.size, 0);
});
for (const code of ["INVALID_COMMAND", "UNKNOWN_COMMAND", "SUBSCRIPTION_LIMIT", "SYMBOL_NOT_AVAILABLE", "FUTURE_SERVER_ERROR", undefined, null, 42, { type: "TEMPORARILY_UNAVAILABLE" }]) {
  test(`application ERROR ${JSON.stringify(code)} is terminal and cannot reconnect`, () => {
    const h = harness(); const stop = h.start(); h.handshake();
    h.sockets[0].message(h.tick());
    const oldClose = h.sockets[0].onclose;
    const oldError = h.sockets[0].onerror;
    const oldMessage = h.sockets[0].onmessage;
    h.sockets[0].message({ type: "ERROR", code, message: "TEMPORARILY_UNAVAILABLE" });
    assert.equal(h.states.at(-1), "UNAVAILABLE");
    assert.equal(h.sockets[0].readyState, 3);
    assert.equal(h.timers.size, 0);
    // Even callbacks queued before detaching must not restart a terminal stream.
    oldClose?.call(h.sockets[0] as unknown as WebSocket, new Event("close") as CloseEvent);
    oldError?.call(h.sockets[0] as unknown as WebSocket, new Event("error"));
    oldMessage?.call(h.sockets[0] as unknown as WebSocket, new MessageEvent("message", { data: JSON.stringify({ version: 1, ...h.tick() }) }));
    h.advance(300_000);
    assert.equal(h.sockets.length, 1);
    assert.equal(h.states.at(-1), "UNAVAILABLE");
    assert.equal(h.prices.length, 1);
    assert.deepEqual(h.unavailableSymbols, code === "SYMBOL_NOT_AVAILABLE" ? [927] : []);
    stop(); assert.equal(h.timers.size, 0);
  });
}
for (const event of ["close", "error"] as const) {
  test(`transport on${event} continues to reconnect`, () => {
    const h = harness(); const stop = h.start(); h.handshake();
    if (event === "close") h.sockets[0].disconnect(); else h.sockets[0].fail();
    assert.equal(h.states.at(-1), "RECONNECTING");
    h.advance(1000); assert.equal(h.sockets.length, 2);
    assert.deepEqual(h.unavailableSymbols, []);
    stop(); assert.equal(h.timers.size, 0);
  });
}
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

test("server-accepted provider clock skew keeps fresh receipts usable without changing event timestamps", () => {
  for (const skew of [-10_000, -2000, 2000, 10_000]) {
    const h=harness();const stop=h.start();h.handshake();
    const eventTime=new Date(Date.UTC(2026,9,11)+skew).toISOString();
    h.sockets[0].message(h.tick({eventTime}));
    assert.equal(h.states.at(-1),"READY");assert.equal(h.prices[0].eventTime,Date.parse(eventTime));
    h.advance(5000);assert.equal(h.states.at(-1),"UNAVAILABLE");stop();
  }
});
test("old/future receipts and provider skew beyond the server rejection limit remain unavailable", () => {
  for (const overrides of [{receivedAt:"2026-10-10T23:59:55.000Z"},{receivedAt:"2026-10-11T00:00:01.001Z"},
    {eventTime:"2026-10-11T00:00:10.001Z"},{eventTime:"2026-10-10T23:59:49.999Z"}]) {
    const h=harness();const stop=h.start();h.handshake();h.sockets[0].message(h.tick(overrides));
    assert.equal(h.prices.length,0);assert.equal(h.states.at(-1),"UNAVAILABLE");stop();
  }
});
