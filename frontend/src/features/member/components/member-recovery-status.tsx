"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useOptionalMember } from "./member-provider";

export function MemberSuspendedBanner() {
  const ctx = useOptionalMember();
  if (!ctx) return null;
  const { snapshot } = ctx;
  if (snapshot.phase !== "ready" || snapshot.accountStatus !== "SUSPENDED") return null;

  return (
    <aside
      className="ym-suspended-banner"
      role="status"
      aria-label="계정 일시 정지 안내"
      data-suspended-banner="true"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-bold">
          계정이 일시 정지 상태입니다. 모의투자·커뮤니티 등 일반 기능은 제한되며 1:1 이의제기·알림 확인·회원 탈퇴만 이용할 수 있습니다.
        </p>
        {snapshot.suspensionReason && (
          <p className="text-[11px] opacity-90">
            정지 사유: {snapshot.suspensionReason}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link
          href="/support"
          className="inline-flex min-h-9 items-center justify-center rounded-lg bg-[#F6465D] px-3 text-xs font-bold text-white transition-colors hover:opacity-90"
        >
          1:1 이의제기
        </Link>
        <Link
          href="/account#withdrawal"
          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-current/25 px-3 text-xs font-bold transition-colors hover:opacity-80"
        >
          회원 탈퇴
        </Link>
      </div>
    </aside>
  );
}

export function MemberRecoveryStatus() {
  const ctx = useOptionalMember();
  const session = ctx?.session;
  const snapshot = ctx?.snapshot;
  const [readyAt, setReadyAt] = useState(0);

  useEffect(() => {
    if (!session || !snapshot?.recovery) return;
    // Update expired-access/cooldown presentation only. These timers never post Refresh.
    const cooldown = setTimeout(
      () => setReadyAt(snapshot.recovery!.retryAt),
      Math.max(1, snapshot.recovery.retryAt - Date.now() + 1),
    );
    const expiry =
      snapshot.expiresAt && snapshot.phase === "ready"
        ? setTimeout(() => session.checkExpiry(), Math.max(1, Date.parse(snapshot.expiresAt) - Date.now() + 1))
        : undefined;
    return () => {
      clearTimeout(cooldown);
      clearTimeout(expiry);
    };
  }, [session, snapshot?.recovery, snapshot?.expiresAt, snapshot?.phase]);

  if (!session || !snapshot?.recovery) return null;
  const busy = readyAt < snapshot.recovery.retryAt;

  return (
    <aside className="member-recovery-status" aria-label="세션 복구 상태">
      <span className="min-w-0 flex-1">
        {snapshot.recovery.uncertain
          ? snapshot.phase === "ready"
            ? "로그인 갱신 결과를 확인하지 못했습니다. 현재 유효한 로그인으로 이용할 수 있지만, 만료 후에는 다시 로그인해야 합니다. 갱신은 자동 반복하지 않습니다."
            : "로그인 갱신 결과를 확인하지 못했습니다. 중복 갱신을 피하기 위해 자동 반복하지 않습니다. 다시 로그인해 주세요."
          : snapshot.phase === "ready"
            ? "인증 서버가 잠시 응답하지 않습니다. 아직 유효한 로그인 정보는 유지합니다."
            : "세션 복구 대기 중입니다. 인증 확인 전까지 회원 보호 요청과 거래를 중단합니다."}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {snapshot.recovery.retryable && (
          <button
            type="button"
            className="account-refresh min-h-9 rounded-lg border border-current/20 px-3 text-xs font-bold"
            disabled={busy}
            onClick={() => void session.restore().catch(() => {})}
          >
            {busy ? "잠시 후 재확인 가능" : "세션 다시 확인"}
          </button>
        )}
        <Link
          href="/login"
          className="inline-flex min-h-9 items-center justify-center rounded-lg bg-[#0058FF] px-3 text-xs font-bold text-white hover:bg-[#0046CC]"
        >
          로그인 다시 하기
        </Link>
      </div>
    </aside>
  );
}

export function MemberConsentStatusBanner() {
  const ctx = useOptionalMember();
  if (!ctx) return null;
  const { snapshot } = ctx;
  if (snapshot.phase !== "ready") return null;
  if (snapshot.accountStatus === "SUSPENDED") return null;
  if (snapshot.consentStatus !== "required" && snapshot.consentStatus !== "unavailable") return null;

  return (
    <aside
      className="member-consent-banner flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 bg-blue-50/90 px-5 py-2.5 text-xs font-medium text-gray-800"
      aria-label="필수 정책 동의 상태"
    >
      <span>
        {snapshot.consentStatus === "unavailable"
          ? "정책 동의 상태를 확인하지 못했습니다. 회원 모의투자를 사용하기 전에 다시 확인해 주세요."
          : "약관이 개정되었습니다. 최신 약관을 확인하고 동의해 주세요."}
      </span>
      <Link
        href="/account#policy-consents"
        className="inline-flex min-h-8 items-center justify-center rounded-full bg-[#0058FF] px-3.5 text-xs font-bold text-white transition-colors hover:bg-blue-700"
      >
        정책 확인
      </Link>
    </aside>
  );
}

export function MemberGlobalBanners() {
  return (
    <div data-global-banner-slot="below-header" className="w-full">
      <MemberSuspendedBanner />
      <MemberRecoveryStatus />
      <MemberConsentStatusBanner />
    </div>
  );
}
