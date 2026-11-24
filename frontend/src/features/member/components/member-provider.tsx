"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { ContentApiError, contentMessage, contentOrigin } from "../api/client";
import { createMemberSession, initialMember, type MemberSession } from "../api/session";
import { MemberConsentGate } from "./member-consents";
import { bindMemberActivity } from "../api/activity";
import { NotificationCenterProvider } from "../notifications/notification-context";
import { resolveContentOrigin } from "../../../lib/api-origins";

const PUBLIC_MARKET_QUERY_ROOTS = new Set([
  "portal-redis-market-overview",
  "portal-redis-tickers",
  "community-sidebar-contest-seasons",
  "community-sidebar-contest-top5",
  "contest-sidebar-member-profile",
]);

const ANONYMOUS_FEED_QUERY_ROOTS = new Set([
  "portal-news",
  "portal-posts",
]);

/**
 * 세션 전환 시 공개·비개인화 시세/카탈로그 쿼리는 유지해 불필요한 2중 재요청을 막고,
 * 초기 익명→로그인 복구(null -> memberId)에서는 기존 익명 피드 캐시를 남겨 placeholderData로
 * 스켈레톤 재깜빡임을 방지한다. 로그아웃 또는 계정 전환 시에는 모든 개인화 쿼리를 즉시 제거한다.
 */
export function shouldPreserveQueryOnSessionChange(
  queryKey: readonly unknown[],
  previousMemberId: number | null,
  nextMemberId: number | null,
): boolean {
  const root = typeof queryKey[0] === "string" ? queryKey[0] : "";
  if (PUBLIC_MARKET_QUERY_ROOTS.has(root)) {
    return true;
  }
  if (root === "trading" && queryKey[1] === "symbols") {
    return true;
  }
  if (previousMemberId === null && nextMemberId !== null && ANONYMOUS_FEED_QUERY_ROOTS.has(root)) {
    return true;
  }
  return false;
}

const origin = () => contentOrigin(resolveContentOrigin());
let browserSession: MemberSession | undefined;
const Context = createContext<{ session: MemberSession; origin: string; announce: (type: "changed" | "ended") => void; retryConsents: () => void } | null>(null);
export function MemberProvider({ children, session: provided, client: providedClient }: { children: ReactNode; session?: MemberSession; client?: QueryClient }) {
  const [session] = useState(() => provided ?? (typeof window === "undefined" ? createMemberSession(origin()) : browserSession ??= createMemberSession(origin())));
  const [client] = useState(() => providedClient ?? new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, gcTime: typeof window === "undefined" ? Infinity : 60_000,
    refetchIntervalInBackground: false,
    retry: (count, error) => count < 2 && error instanceof ContentApiError && [0, 500, 502, 503, 504].includes(error.status),
  }, mutations: { retry: false } } }));
  const channel = useRef<BroadcastChannel | null>(null);
  const context = useMemo(() => ({ session, origin: origin(), retryConsents: () => { void client.invalidateQueries({queryKey:["member","consents"]}); }, announce: (type: "changed" | "ended") => channel.current?.postMessage({ type }) }), [session, client]);
  useEffect(() => {
    let previous = session.getSnapshot();
    const unsubscribe = session.subscribe(() => {
      const next = session.getSnapshot();
      if (next.memberId !== previous.memberId || next.generation !== previous.generation) {
        const prevMemberId = previous.memberId;
        const nextMemberId = next.memberId;
        const shouldPurge = (query: { queryKey: readonly unknown[] }) =>
          !shouldPreserveQueryOnSessionChange(query.queryKey, prevMemberId, nextMemberId);
        void client.cancelQueries({ predicate: shouldPurge });
        client.removeQueries({ predicate: shouldPurge });
        client.getMutationCache().clear();
      }
      previous = next;
    });
    const activity = bindMemberActivity(session, document, window, window.location.pathname === "/auth/callback", true);
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
  return <QueryClientProvider client={client}><Context.Provider value={context}><MemberConsentGate headless><NotificationCenterProvider>{children}</NotificationCenterProvider></MemberConsentGate></Context.Provider></QueryClientProvider>;
}
export function useMember() {
  const context = useContext(Context);
  if (!context) throw new Error("MemberProvider required");
  const snapshot = useSyncExternalStore(context.session.subscribe, context.session.getSnapshot, context.session.getSnapshot);
  return useMemo(() => ({ ...context, snapshot }), [context, snapshot]);
}
const noopSubscribe = () => () => {};
const getInitialMember = () => initialMember;
export function useOptionalMember() {
  const context = useContext(Context);
  const snapshot = useSyncExternalStore(
    context ? context.session.subscribe : noopSubscribe,
    context ? context.session.getSnapshot : getInitialMember,
    context ? context.session.getSnapshot : getInitialMember,
  );
  return useMemo(() => (context ? { ...context, snapshot } : null), [context, snapshot]);
}
export function MemberHeaderAction() {
  const { snapshot } = useMember();
  return (
    <div className="member-session-action">
      <Link
        href={snapshot.phase === "ready" ? "/me" : "/login"}
        className="inline-flex h-9 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-200"
      >
        {snapshot.phase === "ready" ? "마이페이지" : "로그인"}
      </Link>
    </div>
  );
}
export function MemberLogout() {
  const { session, snapshot, announce } = useMember();
  const [error, setError] = useState<string | null>(null);
  async function logout() {
    setError(null);
    try {
      await session.logout();
      announce("ended");
    } catch (error) {
      setError(contentMessage(error));
    }
  }
  return <div><button className="member-secondary" type="button" disabled={snapshot.phase === "ending"} onClick={() => void logout()}>{snapshot.phase === "ending" ? "로그아웃 중…" : "로그아웃"}</button>{error && <p className="member-message" role="alert">로그아웃 완료를 확인하지 못했습니다. {error}</p>}</div>;
}
