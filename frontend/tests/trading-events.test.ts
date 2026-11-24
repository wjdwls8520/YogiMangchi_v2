import { test } from "node:test";
import assert from "node:assert/strict";
import { eventId, openTradingEvents, parseTradingEvent, parseTradingEvents, tradingEventNotice, type EventState, type TradingEvent } from "../src/features/trading/api/trading-events";
import { eventHistoryDisplay } from "../src/features/trading/components/trading-event-status";
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
  disconnect(code = 1006, reason = "") { this.readyState = 3; this.onclose?.call(this as unknown as WebSocket, { code, reason } as CloseEvent); }
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
test("credential rotation reconnects at the retained cursor without replaying a new silent baseline", async () => {
  let reads = 0;
  const h = harness(async () => { reads++; return []; }); await flush(); h.handshake();
  h.sockets[0].frame("TRADING_EVENT", event("123"));
  h.stop.reconnect(); h.handshake();
  assert.equal(reads, 1); assert.equal(h.resumes.at(-1), "123");
  h.sockets[1].frame("TRADING_EVENT", event("123"));
  h.sockets[1].frame("TRADING_EVENT", event("124"));
  assert.deepEqual(h.delivered.map(value => value.eventId), ["123", "124"]); h.stop();
});

test("stop loss changed events deduplicate durable cursors and never create duplicate fill notices",async()=>{
  const h=harness();await flush();h.handshake();
  const sl={positionId:17,tradingSymbolId:1,side:"LONG",status:"TRIGGERED",stopPrice:"99",version:2,updatedAt:at,triggeredAt:at,priceEventTime:at,triggerPrice:"98",triggerOrderId:3,reason:"STOP_LOSS"};
  const changed={eventId:"1",type:"STOP_LOSS_CHANGED",occurredAt:at,order:null,stopLoss:sl};
  h.sockets[0].frame("TRADING_EVENT",changed);h.sockets[0].frame("TRADING_EVENT",changed);
  assert.equal(h.delivered.length,1);assert.equal(tradingEventNotice(h.delivered[0]),null);
  const filled={...order,type:"MARKET",action:"CLOSE",status:"FILLED",reason:"STOP_LOSS",completedAt:at,fill:{fillId:1,quantity:"0.001",price:"98",priceEventTime:at,executedAt:at,realizedPnl:"-1",fee:"0.03",settlementAdjustment:"0",marginMode:"ISOLATED"}};
  h.sockets[0].frame("TRADING_EVENT",{eventId:"2",type:"ORDER_FILLED",occurredAt:at,order:filled,stopLoss:null});
  h.sockets[0].frame("TRADING_EVENT",changed);
  assert.equal(h.delivered.length,2);assert.match(tradingEventNotice(h.delivered[1])!.title,/손절/);h.stop();
});

test("transient 1008 Authentication timed out reconnects automatically while invalid credential 1008 stays terminal", async () => {
  const transient = harness();
  await flush();
  transient.sockets[0].disconnect(1008, "Authentication timed out");
  assert.equal(transient.states.at(-1), "reconnecting");
  assert.equal(transient.timers.size, 1);
  await transient.advance(1000);
  assert.equal(transient.sockets.length, 2);
  transient.handshake();
  assert.equal(transient.states.at(-1), "live");
  transient.stop();

  const invalid = harness();
  await flush();
  invalid.sockets[0].disconnect(1008, "Invalid or expired credential");
  assert.equal(invalid.states.at(-1), "unavailable");
  assert.equal(invalid.timers.size, 0);
  invalid.stop();
});

test("eventHistoryDisplay formats TP/SL prices without 18 trailing zeros, trims order quantities, and labels all 4 statuses", () => {
  const slStatuses = [
    { status: "ACTIVE" as const, expectedTitle: "손절(SL)이 설정되었습니다", triggered: false },
    { status: "CANCELED" as const, expectedTitle: "손절(SL)이 해제되었습니다", triggered: false },
    { status: "TRIGGERED" as const, expectedTitle: "손절(SL)이 발동되었습니다", triggered: true },
    { status: "EXPIRED" as const, expectedTitle: "손절(SL)이 만료되었습니다", triggered: false },
  ];
  for (const [index, entry] of slStatuses.entries()) {
    const slEvent = parseTradingEvent({
      eventId: String(300 + index),
      type: "STOP_LOSS_CHANGED",
      occurredAt: at,
      order: null,
      stopLoss: {
        positionId: 42,
        tradingSymbolId: 1,
        side: "LONG",
        status: entry.status,
        stopPrice: "75497.375000000000000000",
        version: index + 1,
        updatedAt: at,
        triggeredAt: entry.triggered ? at : null,
        priceEventTime: entry.triggered ? at : null,
        triggerPrice: entry.triggered ? "75490.000000000000000000" : null,
        triggerOrderId: entry.triggered ? 901 : null,
        reason: entry.triggered ? "STOP_LOSS" : null,
      },
    });
    const display = eventHistoryDisplay(slEvent);
    assert.ok(display);
    assert.equal(display.title, entry.expectedTitle);
    assert.match(display.detail, /Mark 75,497\.38/);
    assert.equal(display.detail.includes("000000000000000"), false);
  }

  const tpStatuses = [
    { status: "ACTIVE" as const, expectedTitle: "익절(TP)이 설정되었습니다", triggered: false },
    { status: "CANCELED" as const, expectedTitle: "익절(TP)이 해제되었습니다", triggered: false },
    { status: "TRIGGERED" as const, expectedTitle: "익절(TP)이 발동되었습니다", triggered: true },
    { status: "EXPIRED" as const, expectedTitle: "익절(TP)이 만료되었습니다", triggered: false },
  ];
  for (const [index, entry] of tpStatuses.entries()) {
    const tpEvent = parseTradingEvent({
      eventId: String(400 + index),
      type: "TAKE_PROFIT_CHANGED",
      occurredAt: at,
      order: null,
      takeProfit: {
        positionId: 42,
        tradingSymbolId: 1,
        side: "SHORT",
        status: entry.status,
        takeProfitPrice: "45298.425000000000000000",
        version: index + 1,
        updatedAt: at,
        triggeredAt: entry.triggered ? at : null,
        priceEventTime: entry.triggered ? at : null,
        triggerPrice: entry.triggered ? "45290.000000000000000000" : null,
        triggerOrderId: entry.triggered ? 902 : null,
        reason: entry.triggered ? "TAKE_PROFIT" : null,
      },
    });
    const display = eventHistoryDisplay(tpEvent);
    assert.ok(display);
    assert.equal(display.title, entry.expectedTitle);
    assert.match(display.detail, /Mark 45,298\.43/);
    assert.equal(display.detail.includes("000000000000000"), false);
  }

  const limitFilled = parseTradingEvent({
    eventId: "501",
    type: "ORDER_FILLED",
    occurredAt: at,
    order: {
      ...order,
      positionId: 1,
      status: "FILLED",
      quantity: "0.01000000",
      completedAt: at,
      fill: {
        fillId: 11,
        quantity: "0.01000000",
        price: "100000",
        priceEventTime: at,
        executedAt: at,
        realizedPnl: "0",
        fee: "0.03",
        settlementAdjustment: "0",
        marginMode: "ISOLATED",
      },
    },
  });
  const limitNotice = tradingEventNotice(limitFilled);
  assert.ok(limitNotice);
  assert.match(limitNotice.message, /수량 0\.01$/);
  assert.equal(limitNotice.message.includes("0.01000000"), false);

  const marketFilled = parseTradingEvent({
    eventId: "502",
    type: "ORDER_FILLED",
    occurredAt: at,
    order: {
      ...order,
      type: "MARKET",
      positionId: 1,
      status: "FILLED",
      quantity: "0.01000000",
      limitPrice: null,
      completedAt: at,
      fill: {
        fillId: 12,
        quantity: "0.01000000",
        price: "100000",
        priceEventTime: at,
        executedAt: at,
        realizedPnl: "0",
        fee: "0.05",
        settlementAdjustment: "0",
        marginMode: "ISOLATED",
      },
    },
  });
  const marketDisplay = eventHistoryDisplay(marketFilled);
  assert.ok(marketDisplay);
  assert.match(marketDisplay.detail, /수량 0\.01$/);
  assert.equal(marketDisplay.detail.includes("0.01000000"), false);
});
