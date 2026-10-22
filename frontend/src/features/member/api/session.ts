import { ContentApiError, contentJson } from "./client";
import { parseAccess, parseCsrf, type MemberAccess } from "./contracts";

export type MemberSnapshot = { phase: "loading" | "anonymous" | "authenticating" | "ready" | "ending" | "error";
  memberId: number | null; nickname: string; expiresAt: string | null; generation: number };
export const initialMember: MemberSnapshot = { phase: "loading", memberId: null, nickname: "", expiresAt: null, generation: 0 };
export type CookieLock = <T>(operation: () => Promise<T>) => Promise<T>;
export function browserCookieLock(origin: string): CookieLock {
  return async operation => {
    if (typeof navigator === "undefined" || !navigator.locks) throw new ContentApiError(0);
    return await navigator.locks.request(`yogimangchi:content-cookie:${origin}`, operation);
  };
}

// Access exists only in this closure. Snapshots, cache keys, browser storage and errors contain no tokens.
export function createMemberSession(origin: string, transport: typeof fetch = fetch, now = Date.now, lock = browserCookieLock(origin)) {
  let snapshot = initialMember, access: MemberAccess | null = null;
  let refreshFlight: Promise<void> | null = null, authFlight: Promise<void> | null = null, logoutFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>(), accessListeners = new Set<(value: Readonly<MemberAccess> | null) => void>();
  const emit = () => { listeners.forEach(fn => fn()); accessListeners.forEach(fn => fn(access)); };
  function clear(phase: MemberSnapshot["phase"]) {
    access = null;
    snapshot = { ...initialMember, phase, generation: snapshot.generation + 1 }; emit();
  }
  function accept(value: unknown, generation: number) {
    if (snapshot.generation !== generation) throw new DOMException("Session changed", "AbortError");
    const parsed = parseAccess(value);
    if (Date.parse(parsed.expiresAt) <= now()) throw new ContentApiError(401);
    const changed = snapshot.memberId !== parsed.memberId;
    access = Object.freeze(parsed);
    snapshot = { phase: "ready", memberId: parsed.memberId, nickname: parsed.nickname, expiresAt: parsed.expiresAt,
      generation: snapshot.generation + (changed ? 1 : 0) }; emit();
  }
  async function cookie(path: string, body?: object) {
    const csrf = parseCsrf(await contentJson(origin, "/auth/csrf", {}, transport));
    return contentJson(origin, path, { method: "POST", csrf, body }, transport);
  }
  function refresh() {
    if (refreshFlight) return refreshFlight;
    if (logoutFlight || snapshot.phase === "ending") return Promise.reject(new ContentApiError(401));
    if (!access && snapshot.phase !== "loading") clear("loading");
    const generation = snapshot.generation;
    refreshFlight = lock(async () => {
      if (snapshot.generation !== generation) throw new DOMException("Session changed", "AbortError");
      accept(await cookie("/auth/refresh"), generation);
    }).catch(error => {
      if (snapshot.generation === generation) clear(error instanceof ContentApiError && error.status === 401 ? "anonymous" : "error");
      throw error;
    }).finally(() => { refreshFlight = null; });
    return refreshFlight;
  }
  function authenticate(path: "/auth/signup" | "/auth/login/complete", body?: object) {
    if (authFlight) return authFlight;
    if (logoutFlight) return Promise.reject(new ContentApiError(401));
    clear("authenticating");
    const generation = snapshot.generation;
    authFlight = lock(async () => {
      if (snapshot.generation !== generation) throw new DOMException("Session changed", "AbortError");
      accept(await cookie(path, body), generation);
    })
      .catch(error => { if (snapshot.generation === generation) clear(error instanceof ContentApiError && error.status === 401 ? "anonymous" : "error"); throw error; })
      .finally(() => { authFlight = null; });
    return authFlight;
  }
  async function authorized<T>(operation: (access: Readonly<MemberAccess>) => Promise<T>, retryRead = false): Promise<T> {
    if (!access || Date.parse(access.expiresAt) - now() < 30_000) await refresh();
    const identity = snapshot, current = access;
    if (!current || identity.phase !== "ready") throw new ContentApiError(401);
    const valid = () => snapshot.memberId === identity.memberId && snapshot.generation === identity.generation && snapshot.phase === "ready";
    try {
      const result = await operation(current);
      if (!valid()) throw new DOMException("Session changed", "AbortError");
      return result;
    } catch (error) {
      if (error instanceof ContentApiError && error.status === 401 && valid()) {
        await refresh();
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
    observeAccess(fn: (value: Readonly<MemberAccess> | null) => void) { accessListeners.add(fn); fn(access); return () => { accessListeners.delete(fn); }; },
    forget: () => clear("anonymous"),
    async restore() { if (access && Date.parse(access.expiresAt) - now() >= 30_000) return; await refresh(); },
    refresh,
    complete: () => authenticate("/auth/login/complete"),
    signup: (body: { nickname: string; profileMessage: string; termAgree: boolean; privateAgree: boolean }) => authenticate("/auth/signup", body),
    authorized,
    request(path: string, options: Parameters<typeof contentJson>[2] = {}) {
      return authorized(current => contentJson(origin, path, { ...options, access: current.accessToken }, transport), !options.method || options.method === "GET");
    },
    logout() {
      if (logoutFlight) return logoutFlight;
      clear("ending");
      const generation = snapshot.generation;
      logoutFlight = lock(async () => {
        if (snapshot.generation !== generation) throw new DOMException("Session changed", "AbortError");
        await cookie("/auth/logout"); if (snapshot.generation === generation) clear("anonymous");
      })
        .catch(error => { if (snapshot.generation === generation) clear("error"); throw error; })
        .finally(() => { logoutFlight = null; });
      return logoutFlight;
    },
  };
}
export type MemberSession = ReturnType<typeof createMemberSession>;
