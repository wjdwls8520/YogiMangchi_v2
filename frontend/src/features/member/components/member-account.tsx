"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { contentMessage } from "../api/client";
import { parseOwnProfile } from "../api/contracts";
import { nicknameIssue } from "../api/nickname";
import { useMember, MemberLogout } from "./member-provider";
import { MemberShell, ProfileEditForm } from "./member-views";
import { MemberWithdrawal } from "./member-withdrawal";
import { MemberConsents } from "./member-consents";
import { TradingDataProvider } from "../../trading/components/trading-data-provider";
import { MemberSimulation } from "../../trading/components/member-simulation";

export function MemberAccount() {
  const { session, snapshot } = useMember(), client = useQueryClient();
  const [pending, setPending] = useState(false), [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const profile = useQuery({ queryKey: ["member", "own", snapshot.memberId, snapshot.generation], enabled: snapshot.phase === "ready",
    queryFn: async ({ signal }) => parseOwnProfile(await session.request("/members/me", { signal }), snapshot.memberId!),
  });
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (active.current || snapshot.phase !== "ready") return;
    const data = new FormData(event.currentTarget), nickname = String(data.get("nickname") ?? ""), profileMessage = String(data.get("profileMessage") ?? "");
    const nicknameChanged = nickname !== profile.data?.nickname;
    const nicknameError = nicknameChanged ? nicknameIssue(nickname) : null;
    if (nicknameError || profileMessage.length > 255) { setError(nicknameError ?? "소개는 최대 255자로 입력해 주세요."); return; }
    active.current = true; setPending(true); setError(null); setMessage(null);
    try {
      parseOwnProfile(await session.request("/members/me/profile", { method: "PATCH", body: { ...(nicknameChanged ? { nickname } : {}), profileMessage } }), snapshot.memberId!);
      await client.invalidateQueries({ queryKey: ["member"] }); setMessage("프로필을 저장했습니다.");
    } catch (error) { setError(contentMessage(error)); }
    finally { active.current = false; setPending(false); }
  }
  return <MemberShell title="내 계정">
    {snapshot.phase !== "ready" ? <><p role="status" className="member-message">{snapshot.phase === "loading" || snapshot.phase === "authenticating" ? "로그인 상태를 확인하는 중입니다." : snapshot.phase === "recovering" ? "세션 복구 대기 중입니다. 기존 회원 정보는 보존하며 보호 요청은 인증 확인 후 재개합니다." : snapshot.phase === "error" ? "회원 연결을 확인하지 못했습니다." : snapshot.phase === "withdrawing" ? "탈퇴 진행 상태를 확인하는 중입니다. 완료 전까지 회원 기능은 중단됩니다." : "로그인이 필요합니다."}</p>{snapshot.phase !== "withdrawing" && <Link href="/login">로그인</Link>}{snapshot.phase === "error" && <div className="member-actions"><button className="member-secondary" onClick={() => void session.restore().catch(() => {})}>로그인 다시 확인</button><MemberLogout /></div>}</> : <>
      {profile.isPending && <p role="status">프로필을 불러오는 중입니다.</p>}
      {profile.isError && <p role="alert" className="member-message">{contentMessage(profile.error)} <button className="account-refresh" onClick={() => void profile.refetch()}>다시 조회</button></p>}
      {profile.data && <><p className="member-note">회원 #{profile.data.memberId} · {profile.data.role}</p><div className="member-actions"><Link href={`/members/${profile.data.memberId}`}>공개 프로필·팔로우 보기</Link><MemberLogout /></div>
        <ProfileEditForm key={`${profile.data.nickname}:${profile.data.profileMessage}`} nickname={profile.data.nickname} message={profile.data.profileMessage} pending={pending} onSubmit={event => void save(event)} />
        <p className="member-note">Guest 모의투자와 회원 선물 계정은 별개이며 기록을 자동 합치지 않습니다.</p>
        <MemberConsents />{snapshot.consentStatus === "accepted" && <TradingDataProvider><MemberSimulation /></TradingDataProvider>}</>}
      {message && <p role="status" className="member-message">{message}</p>}{error && <p role="alert" className="member-message">{error}</p>}
    </>}
    <MemberWithdrawal />
  </MemberShell>;
}
