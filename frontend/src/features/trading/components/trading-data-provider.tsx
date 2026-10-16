"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { retryTradingQuery } from "../api/client";
import { createGuestSession, initialSession, type GuestSession } from "../api/guest-session";
import { GuestAccessProvider } from "./guest-access";

const SessionContext = createContext<GuestSession | null>(null);
let browserSession: GuestSession | undefined;
function getSession() {
  const origin = process.env.NEXT_PUBLIC_TRADING_SERVER_URL || "http://127.0.0.1:8081";
  if (typeof window === "undefined") return createGuestSession(origin, () => { throw new Error("Browser storage required"); });
  return browserSession ??= createGuestSession(origin, () => window.localStorage, fetch, Date.now, () => window.sessionStorage);
}

export function bindGuestCache(client: QueryClient, session: GuestSession) {
  return session.subscribe(() => {
    const current = session.getSnapshot();
    const filters = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] === "trading-account"
      && (query.queryKey[1] !== current.accountId || query.queryKey[2] !== current.generation) };
    void client.cancelQueries(filters);
    client.removeQueries(filters);
    client.getMutationCache().clear();
  });
}

export function TradingDataProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: {
    staleTime: 15_000, gcTime: 60_000, retry: retryTradingQuery,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
  } } }));
  const [session] = useState(getSession);
  useEffect(() => {
    const unsubscribe = bindGuestCache(client, session);
    const restore = () => { void session.restore(); };
    const syncStorage = (event: StorageEvent) => { if (event.key === null || event.key === session.storageKey) restore(); };
    window.addEventListener("storage", syncStorage);
    window.addEventListener("focus", restore);
    restore();
    return () => { unsubscribe(); window.removeEventListener("storage", syncStorage); window.removeEventListener("focus", restore); };
  }, [client, session]);
  return <QueryClientProvider client={client}><SessionContext.Provider value={session}><GuestAccessProvider session={session}>{children}</GuestAccessProvider></SessionContext.Provider></QueryClientProvider>;
}

export function useGuestSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("TradingDataProvider required");
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, () => initialSession);
  return { session, snapshot };
}
