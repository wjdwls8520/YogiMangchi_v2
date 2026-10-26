"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMember } from "./member-provider";

export function MemberRecoveryStatus() {
  const { session, snapshot } = useMember();
  const [readyAt, setReadyAt] = useState(0);
  useEffect(() => {
    if (!snapshot.recovery) return;
    // Update expired-access/cooldown presentation only. These timers never post Refresh.
    const cooldown = setTimeout(() => setReadyAt(snapshot.recovery!.retryAt), Math.max(1, snapshot.recovery.retryAt - Date.now() + 1));
    const expiry = snapshot.expiresAt && snapshot.phase === "ready" ? setTimeout(() => session.checkExpiry(), Math.max(1, Date.parse(snapshot.expiresAt) - Date.now() + 1)) : undefined;
    return () => { clearTimeout(cooldown); clearTimeout(expiry); };
  }, [session, snapshot.recovery, snapshot.expiresAt, snapshot.phase]);
  if (!snapshot.recovery) return null;
  const busy = readyAt < snapshot.recovery.retryAt;
  return <aside className="member-consent-banner" aria-label="세션 복구 상태">
    <span>{snapshot.recovery.uncertain ? "세션 갱신 응답을 확인하지 못했습니다. 중복 갱신을 피하기 위해 자동 재전송하지 않습니다. 다시 로그인해 주세요."
      : snapshot.phase === "ready" ? "인증 서버가 잠시 응답하지 않습니다. 아직 유효한 로그인 정보는 유지합니다."
      : "세션 복구 대기 중입니다. 인증 확인 전까지 회원 보호 요청과 거래를 중단합니다."}</span>
    {snapshot.recovery.retryable && <button className="account-refresh" disabled={busy} onClick={() => void session.restore().catch(() => {})}>{busy ? "잠시 후 재확인 가능" : "세션 다시 확인"}</button>}
    <Link href="/login">로그인 다시 하기</Link>
  </aside>;
}
