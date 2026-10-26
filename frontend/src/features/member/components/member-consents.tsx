"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMember } from "./member-provider";
import { usePolicies, PolicyConsentControl } from "./policy-controls";
import { acceptance, parsePolicyState, type ConsentSelection } from "../api/policies";
import { contentMessage } from "../api/client";

function useOwnConsents() {
  const { session, snapshot } = useMember();
  return useQuery({ queryKey: ["member", "consents", snapshot.memberId, snapshot.generation], enabled: snapshot.phase === "ready",
    queryFn: async ({ signal }) => parsePolicyState(await session.request("/members/me/consents", { signal })), refetchInterval: 30_000 });
}
export function MemberConsentGate({ children }: { children: ReactNode }) {
  const { session, snapshot } = useMember(), query = useOwnConsents();
  useEffect(() => {
    if (snapshot.phase !== "ready" || !snapshot.memberId) return;
    session.setConsentStatus(query.isError ? "unavailable" : !query.data ? "checking" : query.data.reconsentRequired ? "required" : "accepted", snapshot.memberId, snapshot.generation);
  }, [session, snapshot.phase, snapshot.memberId, snapshot.generation, query.data, query.isError]);
  return <>{snapshot.phase === "ready" && (query.isError || query.data?.reconsentRequired) && <aside className="member-consent-banner" aria-label="필수 정책 확인"><span>{query.isError ? "정책 동의 상태를 확인하지 못했습니다. 회원 모의투자를 사용하기 전에 다시 확인해 주세요." : "새로운 필수 동의가 필요합니다. 원문과 이전 동의 버전을 확인해 주세요."}</span><Link href="/account#policy-consents">정책 확인</Link></aside>}{children}</>;
}
export function MemberConsents() {
  const { session, snapshot } = useMember(), client = useQueryClient(), mine = useOwnConsents(), policies = usePolicies();
  const [selection, setSelection] = useState<ConsentSelection>({}), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  async function accept() {
    if (active.current || !policies.data || !mine.data || policies.isError || mine.isError) return;
    setError(null);
    try {
      const body = acceptance(policies.data, selection, mine.data);
      active.current = true; setPending(true);
      const state = parsePolicyState(await session.request("/members/me/consents", { method: "POST", body }));
      if (state.reconsentRequired) throw new Error();
      const current = session.getSnapshot();
      if (current.memberId !== snapshot.memberId || current.generation !== snapshot.generation) return;
      client.setQueryData(["member","consents",snapshot.memberId,snapshot.generation], state);
      session.setConsentStatus("accepted", snapshot.memberId!, snapshot.generation);
      await client.invalidateQueries({ queryKey: ["member", "consents"] });
    } catch (error) { setError(contentMessage(error)); void policies.refetch(); }
    finally { active.current = false; setPending(false); }
  }
  return <section id="policy-consents" className="member-simulation"><h2>필수 정책 동의</h2>
    {(mine.isPending || policies.isPending) && <p role="status">동의 원문과 기록을 확인하는 중입니다.</p>}
    {(mine.isError || policies.isError) && <p className="member-message" role="alert">동의 상태를 확인하지 못했습니다. <button className="account-refresh" onClick={() => { void mine.refetch(); void policies.refetch(); }}>다시 조회</button></p>}
    {!mine.isError && !policies.isError && mine.data && policies.data && <>
      <ul className="member-note">{mine.data.policies.map(p => <li key={p.type}>{p.type === "TERMS" ? "이용약관" : "개인정보 동의"} · 이전 동의 {p.lastAcceptedVersion ?? "버전 기록 없음"} · 현재 {p.version} {p.accepted ? "동의됨" : "동의 필요"}</li>)}</ul>
      {mine.data.reconsentRequired ? <><PolicyConsentControl bundle={policies.data} selection={selection} onChange={setSelection} pending={pending} previous={mine.data} /><button type="button" className="member-primary" disabled={pending} onClick={() => void accept()}>{pending ? "동의 기록 중…" : "필수 정책에 동의하기"}</button></> : <p role="status" className="member-message">현재 필요한 정책 동의가 완료되었습니다.</p>}
    </>}{error && <p role="alert" className="member-message">{error}</p>}
  </section>;
}
