import { ContentApiError, contentJson } from "./client";
import { parseAccess, parseCsrf, parseWithdrawal, type MemberAccess } from "./contracts";
import { memberTabVisible } from "./activity";

export type MemberSnapshot = { phase: "loading" | "anonymous" | "authenticating" | "ready" | "ending" | "withdrawing" | "recovering" | "error";
  memberId: number | null; nickname: string; expiresAt: string | null; generation: number; recovery?: { retryable: boolean; retryAt: number; uncertain: boolean }; consentStatus?: "checking" | "required" | "accepted" | "unavailable" };
export const initialMember: MemberSnapshot = { phase: "loading", memberId: null, nickname: "", expiresAt: null, generation: 0 };
export type CookieLock = <T>(operation: () => Promise<T>) => Promise<T>;
export function browserCookieLock(origin: string): CookieLock {
  return async operation => {
    if (typeof navigator === "undefined" || !navigator.locks) throw new ContentApiError(0);
    return await navigator.locks.request(`yogimangchi:content-cookie:${origin}`, operation);
  };
}

// Access exists only in this closure. Snapshots, cache keys, browser storage and errors contain no tokens.
export function createMemberSession(origin: string, transport: typeof fetch = fetch, now = Date.now, lock = browserCookieLock(origin), visible = memberTabVisible, pendingStorage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = () => typeof window === "undefined" ? null : window.localStorage) {
  const pendingKey = `yogimangchi:content-refresh-pending:${origin}`;
  let snapshot = initialMember, access: MemberAccess | null = null;
  let refreshFlight: Promise<void> | null = null, authFlight: Promise<void> | null = null, logoutFlight: Promise<void> | null = null;
  let withdrawalAccess: MemberAccess | null = null, withdrawalFlight: Promise<ReturnType<typeof parseWithdrawal>> | null = null;
  let refreshRequired = false, refreshFailures = 0, accessRejected = false;
  const listeners = new Set<() => void>(), accessListeners = new Set<(value: Readonly<MemberAccess> | null) => void>();
  const emit = () => { listeners.forEach(fn => fn()); accessListeners.forEach(fn => fn(snapshot.phase === "ready" && access && !accessRejected && Date.parse(access.expiresAt) > now() ? access : null)); };
  function clear(phase: MemberSnapshot["phase"]) {
    access = null;
    refreshRequired = false; refreshFailures = 0; accessRejected = false;
    snapshot = { ...initialMember, phase, generation: snapshot.generation + 1 }; emit();
  }
  function accept(value: unknown, generation: number) {
    if (snapshot.generation !== generation) throw new DOMException("Session changed", "AbortError");
    const parsed = parseAccess(value);
    if (Date.parse(parsed.expiresAt) <= now()) throw new ContentApiError(401);
    const changed = snapshot.memberId !== parsed.memberId;
    access = Object.freeze(parsed); refreshFailures = 0; accessRejected = false;
    snapshot = { phase: "ready", memberId: parsed.memberId, nickname: parsed.nickname, expiresAt: parsed.expiresAt,
      generation: snapshot.generation + (changed ? 1 : 0), consentStatus: changed ? "checking" : snapshot.consentStatus ?? "checking" }; emit();
  }
  async function cookie(path: string, body?: object) {
    const csrf = parseCsrf(await contentJson(origin, "/auth/csrf", {}, transport));
    return contentJson(origin, path, { method: "POST", csrf, body }, transport);
  }
  function checkExpiry() {
    if (snapshot.recovery && snapshot.phase === "ready" && access && Date.parse(access.expiresAt) <= now()) {
      snapshot = { ...snapshot, phase: "recovering" }; emit();
    }
  }
  function refresh() {
    if (refreshFlight) return refreshFlight;
    if (logoutFlight || snapshot.phase === "ending" || snapshot.phase === "withdrawing") return Promise.reject(new ContentApiError(401));
    checkExpiry();
    const recovery = snapshot.recovery;
    if (recovery && (!recovery.retryable || now() < recovery.retryAt)) return Promise.reject(new ContentApiError(recovery.uncertain ? 0 : 503, recovery.uncertain ? undefined : "SERVICE_TEMPORARILY_UNAVAILABLE"));
    const requireVisible = () => {
      if (!visible()) { refreshRequired = true; throw new DOMException("Refresh deferred until visible", "AbortError"); }
    };
    try { requireVisible(); } catch (error) { return Promise.reject(error); }
    const generation = snapshot.generation;
    let rotationStarted = false, blockedByPending = false;
    let marker: ReturnType<typeof pendingStorage> = null, ownsMarker = false;
    refreshFlight = lock(async () => {
      if (snapshot.generation !== generation) throw new DOMException("Session changed", "AbortError");
      requireVisible();
      try { marker = pendingStorage(); if (marker?.getItem(pendingKey)) { blockedByPending = true; throw new ContentApiError(0); } }
      catch (error) { blockedByPending = true; throw error; }
      const csrf = parseCsrf(await contentJson(origin, "/auth/csrf", {}, transport));
      if (snapshot.generation !== generation) throw new DOMException("Session changed", "AbortError");
      requireVisible();
      marker?.setItem(pendingKey, "pending"); ownsMarker = true;
      rotationStarted = true;
      accept(await contentJson(origin, "/auth/refresh", {method:"POST", csrf}, transport), generation);
      marker?.removeItem(pendingKey); ownsMarker = false;
      refreshRequired = false;
    }).catch(error => {
      if (snapshot.generation === generation && !(error instanceof DOMException && error.name === "AbortError")) {
        if (error instanceof ContentApiError && error.status === 401) { if (ownsMarker) marker?.removeItem(pendingKey); clear("anonymous"); }
        else {
          // Only a pre-rotation failure or the documented no-consumption 503 is safe to retry.
          const safe = !blockedByPending && (!rotationStarted || error instanceof ContentApiError && error.status === 503 && error.code === "SERVICE_TEMPORARILY_UNAVAILABLE");
          if (safe && ownsMarker) { marker?.removeItem(pendingKey); ownsMarker = false; }
          refreshFailures++;
          snapshot = { ...snapshot, phase: access && !accessRejected && Date.parse(access.expiresAt) > now() ? "ready" : "recovering",
            recovery: {retryable: safe && refreshFailures < 3, retryAt: now() + Math.min(1000 * 2 ** (refreshFailures - 1),4000), uncertain: !safe} };
          refreshRequired = true; emit();
        }
      }
      throw error;
    }).finally(() => { refreshFlight = null; });
    return refreshFlight;
  }
  function authenticate(path: "/auth/signup" | "/auth/login/complete", body?: object) {
    if (authFlight) return authFlight;
    if (logoutFlight) return Promise.reject(new ContentApiError(401));
    withdrawalAccess = null;
    clear("authenticating");
    const generation = snapshot.generation;
    authFlight = lock(async () => {
      if (snapshot.generation !== generation) throw new DOMException("Session changed", "AbortError");
      accept(await cookie(path, body), generation);
      pendingStorage()?.removeItem(pendingKey);
    })
      .catch(error => { if (snapshot.generation === generation) clear(error instanceof ContentApiError && error.status === 401 ? "anonymous" : "error"); throw error; })
      .finally(() => { authFlight = null; });
    return authFlight;
  }
  async function authorized<T>(operation: (access: Readonly<MemberAccess>) => Promise<T>, retryRead = false): Promise<T> {
    if (!access || accessRejected || Date.parse(access.expiresAt) - now() < 30_000) {
      try { await refresh(); }
      catch (error) { if (!access || accessRejected || Date.parse(access.expiresAt) <= now() || !snapshot.recovery) throw error; }
    }
    const identity = snapshot, current = access;
    if (!current || identity.phase !== "ready") throw new ContentApiError(401);
    const valid = () => snapshot.memberId === identity.memberId && snapshot.generation === identity.generation && snapshot.phase === "ready";
    try {
      const result = await operation(current);
      if (!valid()) throw new DOMException("Session changed", "AbortError");
      return result;
    } catch (error) {
      if (error instanceof ContentApiError && error.status === 401 && valid()) {
        if (access === current) { accessRejected = true; await refresh(); }
        if (retryRead && valid() && access) {
          try {
            const result = await operation(access);
            if (!valid()) throw new DOMException("Session changed", "AbortError");
            return result;
          } catch (nextError) {
            if (nextError instanceof ContentApiError && nextError.status === 401 && valid()) clear("anonymous");
            throw nextError;
          }
        }
      }
      throw error;
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    observeAccess(fn: (value: Readonly<MemberAccess> | null) => void) { accessListeners.add(fn); fn(snapshot.phase === "ready" && access && !accessRejected && Date.parse(access.expiresAt) > now() ? access : null); return () => { accessListeners.delete(fn); }; },
    forget: () => { withdrawalAccess = null; clear("anonymous"); },
    setConsentStatus(status: NonNullable<MemberSnapshot["consentStatus"]>, memberId: number, generation: number) {
      if (snapshot.phase !== "ready" || snapshot.memberId !== memberId || snapshot.generation !== generation || snapshot.consentStatus === status) return;
      snapshot = { ...snapshot, consentStatus: status }; emit();
    },
    async restore() { if (access && !refreshRequired && Date.parse(access.expiresAt) - now() >= 30_000) return; await refresh(); },
    refresh, checkExpiry,
    complete: () => authenticate("/auth/login/complete"),
    signup: (body: { nickname: string; profileMessage: string; termAgree: boolean; privateAgree: boolean; termsVersion: string; privacyVersion: string }) => authenticate("/auth/signup", body),
    authorized,
    request(path: string, options: Parameters<typeof contentJson>[2] = {}) {
      return authorized(current => contentJson(origin, path, { ...options, access: current.accessToken }, transport), !options.method || options.method === "GET");
    },
    withdraw(body: { acknowledged: boolean; confirmation: string; policyVersion: string }) {
      if (withdrawalFlight) return withdrawalFlight;
      if (!body.acknowledged || body.confirmation !== "탈퇴합니다" || body.policyVersion !== "ym-withdrawal-v1") return Promise.reject(new ContentApiError(400, "WITHDRAWAL_CONFIRMATION_REQUIRED"));
      withdrawalFlight = (async () => {
        if (!access || Date.parse(access.expiresAt) - now() < 30_000) await refresh();
        const current = access;
        if (!current || snapshot.phase !== "ready") throw new ContentApiError(401);
        return lock(async () => {
          const csrf = parseCsrf(await contentJson(origin, "/auth/csrf", {}, transport));
          if (access !== current || snapshot.phase !== "ready") throw new DOMException("Session changed", "AbortError");
          withdrawalAccess = current; clear("withdrawing");
          const generation = snapshot.generation;
          const value = await contentJson(origin, "/members/me/withdrawal", { method: "POST", access: current.accessToken, csrf, body }, transport);
          if (generation !== snapshot.generation || withdrawalAccess !== current) throw new DOMException("Session changed", "AbortError");
          const result = parseWithdrawal(value);
          if (result === "NOT_REQUESTED") throw new ContentApiError(422);
          if (result === "COMPLETED") { withdrawalAccess = null; clear("anonymous"); }
          return result;
        });
      })().finally(() => { withdrawalFlight = null; });
      return withdrawalFlight;
    },
    async withdrawalStatus() {
      const current = withdrawalAccess;
      if (!current || Date.parse(current.expiresAt) <= now()) throw new ContentApiError(401);
      const value = await contentJson(origin, "/members/me/withdrawal", { access: current.accessToken }, transport);
      if (withdrawalAccess !== current) throw new DOMException("Session changed", "AbortError");
      const status = parseWithdrawal(value);
      if (status === "COMPLETED" || status === "NOT_REQUESTED") { withdrawalAccess = null; clear("anonymous"); }
      return status;
    },
    logout() {
      if (logoutFlight) return logoutFlight;
      withdrawalAccess = null;
      clear("ending");
      const generation = snapshot.generation;
      logoutFlight = lock(async () => {
        if (snapshot.generation !== generation) throw new DOMException("Session changed", "AbortError");
        await cookie("/auth/logout"); if (snapshot.generation === generation) { pendingStorage()?.removeItem(pendingKey); clear("anonymous"); }
      })
        .catch(error => { if (snapshot.generation === generation) clear("error"); throw error; })
        .finally(() => { logoutFlight = null; });
      return logoutFlight;
    },
  };
}
export type MemberSession = ReturnType<typeof createMemberSession>;
