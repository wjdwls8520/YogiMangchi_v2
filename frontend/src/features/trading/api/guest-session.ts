import { tradingJson, tradingOrigin, TradingApiError } from "./client";
import { decimal, id, parseCredential, parseGuest, record, type GuestCredential } from "./contracts";
import { mutationRequest, mutationStillUnconfirmed, type TradingCommand } from "./mutation-request";
import { leveragePath, parseLeverage, validLeverage } from "./leverage-contract";
import type { QuoteRequest } from "./quote";
import { parseStopLoss, stopLossRequest, type StopLossCommand } from "./stop-loss-contract";
import { parseOrder } from "./orders";
import { parseGuestRetry } from "./guest-retry";
import { openTradingEvents, parseTradingEvents, type EventState, type TradingEvent } from "./trading-events";
import { parseRestart } from "./member-rounds";
import { CommandJournalError, createCommandJournal, type CommandJournal, type JournalCommand, type JournalEntry, type JournalOwner } from "./command-journal";
import { commandResultRequest, parseCommandResult, commandResultSettled, type CommandResult } from "./command-result";

export type SessionSnapshot = { phase: "loading" | "anonymous" | "creating" | "ready" | "error"; accountId: number | null; generation: number; retrying?: boolean; mode?: "member" | "checking"; roundId?: number; authRequired?: boolean; contestSeasonId?: number };
export const initialSession: SessionSnapshot = { phase: "loading", accountId: null, generation: 0 };
export type TradingSessionClientOptions = { contestSeasonId?: number };
type StorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
type MemberCredential = { memberId: number; accessToken: string; expiresAt: string };

export function resolveContestTradingPath(path: string, contestSeasonId?: number): string {
  if (!contestSeasonId || !Number.isSafeInteger(contestSeasonId) || contestSeasonId <= 0) {
    return path;
  }
  if (path === "account/summary") {
    return `contest/seasons/${contestSeasonId}/account/summary`;
  }
  if (path.startsWith("account/")) {
    return `contest/seasons/${contestSeasonId}/${path.slice("account/".length)}`;
  }
  return path;
}

export function authenticateGuestTradingSocket(
  ws: Pick<WebSocket, "send">,
  token: string,
  afterEventId: number | string = "0",
  contestSeasonId?: number,
) {
  ws.send(
    JSON.stringify({
      type: "AUTHENTICATE",
      credential: token,
      afterEventId: String(afterEventId),
      ...(contestSeasonId && Number.isSafeInteger(contestSeasonId) && contestSeasonId > 0
        ? { contestSeasonId }
        : {}),
    }),
  );
}

// Tokens stay private: snapshots, query keys/data and errors never contain them.
export function createGuestSession(origin: string, storage: StorageAccess, transport: typeof fetch = fetch, now = Date.now, legacyStorage?: StorageAccess,
  journal:CommandJournal|undefined=typeof window==="undefined"?undefined:createCommandJournal(), options?: TradingSessionClientOptions) {
  const contestId = options?.contestSeasonId && Number.isSafeInteger(options.contestSeasonId) && options.contestSeasonId > 0 ? options.contestSeasonId : undefined;
  const contestSeasonId = contestId;
  const resolvePath = (path: string) => resolveContestTradingPath(path, contestId);
  const storageKey = contestId ? `yogimangchi.contest.v1:${origin}:${contestId}` : `yogimangchi.guest.v1:${origin}`;
  let credential: GuestCredential | null = null;
  let snapshot: SessionSnapshot = contestId ? { ...initialSession, mode: "member", contestSeasonId: contestId } : initialSession;
  let flight: Promise<void> | null = null;
  let retrying=false, writes=0;
  let retryFlight: Promise<ReturnType<typeof parseGuestRetry>> | null=null;
  let mode: "guest" | "member" | "checking" = contestId ? "member" : "guest";
  let member: MemberCredential | null = null;
  let memberRequest: { owner: MemberCredential; generation: number } | null = null;
  let memberRoundId: number | undefined;
  let restartIntent: { key: string; memberId: number; credential: GuestCredential; roundId: number } | null = null;
  let memberRestartFlight: Promise<ReturnType<typeof parseRestart>> | null = null;
  let memberAuthRejected = false, memberLookupRecoveryAttempted = false;
  let memberRefresh: (() => void) | undefined;
  const eventReconnects = new Set<() => void>();
  const listeners = new Set<() => void>();
  function commandOwner():JournalOwner|null {
    const current=credential??(mode==="member"&&restartIntent&&restartIntent.memberId===member?.memberId?restartIntent.credential:null);
    return current&&mode!=="checking"?{origin:tradingOrigin(origin),mode,accountId:current.accountId}:null;
  }
  async function journaled<T>(command:JournalCommand,accountId:number,key:string,operation:()=>Promise<T>):Promise<T> {
    if(!journal)return operation();
    const owner:JournalOwner={origin:tradingOrigin(origin),mode:mode==="guest"?"guest":"member",accountId};
    let finish:(()=>void)|undefined;
    try {
      finish=journal.beginAttempt(owner,key,!journal.read(owner).some(entry=>entry.key===key));
      const reserved=await journal.reserveAttempt(owner,command,key);
      return await journal.withEntryLock(reserved.entry,async entry=>{
        try {
          if(reserved.existed) {
            const found=await lookupCommand(entry);
            if(commandResultSettled(found))return found.result as T;
          }
          const result=await operation();
          // A cleanup failure retains the journal; it must not turn a known server result into a new command.
          try{await journal.removeConfirmed(entry);}catch{ /* Recovery UI retries authoritative lookup and cleanup. */ }
          return result;
        } catch(error) {
          if(!mutationStillUnconfirmed(error,reserved.existed))try{await journal.removeConfirmed(entry);}catch{ /* Keep the durable guard if storage is unavailable. */ }
          throw error;
        }
      });
    } catch(error) {
      if(error instanceof CommandJournalError)throw new TradingApiError(409,undefined,"LOCAL_COMMAND_JOURNAL_BLOCKED");
      throw error;
    } finally {finish?.();}
  }
  async function lookupCommand(entry:JournalEntry,signal?:AbortSignal):Promise<CommandResult> {
    const owner=commandOwner();
    const current=credential??restartIntent?.credential;
    if(!owner||!current||!usable(current)||owner.origin!==entry.owner.origin||owner.mode!==entry.owner.mode||owner.accountId!==entry.owner.accountId)throw new TradingApiError(401);
    const sentToken=current.accessToken;
    let hadJournalEntry=false;try{hadJournalEntry=!!journal?.read(owner).some(value=>value.key===entry.key);}catch{ /* Read-only lookup still has a validated original command. */ }
    const owned=()=>{const actual=commandOwner();return actual?.origin===owner.origin&&actual.mode===owner.mode&&actual.accountId===entry.owner.accountId;};
    let result:CommandResult;
    try {
      if(entry.command.kind==="cancel") {
        const order=parseOrder(await tradingJson(origin,resolvePath(`account/orders/${entry.command.orderId}`),{token:sentToken,signal},transport));
        if(order.orderId!==entry.command.orderId)throw new TradingApiError(422);
        result={status:"FOUND",operation:"CANCEL",observedAt:new Date(now()).toISOString(),resultKind:"ORDER_CURRENT",result:order};
      } else result=parseCommandResult(await tradingJson(origin,resolvePath("account/command-results/query"),{token:sentToken,signal,method:"POST",body:commandResultRequest(entry)},transport),entry);
      if(!owned()||signal?.aborted)throw new DOMException("Session changed","AbortError");
      if(result.status==="FOUND"&&result.operation==="MEMBER_RESTART") {
        if(mode!=="member"||!member)throw new TradingApiError(401);
        const actual=record(record(await tradingJson(origin,"account/rounds/current",{token:member.accessToken,signal},transport)).round);
        if(!owned()||signal?.aborted)throw new DOMException("Session changed","AbortError");
        if(actual.currentRound!==true||actual.status!=="ACTIVE")throw new TradingApiError(422);
        const roundId=id(actual.roundId),changed=hadJournalEntry||!!restartIntent||snapshot.phase!=="ready"||memberRoundId!==roundId;
        memberRoundId=roundId;restartIntent=null;credential={accountId:owner.accountId,accessToken:member.accessToken,expiresAt:member.expiresAt};if(changed)publish("ready");
      } else if(result.status==="FOUND"&&result.operation==="GUEST_RETRY"&&hadJournalEntry)publish("ready");
      if(commandResultSettled(result)&&journal)await journal.removeConfirmed(entry);
      return result;
    } catch(error) {if(error instanceof TradingApiError&&error.status===401&&owned())invalidate(current,sentToken);throw error;}
  }
  function publish(phase: SessionSnapshot["phase"]) {
    snapshot = { phase, accountId: phase === "ready" ? credential!.accountId : null, generation: snapshot.generation + 1, ...(retrying ? {retrying:true} : {}), ...(mode !== "guest" ? { mode } : {}), ...(memberAuthRejected ? { authRequired: true } : {}), ...(mode === "member" && memberRoundId ? { roundId: memberRoundId } : {}), ...(contestId ? { contestSeasonId: contestId } : {}) };
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
  function invalidate(failed: GuestCredential, sentToken = failed.accessToken) {
    if (credential !== failed || credential.accessToken !== sentToken) return;
    if (mode === "member") {
      memberAuthRejected = true;
      snapshot = {...snapshot,phase:"loading"}; listeners.forEach(listener=>listener());
      memberRefresh?.(); return;
    }
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
  async function loadMember(open: boolean) {
    const owner = member;
    if (restartIntent) return;
    if (mode !== "member" || !owner || memberAuthRejected) return;
    if (Date.parse(owner.expiresAt) <= now()) {
      memberAuthRejected = true; publish("error");
      if (!memberLookupRecoveryAttempted) { memberLookupRecoveryAttempted = true; memberRefresh?.(); }
      return;
    }
    if (memberRequest?.owner === owner) return;
    credential = null; publish(open ? "creating" : "loading");
    const generation = snapshot.generation;
    const request = memberRequest = { owner, generation };
    let sentToken = owner.accessToken;
    let reconcile = false;
    try {
      if (contestId) {
        const row = record(await tradingJson(origin, resolvePath("account/summary"), { token: sentToken }, transport));
        if (mode !== "member" || member !== owner || snapshot.generation !== generation) return;
        memberRoundId = contestId; memberLookupRecoveryAttempted = false;
        credential = { accountId: id(row.accountId), accessToken: owner.accessToken, expiresAt: owner.expiresAt }; publish("ready");
        return;
      }
      const row = record(await tradingJson(origin, open ? "accounts/member" : "account/summary", { token: sentToken, ...(open ? { method: "POST" as const } : {}) }, transport));
      if (mode !== "member" || member !== owner || snapshot.generation !== generation) return;
      if (open && (id(row.memberId) !== owner.memberId || row.status !== "ACTIVE" || row.quoteAsset !== "USDT")) throw new TradingApiError(422);
      if (open) decimal(row.balance);
      sentToken = owner.accessToken;
      const round = record(record(await tradingJson(origin, "account/rounds/current", { token: sentToken }, transport)).round);
      if (mode !== "member" || member !== owner || snapshot.generation !== generation) return;
      if (round.currentRound !== true || round.status !== "ACTIVE") throw new TradingApiError(422);
      memberRoundId = id(round.roundId); memberLookupRecoveryAttempted = false;
      credential = { accountId: id(row.accountId), accessToken: owner.accessToken, expiresAt: owner.expiresAt }; publish("ready");
    } catch (error) {
      if (mode !== "member" || member !== owner || snapshot.generation !== generation) return;
      const accountRequired = error instanceof TradingApiError && error.status === 409 && error.code === "TRADING_ACCOUNT_REQUIRED";
      const denied = error instanceof TradingApiError && error.status === 401;
      if (accountRequired) memberLookupRecoveryAttempted = false;
      if (denied && owner.accessToken === sentToken) memberAuthRejected = true;
      publish(accountRequired ? "anonymous" : "error");
      if (denied) {
        // A rejected creation is never replayed. Restore authentication, then only reconcile by GET.
        if (owner.accessToken !== sentToken) reconcile = true;
        else if (!memberLookupRecoveryAttempted) { memberLookupRecoveryAttempted = true; memberRefresh?.(); }
      }
    } finally {
      if (memberRequest === request) memberRequest = null;
      if (reconcile && mode === "member" && member === owner && snapshot.generation === generation + 1) await loadMember(false);
    }
  }
  return {
    storageKey,
    getSnapshot: () => snapshot,
    getCommandOwner: commandOwner,
    readCommandJournal: () => {const owner=commandOwner();return owner&&journal?journal.read(owner).filter(entry=>!journal.isExecuting(entry)):[];},
    queryJournalEntry(entry:JournalEntry,signal?:AbortSignal,allowResolved=false):Promise<CommandResult> {
      if(!journal)return Promise.reject(new CommandJournalError("LOCK_UNSUPPORTED"));
      return journal.withResultLock(entry,()=>{
        if(!allowResolved&&!journal.read(entry.owner).some(value=>value.key===entry.key))throw new CommandJournalError("RESOLVED");
        return lookupCommand(entry,signal);
      });
    },
    resendJournalEntry(entry:JournalEntry):Promise<unknown> {
      const owner=commandOwner(),expected=snapshot;
      if(!owner||!journal||owner.origin!==entry.owner.origin||owner.mode!==entry.owner.mode||owner.accountId!==entry.owner.accountId)return Promise.reject(new TradingApiError(401));
      const stored=journal.read(owner).find(value=>value.key===entry.key);
      if(!stored||JSON.stringify(stored.command)!==JSON.stringify(entry.command))return Promise.reject(new TradingApiError(409,undefined,"LOCAL_COMMAND_JOURNAL_BLOCKED"));
      switch(stored.command.kind) {
        case "stopLoss":return this.writeStopLoss(stored.command,expected,stored.key);
        case "memberRestart":return this.restartMember(expected,stored.key);
        case "guestRetry":return this.retryGuest(expected,stored.key);
        default:return this.write(stored.command,expected,stored.key);
      }
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    suspendMember(memberId: number | null) {
      if (mode !== "member" || !member || member.memberId !== memberId || !credential || snapshot.accountId !== credential.accountId) return false;
      if (snapshot.phase !== "loading") {
        // The owner is unchanged. Pause access, but retain the intent/cache epoch for same-key confirmation.
        snapshot = { ...snapshot, phase: "loading" }; listeners.forEach(listener => listener());
      }
      return true;
    },
    pauseMemberCheck(error = false) {
      if (mode === "checking" && snapshot.phase === (error ? "error" : "loading")) return;
      mode = "checking"; memberAuthRejected = false; memberLookupRecoveryAttempted = false; member = null; credential = null; memberRoundId = undefined; restartIntent = null; publish(error ? "error" : "loading");
    },
    async enterMember(value: { memberId: number; accessToken: string; expiresAt: string }, refresh: () => void) {
      memberRefresh = refresh;
      if (mode === "member" && member?.memberId === value.memberId) {
        const rotated = member.accessToken !== value.accessToken;
        if (memberAuthRejected && !rotated) return;
        if (rotated) memberAuthRejected = false;
        member.accessToken = value.accessToken; member.expiresAt = value.expiresAt;
        if (restartIntent) {
          restartIntent.credential.accessToken = value.accessToken;
          restartIntent.credential.expiresAt = value.expiresAt;
          return;
        }
        if (credential && (snapshot.phase === "ready" || snapshot.phase === "loading" && snapshot.accountId === credential.accountId)) {
          const changed = credential.accessToken !== value.accessToken;
          if (memberAuthRejected && !changed) return;
          memberAuthRejected = false;
          credential.accessToken = value.accessToken; credential.expiresAt = value.expiresAt;
          if (snapshot.phase !== "ready") { snapshot = {...snapshot,phase:"ready"}; listeners.forEach(listener=>listener()); }
          if (changed) eventReconnects.forEach(reconnect => reconnect());
          return;
        }
        if (memberRequest?.owner === member) return;
        if (snapshot.phase === "anonymous") return;
      } else { mode = "member"; memberAuthRejected = false; memberLookupRecoveryAttempted = false; member = { ...value }; memberRoundId = undefined; restartIntent = null; }
      await loadMember(false);
    },
    leaveMember() {
      if (contestSeasonId) {
        mode = "member"; memberAuthRejected = false; memberLookupRecoveryAttempted = false; member = null; memberRefresh = undefined; credential = null; memberRoundId = undefined; restartIntent = null; publish("anonymous");
        return;
      }
      if (mode === "guest") return;
      mode = "guest"; memberAuthRejected = false; memberLookupRecoveryAttempted = false; member = null; memberRefresh = undefined; credential = null; memberRoundId = undefined; restartIntent = null; publish("loading");
    },
    createMember() {
      return run(() => snapshot.phase === "anonymous" && mode === "member" ? loadMember(true) : undefined);
    },
    restore() {
      if (contestSeasonId) {
        if (mode === "member" && member) return credential && usable(credential) && snapshot.phase === "ready" ? Promise.resolve() : run(() => loadMember(false));
        publish("anonymous");
        return Promise.resolve();
      }
      if (mode === "member") return credential && usable(credential) && snapshot.phase === "ready" ? Promise.resolve() : run(() => loadMember(false));
      if (mode !== "guest") return Promise.resolve();
      return run(() => {
        if (mode !== "guest") return;
        try { replace(load()); }
        catch { credential = null; publish("error"); }
      });
    },
    createGuest() {
      if (contestSeasonId || mode !== "guest") return Promise.resolve();
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
    async read(path: `account/positions/${number}/stop-loss` | `account/orders/${number}` | `account/events?afterId=${number | string}&limit=${number}` | "account/recovery" | `account/performance/symbols?${string}` | "account/summary" | "account/orders/pending" | `account/orders?${string}` | `account/fills?${string}` | `account/positions/history?${string}` | `account/rounds${string}` | "account/orders/quote" | `account/symbols/${number}/leverage?side=${"LONG" | "SHORT"}`, expected: SessionSnapshot, signal: AbortSignal, quote?: QuoteRequest) {
      const current = credential;
      const sentToken = current?.accessToken;
      if (retrying || !current || snapshot.phase !== "ready" || expected.accountId !== current.accountId || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
      if (!usable(current)) { invalidate(current, sentToken); throw new TradingApiError(401); }
      try {
        const value = await tradingJson(origin, resolvePath(path), { token: sentToken, signal, ...(path === "account/orders/quote" ? {method:"POST" as const,body:quote} : {}) }, transport);
        if (current !== credential || signal.aborted || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
        if (!usable(current)) { invalidate(current, sentToken); throw new TradingApiError(401); }
        return value;
      } catch (error) {
        if (error instanceof TradingApiError && error.status === 401) invalidate(current, sentToken);
        throw error;
      }
    },
    async readEvents(expected: SessionSnapshot, signal: AbortSignal, limit = 50, afterId: number | string = 0) {
      return parseTradingEvents(await this.read(`account/events?afterId=${afterId}&limit=${limit}`, expected, signal));
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
      let accepted = false;
      memberRestartFlight = journaled({kind:"memberRestart"},current.accountId,key,async () => {
          if(mode!=="member"||member?.memberId!==ownerId||restartIntent!==intent)throw new DOMException("Session changed","AbortError");
          const result = parseRestart(await tradingJson(origin, "account/restart", { method: "POST", token: member!.accessToken, idempotencyKey: key }, transport));
          accepted = true;
          if (mode !== "member" || member?.memberId !== ownerId || restartIntent !== intent) throw new DOMException("Session changed", "AbortError");
          const actual = record(record(await tradingJson(origin, "account/rounds/current", { token: member.accessToken }, transport)).round);
          if (mode !== "member" || member?.memberId !== ownerId || restartIntent !== intent) throw new DOMException("Session changed", "AbortError");
          if (actual.currentRound !== true || actual.status !== "ACTIVE") throw new TradingApiError(422);
          memberRoundId = id(actual.roundId); restartIntent = null;
          return result;
      }).catch((error:unknown) => {
          if (mode === "member" && member?.memberId === ownerId && restartIntent === intent) {
            const uncertain = mutationStillUnconfirmed(error, accepted || !!previous);
            if (uncertain) { credential = null; memberRoundId = undefined; }
            else { restartIntent = null; memberRoundId = intent.roundId; if (error instanceof TradingApiError && error.status === 401) invalidate(current); }
          }
          if (accepted && !(error instanceof DOMException && error.name === "AbortError")) throw new TradingApiError(0);
          throw error;
      }).finally(() => {
          memberRestartFlight = null; retrying = false;
          if (mode === "member" && member?.memberId === ownerId) publish(credential ? "ready" : "error");
      });
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
          authenticateGuestTradingSocket(socket, current.accessToken, cursor, contestSeasonId);
        },
        read: async (cursor, signal) => {
          if (!active()) throw new DOMException("Session changed", "AbortError");
          const sentToken = current.accessToken;
          try {
            const value = await tradingJson(origin, resolvePath(`account/events?afterId=${cursor}&limit=100`), { token: sentToken, signal }, transport);
            if (!active()) throw new DOMException("Session changed", "AbortError");
            return value;
          } catch (error) {
            if (error instanceof TradingApiError && error.status === 401) invalidate(current, sentToken);
            throw error;
          }
        },
      });
      eventReconnects.add(stream.reconnect);
      return () => { eventReconnects.delete(stream.reconnect); stream(); };
    },
    async changeLeverage(symbolId: number, leverage: number, expected: SessionSnapshot, side: "LONG" | "SHORT" = "LONG") {
      if(retrying)throw new TradingApiError(409,undefined,"TRADING_BUSY");
      const path = resolvePath(leveragePath(symbolId, side).split("?")[0]);
      if (!validLeverage(leverage)) throw new TradingApiError(400, "레버리지는 1~100배 정수로 설정해 주세요.");
      const current = credential;
      const sentToken = current?.accessToken;
      if (current && !usable(current)) invalidate(current, sentToken);
      if (!current || snapshot.phase !== "ready" || expected.accountId !== current.accountId || expected.generation !== snapshot.generation) throw new TradingApiError(401);
      writes++;
      try {
        const value = await tradingJson(origin, path, { token: sentToken, method: "PUT", body: { side, leverage } }, transport);
        if (current !== credential || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
        if (!usable(current)) { invalidate(current, sentToken); throw new TradingApiError(401); }
        return parseLeverage(value, symbolId, side);
      } catch (error) {
        if (error instanceof TradingApiError && error.status === 401) invalidate(current, sentToken);
        throw error;
      } finally {writes--;}
    },
    async writeStopLoss(command: StopLossCommand, expected: SessionSnapshot, key: string) {
      if (retrying) throw new TradingApiError(409, undefined, "TRADING_BUSY");
      const current = credential, sentToken = current?.accessToken;
      if (current && !usable(current)) invalidate(current, sentToken);
      if (!current || snapshot.phase !== "ready" || expected.accountId !== current.accountId || expected.generation !== snapshot.generation) throw new TradingApiError(401);
      const request = stopLossRequest(command);
      writes++;
      try {
        return await journaled({kind:"stopLoss",...command},current.accountId,key,async()=>{
        if(current!==credential||expected.generation!==snapshot.generation)throw new DOMException("Session changed","AbortError");
        const value = await tradingJson(origin, resolvePath(request.path), {token:sentToken, method:request.method, body:request.body, idempotencyKey:key}, transport);
        if (current !== credential || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
        return parseStopLoss(value, command.positionId);
        });
      } catch (error) {
        if (error instanceof TradingApiError && error.status === 401) invalidate(current,sentToken);
        throw error;
      } finally { writes--; }
    },
    async write(command: TradingCommand, expected: SessionSnapshot, key: string) {
      if(retrying)throw new TradingApiError(409,undefined,"TRADING_BUSY");
      const current = credential;
      const sentToken = current?.accessToken;
      if (current && !usable(current)) invalidate(current, sentToken);
      if (!current || snapshot.phase !== "ready" || expected.accountId !== current.accountId || expected.generation !== snapshot.generation) throw new TradingApiError(401);
      const request = mutationRequest(command);
      writes++;
      try {
        return await journaled(command,current.accountId,key,async()=>{
        if(current!==credential||expected.generation!==snapshot.generation)throw new DOMException("Session changed","AbortError");
        const value = await tradingJson(origin, resolvePath(request.path), { token: sentToken, method: "POST", body: request.body,
          idempotencyKey: request.keyed ? key : undefined }, transport);
        if (current !== credential || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
        return parseOrder(value);
        });
      } catch (error) {
        if (error instanceof TradingApiError && error.status === 401) invalidate(current, sentToken);
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
      retryFlight=journaled({kind:"guestRetry"},current.accountId,key,async()=>{
        try {
          if(current!==credential||mode!=="guest")throw new DOMException("Session changed","AbortError");
          const value=await tradingJson(origin,"account/retry",{method:"POST",token:current.accessToken,idempotencyKey:key},transport);
          if(current!==credential)throw new DOMException("Session changed","AbortError");
          return parseGuestRetry(value,current.accountId);
        } catch(error){if(error instanceof TradingApiError&&error.status===401)invalidate(current);throw error;}
      }).finally(()=>{
          retrying=false;retryFlight=null;
          if(current===credential)publish("ready");
      });
      return retryFlight;
    },
  };
}
export const createGuestTradingSessionClient = createGuestSession;
export type GuestSession = ReturnType<typeof createGuestSession>;
