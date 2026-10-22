import { tradingJson, tradingOrigin, TradingApiError } from "./client";
import { parseCredential, parseGuest, type GuestCredential } from "./contracts";
import { mutationRequest, type TradingCommand } from "./mutation-request";
import { leveragePath, parseLeverage, validLeverage } from "./leverage-contract";
import type { QuoteRequest } from "./quote";
import { parseOrder } from "./orders";
import { parseGuestRetry } from "./guest-retry";
import { openTradingEvents, type EventState, type TradingEvent } from "./trading-events";

export type SessionSnapshot = { phase: "loading" | "anonymous" | "creating" | "ready" | "error"; accountId: number | null; generation: number; retrying?: boolean };
export const initialSession: SessionSnapshot = { phase: "loading", accountId: null, generation: 0 };
type StorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Tokens stay private: snapshots, query keys/data and errors never contain them.
export function createGuestSession(origin: string, storage: StorageAccess, transport: typeof fetch = fetch, now = Date.now, legacyStorage?: StorageAccess) {
  const storageKey = `yogimangchi.guest.v1:${origin}`;
  let credential: GuestCredential | null = null;
  let snapshot = initialSession;
  let flight: Promise<void> | null = null;
  let retrying=false, writes=0;
  let retryFlight: Promise<ReturnType<typeof parseGuestRetry>> | null=null;
  const listeners = new Set<() => void>();
  function publish(phase: SessionSnapshot["phase"]) {
    snapshot = { phase, accountId: phase === "ready" ? credential!.accountId : null, generation: snapshot.generation + 1, ...(retrying ? {retrying:true} : {}) };
    listeners.forEach((listener) => listener());
  }
  const usable = (value: GuestCredential) => Date.parse(value.expiresAt) > now();
  function stored(value: string): GuestCredential | null {
    try { const parsed = parseCredential(JSON.parse(value)); return usable(parsed) ? parsed : null; }
    catch { return null; }
  }
  function removeLegacy() { try { legacyStorage?.().removeItem(storageKey); } catch { /* Local persistence is authoritative. */ } }
  function load(): GuestCredential | null {
    const local = storage(), saved = local.getItem(storageKey);
    if (saved !== null) {
      const value = stored(saved);
      if (!value) local.removeItem(storageKey);
      removeLegacy();
      return value;
    }
    let legacy: string | null = null;
    try { legacy = legacyStorage?.().getItem(storageKey) ?? null; } catch { /* Legacy storage is optional. */ }
    const migrated = legacy === null ? null : stored(legacy);
    // Remove the old key only after successful persistence of a valid credential.
    if (migrated) local.setItem(storageKey, JSON.stringify(migrated));
    removeLegacy();
    return migrated;
  }
  function replace(value: GuestCredential | null) {
    if (value && snapshot.phase === "ready" && credential?.accountId === value.accountId
      && credential.accessToken === value.accessToken && credential.expiresAt === value.expiresAt) return;
    if (!value && snapshot.phase === "anonymous") return;
    credential = value;
    publish(value ? "ready" : "anonymous");
  }
  function invalidate(failed: GuestCredential) {
    if (credential !== failed) return;
    credential = null;
    try {
      const saved = storage().getItem(storageKey), value = saved === null ? null : stored(saved);
      // A late response from this tab must not erase another tab's new Guest.
      if (saved !== null && (!value || value.accessToken === failed.accessToken)) storage().removeItem(storageKey);
    } catch { /* Still stop authenticated access if persistence becomes unavailable. */ }
    publish("anonymous");
  }
  function run(operation: () => void | Promise<void>) {
    if (flight) return flight;
    flight = Promise.resolve().then(operation).finally(() => { flight = null; });
    return flight;
  }
  return {
    storageKey,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore() {
      return run(() => {
        try { replace(load()); }
        catch { credential = null; publish("error"); }
      });
    },
    createGuest() {
      return run(async () => {
        try {
          // Restore first: a double click or another tab must not replace a valid Guest.
          const existing = load();
          if (existing) { replace(existing); return; }
          credential = null;
          storage().setItem(`${storageKey}.probe`, "1");
          storage().removeItem(`${storageKey}.probe`);
          publish("creating");
          const created = parseGuest(await tradingJson(origin, "accounts/guest", { method: "POST" }, transport));
          if (!usable(created)) throw new TradingApiError(401);
          storage().setItem(storageKey, JSON.stringify(created));
          credential = created;
          publish("ready");
        } catch { credential = null; publish("anonymous"); }
      });
    },
    async read(path: "account/summary" | "account/orders/pending" | `account/orders?${string}` | `account/fills?${string}` | `account/positions/history?${string}` | "account/orders/quote" | `account/symbols/${number}/leverage`, expected: SessionSnapshot, signal: AbortSignal, quote?: QuoteRequest) {
      const current = credential;
      if (retrying || !current || snapshot.phase !== "ready" || expected.accountId !== current.accountId || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
      if (!usable(current)) { invalidate(current); throw new TradingApiError(401); }
      try {
        const value = await tradingJson(origin, path, { token: current.accessToken, signal, ...(path === "account/orders/quote" ? {method:"POST" as const,body:quote} : {}) }, transport);
        if (current !== credential || signal.aborted || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
        if (!usable(current)) { invalidate(current); throw new TradingApiError(401); }
        return value;
      } catch (error) {
        if (error instanceof TradingApiError && error.status === 401) invalidate(current);
        throw error;
      }
    },
    watchEvents(expected: SessionSnapshot, onEvent: (event: TradingEvent) => void, onState: (state: EventState) => void, onReady: () => void) {
      const current = credential;
      const active = () => !!current && current === credential && usable(current) && !retrying && snapshot.phase === "ready"
        && expected.accountId === current.accountId && expected.generation === snapshot.generation;
      if (!current || !active()) return () => {};
      const socketUrl = new URL("/ws/trading", tradingOrigin(origin));
      socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
      return openTradingEvents({ url: socketUrl.href, current: active, onEvent, onState, onReady,
        authenticate: (socket, cursor) => {
          if (!active()) throw new DOMException("Session changed", "AbortError");
          socket.send(JSON.stringify({ type: "AUTHENTICATE", credential: current.accessToken, afterEventId: cursor }));
        },
        read: async (cursor, signal) => {
          if (!active()) throw new DOMException("Session changed", "AbortError");
          try {
            const value = await tradingJson(origin, `account/events?afterId=${cursor}&limit=100`, { token: current.accessToken, signal }, transport);
            if (!active()) throw new DOMException("Session changed", "AbortError");
            return value;
          } catch (error) {
            if (error instanceof TradingApiError && error.status === 401) invalidate(current);
            throw error;
          }
        },
      });
    },
    async changeLeverage(symbolId: number, leverage: number, expected: SessionSnapshot) {
      if(retrying)throw new TradingApiError(409,undefined,"TRADING_BUSY");
      const path = leveragePath(symbolId);
      if (!validLeverage(leverage)) throw new TradingApiError(400, "레버리지는 1~100배 정수로 설정해 주세요.");
      const current = credential;
      if (current && !usable(current)) invalidate(current);
      if (!current || snapshot.phase !== "ready" || expected.accountId !== current.accountId || expected.generation !== snapshot.generation) throw new TradingApiError(401);
      writes++;
      try {
        const value = await tradingJson(origin, path, { token: current.accessToken, method: "PUT", body: { leverage } }, transport);
        if (current !== credential || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
        if (!usable(current)) { invalidate(current); throw new TradingApiError(401); }
        return parseLeverage(value, symbolId);
      } catch (error) {
        if (error instanceof TradingApiError && error.status === 401) invalidate(current);
        throw error;
      } finally {writes--;}
    },
    async write(command: TradingCommand, expected: SessionSnapshot, key: string) {
      if(retrying)throw new TradingApiError(409,undefined,"TRADING_BUSY");
      const current = credential;
      if (current && !usable(current)) invalidate(current);
      if (!current || snapshot.phase !== "ready" || expected.accountId !== current.accountId || expected.generation !== snapshot.generation) throw new TradingApiError(401);
      const request = mutationRequest(command);
      writes++;
      try {
        const value = await tradingJson(origin, request.path, { token: current.accessToken, method: "POST", body: request.body,
          idempotencyKey: request.keyed ? key : undefined }, transport);
        if (current !== credential || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
        return parseOrder(value);
      } catch (error) {
        if (error instanceof TradingApiError && error.status === 401) invalidate(current);
        throw error;
      } finally {writes--;}
    },
    retryGuest(expected: SessionSnapshot, key: string) {
      if(retryFlight)return retryFlight;
      const current=credential;
      if(!current||!usable(current)||snapshot.phase!=="ready"||expected.accountId!==current.accountId||expected.generation!==snapshot.generation){
        if(current&&!usable(current))invalidate(current);
        return Promise.reject(new TradingApiError(401));
      }
      if(!/^[A-Za-z0-9_-]{8,100}$/.test(key))return Promise.reject(new TradingApiError(400,undefined,"INVALID_IDEMPOTENCY_KEY"));
      if(writes)return Promise.reject(new TradingApiError(409,undefined,"TRADING_BUSY"));
      // Advance the cache/intent epoch before reset; late reads and old uncertain orders cannot revive it.
      retrying=true;publish("ready");
      retryFlight=(async()=>{
        try {
          const value=await tradingJson(origin,"account/retry",{method:"POST",token:current.accessToken,idempotencyKey:key},transport);
          if(current!==credential)throw new DOMException("Session changed","AbortError");
          return parseGuestRetry(value,current.accountId);
        } catch(error){if(error instanceof TradingApiError&&error.status===401)invalidate(current);throw error;}
        finally {
          retrying=false;retryFlight=null;
          if(current===credential)publish("ready");
        }
      })();
      return retryFlight;
    },
  };
}
export type GuestSession = ReturnType<typeof createGuestSession>;
