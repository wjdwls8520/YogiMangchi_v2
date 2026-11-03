import Link from "next/link";
import type { MouseEventHandler } from "react";
import { contentRecovery } from "../api/client";

export function MemberErrorActions({ error, onCheck, checking = false, onLogin }: {
  error: unknown; onCheck?: () => void; checking?: boolean; onLogin?: MouseEventHandler<HTMLAnchorElement>;
}) {
  const recovery = contentRecovery(error);
  if (recovery === "login") return <Link href="/login" onClick={onLogin}>소셜 로그인으로 다시 확인</Link>;
  if (!recovery || !onCheck) return null;
  return <button type="button" className="account-refresh" disabled={checking} onClick={onCheck}>{checking ? "확인 중…" : recovery === "policies" ? "최신 정책 원문 다시 조회" : "현재 상태 다시 조회"}</button>;
}
