import Link from "next/link";
import type { MemberSnapshot } from "../../member/api/session";

export function MemberTradingPrompt({ member, retry, retryConsents }: { member: MemberSnapshot; retry: () => void; retryConsents: () => void }) {
  const consent = member.phase === "ready" ? member.consentStatus : undefined;
  const failed = consent === "unavailable" || member.phase === "error";
  const recovering = member.phase === "recovering" || !!member.recovery;
  return <div className="guest-entry-prompt"><p role="status">{recovering ? "세션 복구 대기 · 인증 확인 전에는 회원 거래를 제출할 수 없습니다." : consent === "required" ? "로그인되었습니다. 회원 거래를 시작하려면 최신 필수 정책을 확인하고 동의해 주세요."
    : consent === "unavailable" ? "로그인은 확인했지만 정책 동의 상태를 조회하지 못했습니다."
    : consent === "checking" ? "로그인 완료 · 필수 정책 동의 상태를 확인하고 있습니다."
    : member.phase === "withdrawing" ? "탈퇴 진행 상태를 확인 중입니다."
    : failed ? "로그인 상태를 확인하지 못했습니다." : "회원 로그인 상태를 확인하는 중입니다."}</p>
    {consent === "required" && <Link className="guest-start-button" href="/account#policy-consents">필수 정책 확인·동의</Link>}
    {failed && <button className="account-refresh" onClick={consent === "unavailable" ? retryConsents : retry}>다시 확인</button>}
    {recovering && <Link className="account-refresh" href="/login">세션 상태·로그인 확인</Link>}
  </div>;
}
