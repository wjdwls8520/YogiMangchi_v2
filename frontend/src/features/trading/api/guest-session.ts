import { tradingJson, TradingApiError } from "./client";
import { parseCredential, parseGuest, type GuestCredential } from "./contracts";

export type SessionSnapshot = { phase: "loading" | "ready" | "error"; accountId: number | null; generation: number };
export const initialSession: SessionSnapshot = { phase: "loading", accountId: null, generation: 0 };
type StorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Token remains private: no React context, query key, query data or error contains it.
export function createGuestSession(origin: string, storage: StorageAccess, transport: typeof fetch = fetch, now = Date.now) {
  const storageKey = `yogimangchi.guest.v1:${origin}`;
  let credential: GuestCredential | null = null;
  let snapshot = initialSession;
  let flight: Promise<void> | null = null;
  let recoveryUsed = false;
  const listeners = new Set<() => void>();
  function publish(phase: SessionSnapshot["phase"]) {
    snapshot = { phase, accountId: phase === "ready" ? credential!.accountId : null, generation: snapshot.generation + 1 };
    listeners.forEach((listener) => listener());
  }
  function usable(value: GuestCredential) { return Date.parse(value.expiresAt) > now(); }
  function clear() { credential = null; storage().removeItem(storageKey); }
  async function bootstrap() {
    try {
      const saved = storage().getItem(storageKey);
      if (!credential && saved) {
        try { credential = parseCredential(JSON.parse(saved)); }
        catch { clear(); }
      }
      if (credential && !usable(credential)) clear();
      if (!credential) {
        // Fail before creating an account if the browser disallows persistence.
        storage().setItem(`${storageKey}.probe`, "1");
        storage().removeItem(`${storageKey}.probe`);
        credential = parseGuest(await tradingJson(origin, "accounts/guest", { method: "POST" }, transport));
        if (!usable(credential)) throw new TradingApiError(401);
      }
      storage().setItem(storageKey, JSON.stringify(credential));
      publish("ready");
    } catch { publish("error"); }
  }
  function start() {
    if (flight) return flight;
    publish("loading");
    flight = bootstrap().finally(() => { flight = null; });
    return flight;
  }
  async function recover(failed: GuestCredential) {
    if (credential !== failed) return flight;
    try {
      clear();
      if (recoveryUsed) { publish("error"); return; }
      recoveryUsed = true;
      await start();
    } catch { publish("error"); }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    ensure() { return snapshot.phase === "loading" && !flight ? start() : (flight ?? Promise.resolve()); },
    retry() {
      // Only an explicit user action may start another bounded recovery cycle.
      if (flight) return flight;
      recoveryUsed = false;
      return start();
    },
    async read(path: "account/summary" | "account/orders/pending" | "account/orders?limit=50", expected: SessionSnapshot, signal: AbortSignal) {
      const current = credential;
      if (!current || snapshot.phase !== "ready" || expected.generation !== snapshot.generation) throw new DOMException("Session changed", "AbortError");
      if (!usable(current)) {
        await recover(current);
        throw new TradingApiError(401);
      }
      try {
        const value = await tradingJson(origin, path, { token: current.accessToken, signal }, transport);
        if (current !== credential || signal.aborted) throw new DOMException("Session changed", "AbortError");
        return value;
      } catch (error) {
        if (error instanceof TradingApiError && error.status === 401) await recover(current);
        throw error;
      }
    },
  };
}
export type GuestSession = ReturnType<typeof createGuestSession>;
