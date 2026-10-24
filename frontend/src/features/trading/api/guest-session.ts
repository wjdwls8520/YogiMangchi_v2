import { tradingJson, tradingOrigin, TradingApiError } from "./client";
import { decimal, id, parseCredential, parseGuest, record, type GuestCredential } from "./contracts";
import { mutationRequest, uncertainMutation, type TradingCommand } from "./mutation-request";
import { leveragePath, parseLeverage, validLeverage } from "./leverage-contract";
import type { QuoteRequest } from "./quote";
import { parseOrder } from "./orders";
import { parseGuestRetry } from "./guest-retry";
import { openTradingEvents, type EventState, type TradingEvent } from "./trading-events";
import { parseRestart } from "./member-rounds";

export type SessionSnapshot = { phase: "loading" | "anonymous" | "creating" | "ready" | "error"; accountId: number | null; generation: number; retrying?: boolean; mode?: "member" | "checking"; roundId?: number };
export const initialSession: SessionSnapshot = { phase: "loading", accountId: null, generation: 0 };
type StorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
type MemberCredential = { memberId: number; accessToken: string; expiresAt: string };

// Tokens stay private: snapshots, query keys/data and errors never contain them.
export function createGuestSession(origin: string, storage: StorageAccess, transport: typeof fetch = fetch, now = Date.now, legacyStorage?: StorageAccess) {
  const storageKey = `yogimangchi.guest.v1:${origin}`;
  let credential: GuestCredential | null = null;
  let snapshot = initialSession;
  let flight: Promise<void> | null = null;
  let retrying=false, writes=0;
  let retryFlight: Promise<ReturnType<typeof parseGuestRetry>> | null=null;
  let mode: "guest" | "member" | "checking" = "guest";
  let member: MemberCredential | null = null;
  let memberRequest: { owner: MemberCredential; generation: number } | null = null;
  let memberRoundId: number | undefined;
  let restartIntent: { key: string; memberId: number; credential: GuestCredential; roundId: number } | null = null;
  let memberRestartFlight: Promise<ReturnType<typeof parseRestart>> | null = null;
  let memberRefresh: (() => void) | undefined;
  const eventReconnects = new Set<() => void>();
  const listeners = new Set<() => void>();
  function publish(phase: SessionSnapshot["phase"]) {
    snapshot = { phase, accountId: phase === "ready" ? credential!.accountId : null, generation: snapshot.generation + 1, ...(retrying ? {retrying:true} : {}), ...(mode !== "guest" ? { mode } : {}), ...(mode === "member" && memberRoundId ? { roundId: memberRoundId } : {}) };
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
    if (mode === "member") { publish("loading"); memberRefresh?.(); return; }
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
  async function loadMember(open: boolean) {
    const owner = member;
    if (restartIntent) return;
    if (mode !== "member" || !owner || Date.parse(owner.expiresAt) <= now()) return;
    if (memberRequest?.owner === owner) return;
    credential = null; publish(open ? "creating" : "loading");
    const generation = snapshot.generation;
    const request = memberRequest = { owner, generation };
    try {
      const row = record(await tradingJson(origin, open ? "accounts/member" : "account/summary", { token: owner.accessToken, ...(open ? { method: "POST" as const } : {}) }, transport));
      if (mode !== "member" || member !== owner || snapshot.generation !== generation) return;
      if (open && (id(row.memberId) !== owner.memberId || row.status !== "ACTIVE" || row.quoteAsset !== "USDT")) throw new TradingApiError(422);
      if (open) decimal(row.balance);
      const round = record(record(await tradingJson(origin, "account/rounds/current", { token: owner.accessToken }, transport)).round);
      if (mode !== "member" || member !== owner || snapshot.generation !== generation) return;
      if (round.currentRound !== true || round.status !== "ACTIVE") throw new TradingApiError(422);
      memberRoundId = id(round.roundId);
      credential = { accountId: id(row.accountId), accessToken: owner.accessToken, expiresAt: owner.expiresAt }; publish("ready");
    } catch (error) {
      if (mode !== "member" || member !== owner || snapshot.generation !== generation) return;
      publish(error instanceof TradingApiError && error.status === 404 ? "anonymous" : "error");
    } finally { if (memberRequest === request) memberRequest = null; }
  }
  return {
    storageKey,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    pauseMemberCheck(error = false) {
      if (mode === "checking" && snapshot.phase === (error ? "error" : "loading")) return;
      mode = "checking"; member = null; credential = null; memberRoundId = undefined; restartIntent = null; publish(error ? "error" : "loading");
    },
    async enterMember(value: { memberId: number; accessToken: string; expiresAt: string }, refresh: () => void) {
      memberRefresh = refresh;
      if (mode === "member" && member?.memberId === value.memberId) {
        member.accessToken = value.accessToken; member.expiresAt = value.expiresAt;
        if (restartIntent) {
          restartIntent.credential.accessToken = value.accessToken;
          restartIntent.credential.expiresAt = value.expiresAt;
          return;
        }
        if (credential && snapshot.phase === "ready") {
          const changed = credential.accessToken !== value.accessToken;
          credential.accessToken = value.accessToken; credential.expiresAt = value.expiresAt;
          if (changed) eventReconnects.forEach(reconnect => reconnect());
          return;
        }
        if (memberRequest?.owner === member) return;
        if (snapshot.phase === "anonymous") return;
      } else { mode = "member"; member = { ...value }; memberRoundId = undefined; restartIntent = null; }
      await loadMember(false);
    },
    leaveMember() {
      if (mode === "guest") return;
      mode = "guest"; member = null; memberRefresh = undefined; credential = null; memberRoundId = undefined; restartIntent = null; publish("loading");
    },
    createMember() { return run(() => loadMember(true)); },
    restore() {
      if (mode === "member") return credential && usable(credential) && snapshot.phase === "ready" ? Promise.resolve() : run(() => loadMember(false));
      if (mode !== "guest") return Promise.resolve();
      return run(() => {
        if (mode !== "guest") return;
        try { replace(load()); }
        catch { credential = null; publish("error"); }
      });
    },
    createGuest() {
      if (mode !== "guest") return Promise.resolve();
      return run(async () => {
        if (mode !== "guest") return;
        let generation = snapshot.generation;
        try {
          // Restore first: a double click or another tab must not replace a valid Guest.
          const existing = load();
          if (existing) { replace(existing); return; }
          credential = null;
          storage().setItem(`${storageKey}.probe`, "1");
          storage().removeItem(`${storageKey}.probe`);
          publish("creating");
          generation = snapshot.generation;
          const created = parseGuest(await tradingJson(origin, "accounts/guest", { method: "POST" }, transport));
          if (mode !== "guest" || snapshot.generation !== generation) return;
          if (!usable(created)) throw new TradingApiError(401);
          storage().setItem(storageKey, JSON.stringify(created));
          credential = created;
          publish("ready");
        } catch { if (mode === "guest" && snapshot.generation === generation) { credential = null; publish("anonymous"); } }
      });
    },
    async read(path: "account/recovery" | `account/performance/symbols?${string}` | "account/summary" | "account/orders/pending" | `account/orders?${string}` | `account/fills?${string}` | `account/positions/history?${string}` | `account/rounds${string}` | "account/orders/quote" | `account/symbols/${number}/leverage?side=${"LONG" | "SHORT"}`,  expected: SessionSnapshot, signal: AbortSignal, quote?: QuoteRequest) {
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
    observeMemberRound(roundId: number, expected: SessionSnapshot) {
      if (mode !== "member" || snapshot.phase !== "ready" || snapshot.generation !== expected.generation || snapshot.accountId !== expected.accountId) return;
      if (memberRoundId !== id(roundId)) { memberRoundId = roundId; publish("ready"); }
    },
    restartMember(expected: SessionSnapshot, key: string) {
      if (mode !== "member" || !member) return Promise.reject(new TradingApiError(403, undefined, "MEMBER_ACCOUNT_REQUIRED"));
      if (memberRestartFlight) return memberRestartFlight;
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) return Promise.reject(new TradingApiError(400, undefined, "INVALID_IDEMPOTENCY_KEY"));
      const previous = restartIntent;
      if (previous && (previous.key !== key || previous.memberId !== member.memberId)) return Promise.reject(new TradingApiError(409, undefined, "IDEMPOTENCY_CONFLICT"));
      const current = previous?.credential ?? credential;
      if (!current || !usable(current) || !previous && (snapshot.phase !== "ready" || expected.accountId !== current.accountId || expected.generation !== snapshot.generation || !memberRoundId)) return Promise.reject(new TradingApiError(401));
      if (writes || retrying) return Promise.reject(new TradingApiError(409, undefined, "TRADING_BUSY"));
      const ownerId = member.memberId;
      const intent = restartIntent = previous ?? { key, memberId: ownerId, credential: current, roundId: memberRoundId! };
      credential = current; retrying = true; publish("ready");
      memberRestartFlight = (async () => {
        let accepted = false;
        try {
          const result = parseRestart(await tradingJson(origin, "account/restart", { method: "POST", token: member!.accessToken, idempotencyKey: key }, transport));
          accepted = true;
          if (mode !== "member" || member?.memberId !== ownerId || restartIntent !== intent) throw new DOMException("Session changed", "AbortError");
          const actual = record(record(await tradingJson(origin, "account/rounds/current", { token: member.accessToken }, transport)).round);
          if (mode !== "member" || member?.memberId !== ownerId || restartIntent !== intent) throw new DOMException("Session changed", "AbortError");
          if (actual.currentRound !== true || actual.status !== "ACTIVE") throw new TradingApiError(422);
          memberRoundId = id(actual.roundId); restartIntent = null;
          return result;
        } catch (error) {
          if (mode === "member" && member?.memberId === ownerId && restartIntent === intent) {
            const uncertain = accepted || uncertainMutation(error);
            if (uncertain) { credential = null; memberRoundId = undefined; }
            else { restartIntent = null; memberRoundId = intent.roundId; if (error instanceof TradingApiError && error.status === 401) invalidate(current); }
          }
          if (accepted && !(error instanceof DOMException && error.name === "AbortError")) throw new TradingApiError(0);
          throw error;
        } finally {
          memberRestartFlight = null; retrying = false;
          if (mode === "member" && member?.memberId === ownerId) publish(credential ? "ready" : "error");
        }
      })();
      return memberRestartFlight;
    },
    watchEvents(expected: SessionSnapshot, onEvent: (event: TradingEvent) => void, onState: (state: EventState) => void, onReady: () => void) {
      const current = credential;
      const active = () => !!current && current === credential && usable(current) && !retrying && snapshot.phase === "ready"
        && expected.accountId === current.accountId && expected.generation === snapshot.generation;
      if (!current || !active()) return () => {};
      const socketUrl = new URL("/ws/trading", tradingOrigin(origin));
      socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
      const stream = openTradingEvents({ url: socketUrl.href, current: active, onEvent, onState, onReady,
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
      eventReconnects.add(stream.reconnect);
      return () => { eventReconnects.delete(stream.reconnect); stream(); };
    },
    async changeLeverage(symbolId: number, leverage: number, expected: SessionSnapshot, side: "LONG" | "SHORT" = "LONG") {
      if(retrying)throw new TradingApiError(409,undefined,"TRADING_BUSY");
      const path = leveragePath(symbolId, side).split("?")[0];
      if (!validLeverage(leverage)) throw new TradingApiError(400, "레버리지는 1~100배 정수로 설정해 주세요.");
      const current = credential;
      if (current && !usable(current)) invalidate(current);
      if (!current || snapshot.phase !== "ready" || expected.accountId !== current.accountId || expected.generation !== snapshot.generation) throw new TradingApiError(401);
      writes++;
      try {
        const value = await tradingJson(origin, path, { token: current.accessToken, method: "PUT", body: { side, leverage } }, transport);
        if (current !== credential || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
        if (!usable(current)) { invalidate(current); throw new TradingApiError(401); }
        return parseLeverage(value, symbolId, side);
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
      if (mode !== "guest") return Promise.reject(new TradingApiError(403, undefined, "GUEST_ACCOUNT_REQUIRED"));
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
