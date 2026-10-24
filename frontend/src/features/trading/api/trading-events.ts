import { orderReason } from "./order-reason";
import { instant, invalidContract, list, record } from "./contracts";
import { parseOrder } from "./orders";
import { retryTradingQuery, TradingApiError } from "./client";
import type { TradingNotice } from "./notices";

export function eventId(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > BigInt("9223372036854775807")) return invalidContract();
  return value;
}
export function parseTradingEvent(value: unknown) {
  const row = record(value), order = parseOrder(row.order);
  const expected = order.action === "LIQUIDATE" && order.status === "FILLED" ? "POSITION_LIQUIDATED" : `ORDER_${order.status}`;
  if (row.type !== expected || eventId(row.eventId) === "0") return invalidContract();
  return { eventId: eventId(row.eventId), type: expected, occurredAt: instant(row.occurredAt), order };
}
export function parseTradingEvents(value: unknown) {
  const events = list(value, parseTradingEvent);
  if (events.length > 100 || events.some((event, index) => index > 0 && BigInt(event.eventId) <= BigInt(events[index - 1].eventId))) return invalidContract();
  return events;
}
export type TradingEvent = ReturnType<typeof parseTradingEvent>;
export type EventState = "syncing" | "live" | "reconnecting" | "unavailable";
type EventSocket = Pick<WebSocket, "readyState" | "onopen" | "onclose" | "onerror" | "onmessage" | "send" | "close">;
type Timer = ReturnType<typeof setTimeout>;
type Runtime = { socket: (url: string) => EventSocket; later: (fn: () => void, ms: number) => Timer; cancel: (timer: Timer) => void; now: () => number };
const runtime: Runtime = { socket: url => new WebSocket(url), later: (fn, ms) => setTimeout(fn, ms), cancel: timer => clearTimeout(timer), now: () => Date.now() };

// REST establishes a silent baseline; WS then resumes the same durable cursor. Credentials stay in the session closure.
export function openTradingEvents(options: {
  url: string; read: (cursor: string, signal: AbortSignal) => Promise<unknown>;
  authenticate: (socket: EventSocket, cursor: string) => void; current: () => boolean;
  onEvent: (event: TradingEvent) => void; onState: (state: EventState) => void; onReady: () => void;
}, clock: Runtime = runtime) {
  let stopped = false, cursor = "0", baseline = false, attempts = 0;
  let socket: EventSocket | undefined, timer: Timer | undefined, abort: AbortController | undefined;
  const active = () => !stopped && options.current();
  function clear() {
    if (timer !== undefined) clock.cancel(timer);
    timer = undefined;
    abort?.abort(); abort = undefined;
    const previous = socket; socket = undefined;
    if (previous) {
      previous.onopen = previous.onclose = previous.onerror = previous.onmessage = null;
      if (previous.readyState < 2) previous.close(1000, "Account stream closed");
    }
  }
  function failed(error?: unknown, terminal = false) {
    clear();
    if (!active()) return;
    if (terminal || error instanceof TradingApiError && !retryTradingQuery(attempts, error) || attempts >= 6) {
      options.onState("unavailable"); return;
    }
    options.onState("reconnecting");
    timer = clock.later(() => { timer = undefined; void start(); }, Math.min(1000 * 2 ** attempts++, 30_000));
  }
  function connect() {
    if (!active()) return;
    let authenticated = false, authSent = false, lastHeard = clock.now();
    try { socket = clock.socket(options.url); } catch { failed(); return; }
    const opened = socket;
    timer = clock.later(() => failed(), 10_000);
    const ping = () => {
      if (!active() || opened !== socket) { clear(); return; }
      if (clock.now() - lastHeard > 45_000) { failed(); return; }
      try { opened.send(JSON.stringify({ type: "PING" })); } catch { failed(); return; }
      timer = clock.later(ping, 20_000);
    };
    opened.onopen = () => { if (!active()) clear(); };
    opened.onclose = event => { if (opened === socket) failed(undefined, event.code === 1008); };
    opened.onerror = () => { if (opened === socket) failed(); };
    opened.onmessage = message => {
      if (!active() || opened !== socket) { clear(); return; }
      try {
        if (typeof message.data !== "string" || message.data.length > 131072) return failed(undefined, true);
        const frame = record(JSON.parse(message.data));
        lastHeard = clock.now();
        if (frame.type === "CONNECTED" && !authSent) {
          authSent = true;
          options.authenticate(opened, cursor);
        } else if (frame.type === "AUTHENTICATED" && authSent && !authenticated) {
          const data = record(frame.data);
          if (eventId(data.afterEventId) !== cursor) return failed(undefined, true);
          instant(data.expiresAt); authenticated = true;
          if (timer !== undefined) clock.cancel(timer);
          options.onState("live"); options.onReady(); timer = clock.later(ping, 20_000);
        } else if (authenticated && frame.type === "TRADING_EVENT") {
          const event = parseTradingEvent(frame.data);
          if (BigInt(event.eventId) <= BigInt(cursor)) return;
          cursor = event.eventId; options.onEvent(event);
        } else if (authenticated && (frame.type === "HEARTBEAT" || frame.type === "PONG")) {
          attempts = 0;
        } else failed(undefined, true);
      } catch { failed(undefined, true); }
    };
  }
  async function start() {
    if (!active()) return;
    if (baseline) { connect(); return; }
    options.onState("syncing");
    const controller = abort = new AbortController();
    try {
      // Keep only a cursor and yield between bounded passes, even for a large retained ledger.
      for (let page = 0; page < 100; page++) {
        const batch = parseTradingEvents(await options.read(cursor, controller.signal));
        if (!active() || controller.signal.aborted) return;
        if (batch.some(event => BigInt(event.eventId) <= BigInt(cursor))) return failed(undefined, true);
        if (batch.length) cursor = batch.at(-1)!.eventId;
        if (batch.length < 100) { baseline = true; abort = undefined; connect(); return; }
      }
      abort = undefined;
      timer = clock.later(() => { timer = undefined; void start(); }, 100);
    } catch (error) { if (!controller.signal.aborted) failed(error); }
  }
  void start();
  const stop = () => { stopped = true; clear(); };
  stop.reconnect = () => { if (!active()) return; clear(); attempts = 0; void start(); };
  return stop;
}

// MARKET mutation feedback already covers immediate fills. These notices cover asynchronous server transitions.
function describeEvent(event: TradingEvent): TradingNotice | null {
  const order = event.order;
  if (event.type === "POSITION_LIQUIDATED") return { kind: "error", title: "포지션이 강제청산되었습니다", message: `${order.side} · 주문 #${order.orderId} · 체결 내역을 확인해 주세요.` };
  if (order.type !== "LIMIT") return null;
  if (event.type === "ORDER_FILLED") return { kind: "success", title: "지정가 주문이 체결되었습니다", message: `${order.side} · ${order.action} · 주문 #${order.orderId} · 수량 ${order.quantity}` };
  if (event.type === "ORDER_REJECTED") return { kind: "error", title: "지정가 주문이 거절되었습니다", message: `${orderReason(order.reason)} 주문 #${order.orderId} · 주문 내역을 확인해 주세요.` };
  return null;
}

export function tradingEventNotice(event: TradingEvent): TradingNotice | null {
  const notice = describeEvent(event);
  return notice ? { ...notice, resultKey: `${event.order.orderId}:${event.order.status}` } : null;
}
