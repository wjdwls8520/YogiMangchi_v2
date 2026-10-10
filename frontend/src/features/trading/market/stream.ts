export type MarketState = "CONNECTING" | "WAITING_FOR_FIRST_PRICE" | "READY" | "UNAVAILABLE" | "RECONNECTING";
export type MarketPrice = { eventTime: number; decimal: string; value: number };
type Socket = Pick<WebSocket, "readyState" | "send" | "close" | "onopen" | "onclose" | "onerror" | "onmessage">;
type Timer = ReturnType<typeof setTimeout>;
type Runtime = {
  socket: (url: string) => Socket;
  now: () => number;
  random: () => number;
  later: (callback: () => void, ms: number) => Timer;
  cancel: (timer: Timer) => void;
};
const browserRuntime: Runtime = {
  socket: (url) => new WebSocket(url), now: Date.now, random: Math.random,
  later: (callback, ms) => setTimeout(callback, ms), cancel: (timer) => clearTimeout(timer),
};
export function retryDelay(attempt: number, random = Math.random()) {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5) * (0.8 + random * 0.4));
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function timestamp(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) ? Date.parse(value) : NaN;
}

// Protocol v1 from MarketWebSocketHandler. No credentials are needed for this
// public market endpoint. Each instance owns one symbol and all its resources.
export function openMarketStream(options: {
  url: string; symbolId: number;
  onState: (state: MarketState) => void;
  onPrice: (price: MarketPrice) => void;
}, runtime: Runtime = browserRuntime) {
  let stopped = false;
  let socket: Socket | null = null;
  let attempt = 0;
  let generation = 0;
  let lastEventTime = -Infinity;
  let serverOffset = 0;
  let state: MarketState | undefined;
  let freshTimer: Timer | undefined;
  const timers = new Set<Timer>();
  const emit = (next: MarketState) => {
    if (!stopped && state !== next) { state = next; options.onState(next); }
  };
  const later = (fn: () => void, ms: number) => {
    const timer = runtime.later(() => { timers.delete(timer); if (!stopped) fn(); }, ms);
    timers.add(timer);
    return timer;
  };
  const cancel = (timer: Timer | undefined) => {
    if (timer !== undefined) { runtime.cancel(timer); timers.delete(timer); }
  };
  const detach = () => {
    generation++;
    for (const timer of timers) runtime.cancel(timer);
    timers.clear();
    freshTimer = undefined;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      if (socket.readyState < 2) socket.close(1000, "Chart connection closed");
      socket = null;
    }
  };
  const reconnect = () => {
    if (stopped) return;
    detach();
    emit("RECONNECTING");
    later(connect, retryDelay(attempt++, runtime.random()));
  };
  const receivePrice = (input: unknown) => {
    const price = record(input);
    if (!price || price.tradingSymbolId !== options.symbolId) return;
    if (price.status !== "FRESH") {
      if (["STALE", "UNAVAILABLE", "RECONNECTING"].includes(String(price.status))) emit(price.status === "RECONNECTING" ? "RECONNECTING" : "UNAVAILABLE");
      return;
    }
    const eventTime = timestamp(price.eventTime);
    const receivedAt = timestamp(price.receivedAt);
    const now = runtime.now() + serverOffset;
    if (typeof price.price !== "string" || !/^\d{1,40}(\.\d{1,30})?$/.test(price.price)
      || !Number.isFinite(Number(price.price)) || Number(price.price) <= 0
      || !Number.isFinite(eventTime) || !Number.isFinite(receivedAt)
      || Math.min(eventTime, receivedAt) <= now - 5000 || Math.max(eventTime, receivedAt) > now + 1000) {
      emit("UNAVAILABLE");
      return;
    }
    if (eventTime <= lastEventTime) return;
    lastEventTime = eventTime;
    attempt = 0;
    options.onPrice({ eventTime, decimal: price.price, value: Number(price.price) });
    if (stopped) return;
    emit("READY");
    cancel(freshTimer);
    freshTimer = later(() => emit("UNAVAILABLE"), Math.max(1, Math.min(eventTime, receivedAt) + 5000 - now));
  };
  function connect() {
    if (stopped) return;
    emit(attempt > 0 ? "RECONNECTING" : "CONNECTING");
    const current = ++generation;
    let active: Socket;
    try { active = runtime.socket(options.url); socket = active; }
    catch { reconnect(); return; }
    let connected = false;
    let lastInbound = runtime.now();
    const pingTimes: number[] = [];
    const handshakeTimer = later(reconnect, 10_000);
    const send = (command: { type: string; tradingSymbolIds?: number[] }) => {
      if (active.readyState !== 1) return false;
      if (command.type === "PING" && pingTimes.length >= 3) { reconnect(); return false; }
      const sentAt = runtime.now();
      try {
        active.send(JSON.stringify(command));
        if (command.type === "PING") pingTimes.push(sentAt);
        return true;
      } catch { reconnect(); return false; }
    };
    active.onopen = () => { /* Wait for the server's CONNECTED handshake. */ };
    active.onclose = active.onerror = () => { if (current === generation) reconnect(); };
    active.onmessage = (event) => {
      if (stopped || current !== generation || typeof event.data !== "string" || event.data.length > 65_536) return;
      let message: Record<string, unknown> | null;
      try { message = record(JSON.parse(event.data)); } catch { return; }
      if (!message || message.version !== 1) return;
      lastInbound = runtime.now();
      if (message.type === "CONNECTED" && !connected) {
        if (message.heartbeatSeconds !== 20 || message.idleTimeoutSeconds !== 60) { reconnect(); return; }
        connected = true;
        cancel(handshakeTimer);
        emit("WAITING_FOR_FIRST_PRICE");
        // Estimate clock offset from the heartbeat round trip. Using only the
        // arrival time would incorrectly subtract network delay from price age.
        if (!send({ type: "PING" }) || !send({ type: "SUBSCRIBE", tradingSymbolIds: [options.symbolId] })) return;
        later(() => { if (state === "WAITING_FOR_FIRST_PRICE") emit("UNAVAILABLE"); }, 10_000);
        const heartbeat = () => {
          if (runtime.now() - lastInbound >= 60_000) { reconnect(); return; }
          if (!send({ type: "PING" })) return;
          if (current === generation) later(heartbeat, 20_000);
        };
        later(heartbeat, 20_000);
      } else if (connected && message.type === "PONG") {
        const time = timestamp(message.serverTime);
        if (Number.isFinite(time)) {
          const sentAt = pingTimes.shift();
          if (sentAt !== undefined) serverOffset = time - (sentAt + runtime.now()) / 2;
        }
      } else if (connected && message.type === "SNAPSHOT" && Array.isArray(message.prices)) {
        message.prices.forEach(receivePrice);
      } else if (connected && message.type === "MARKET_PRICE") receivePrice(message);
      else if (connected && message.type === "MARKET_STATUS" && Array.isArray(message.affectedTradingSymbolIds)
        && message.affectedTradingSymbolIds.includes(options.symbolId)) {
        if (message.status === "RECONNECTING") emit("RECONNECTING");
        else if (message.status === "STALE" || message.status === "UNAVAILABLE") emit("UNAVAILABLE");
        // RECOVERED alone is not a valid price. INFRA_STATUS is independent of
        // price freshness because the server can use its memory fallback.
      } else if (message.type === "ERROR") reconnect();
    };
  }
  connect();
  return () => { stopped = true; detach(); };
}
