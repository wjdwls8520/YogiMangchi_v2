"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { ContentApiError, contentMessage, contentOrigin } from "../api/client";
import { createMemberSession, initialMember, type MemberSession } from "../api/session";
import { MemberConsentGate } from "./member-consents";
import { bindMemberActivity } from "../api/activity";

const origin = () => contentOrigin(process.env.NEXT_PUBLIC_CONTENT_SERVER_URL || "http://localhost:8080");
let browserSession: MemberSession | undefined;
const Context = createContext<{ session: MemberSession; origin: string; announce: (type: "changed" | "ended") => void } | null>(null);
export function MemberProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => typeof window === "undefined" ? createMemberSession(origin()) : browserSession ??= createMemberSession(origin()));
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, gcTime: typeof window === "undefined" ? Infinity : 60_000,
    refetchIntervalInBackground: false,
    retry: (count, error) => count < 2 && error instanceof ContentApiError && [0, 500, 502, 503, 504].includes(error.status),
  }, mutations: { retry: false } } }));
  const channel = useRef<BroadcastChannel | null>(null);
  const context = useMemo(() => ({ session, origin: origin(), announce: (type: "changed" | "ended") => channel.current?.postMessage({ type }) }), [session]);
  useEffect(() => {
    let previous = session.getSnapshot();
    const unsubscribe = session.subscribe(() => {
      const next = session.getSnapshot();
      if (next.memberId !== previous.memberId || next.generation !== previous.generation) {
        void client.cancelQueries(); client.removeQueries(); client.getMutationCache().clear();
      }
      previous = next;
    });
    const activity = bindMemberActivity(session, document, window, window.location.pathname === "/auth/callback");
    if (typeof BroadcastChannel !== "undefined") {
      const messages = channel.current = new BroadcastChannel(`yogimangchi:member:${origin()}`);
      messages.onmessage = event => {
        if (event.data?.type !== "changed" && event.data?.type !== "ended") return;
        session.forget();
        if (event.data.type === "changed") activity.restore(); else activity.cancel();
      };
    }
    return () => { unsubscribe(); activity.stop(); channel.current?.close(); channel.current = null; };
  }, [session, client]);
  return <QueryClientProvider client={client}><Context.Provider value={context}><MemberConsentGate>{children}</MemberConsentGate></Context.Provider></QueryClientProvider>;
}
export function useMember() {
  const context = useContext(Context);
  if (!context) throw new Error("MemberProvider required");
  const snapshot = useSyncExternalStore(context.session.subscribe, context.session.getSnapshot, () => initialMember);
  return { ...context, snapshot };
}
export function MemberHeaderAction() {
  const { snapshot } = useMember();
  return <div className="member-session-action"><Link href={snapshot.phase === "ready" ? "/account" : "/login"}>{snapshot.phase === "ready" ? "내 계정" : "로그인"}</Link></div>;
}
export function MemberLogout() {
  const { session, snapshot, announce } = useMember();
  const [error, setError] = useState<string | null>(null);
  async function logout() {
    setError(null);
    const request = session.logout(); announce("ended");
    try { await request; } catch (error) { setError(contentMessage(error)); }
  }
  return <div><button className="member-secondary" type="button" disabled={snapshot.phase === "ending"} onClick={() => void logout()}>{snapshot.phase === "ending" ? "로그아웃 중…" : "로그아웃"}</button>{error && <p className="member-message" role="alert">로그아웃 완료를 확인하지 못했습니다. {error}</p>}</div>;
}
