"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMember } from "./member-provider";
import { ContentApiError, contentMessage, oauthUrl } from "../api/client";
import { clearWithdrawalIntent, readWithdrawalIntent, saveWithdrawalIntent } from "../api/withdrawal-intent";
import { WithdrawalConfirmation } from "./withdrawal-confirmation";

export function MemberWithdrawal() {
  const { origin, session, snapshot, announce } = useMember(), dialog = useRef<HTMLDialogElement>(null), active = useRef(false);
  const failures = useRef(0);
  const [owner, setOwner] = useState<number | null>(null);
  const [ready, setReady] = useState(false), [acknowledged, setAcknowledged] = useState(false), [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [receipt, setReceipt] = useState<"PENDING" | "COMPLETED" | "UNCERTAIN" | "NOT_REQUESTED" | null>(null);
  const status = useCallback(async (silent = false) => {
    if (active.current) return;
    active.current = true; if (!silent) setPending(true);
    try {
      const result = await session.withdrawalStatus(); failures.current = 0; setReceipt(result); setError(null);
      if (result === "COMPLETED") { clearWithdrawalIntent(); announce("ended"); }
    } catch (error) { failures.current = error instanceof ContentApiError && [401, 403, 404, 422].includes(error.status) ? 3 : failures.current + 1; setError(contentMessage(error)); }
    finally { active.current = false; setPending(false); }
  }, [session, announce]);
  useEffect(() => {
    if (snapshot.phase !== "withdrawing") return;
    const timer = setInterval(() => { if (document.visibilityState !== "hidden" && failures.current < 3) void status(true); }, 5000);
    return () => clearInterval(timer);
  }, [snapshot.phase, status]);
  async function withdraw(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || owner !== snapshot.memberId || !ready || !acknowledged || confirmation !== "탈퇴합니다" || snapshot.phase !== "ready") return;
    active.current = true; setPending(true); setError(null);
    try {
      announce("ended");
      const result = await session.withdraw({ acknowledged, confirmation, policyVersion: "ym-withdrawal-v1" });
      setReceipt(result); clearWithdrawalIntent(); dialog.current?.close();
    } catch (error) {
      setError(contentMessage(error));
      if (session.getSnapshot().phase === "withdrawing") { setReceipt("UNCERTAIN"); dialog.current?.close(); }
    } finally { active.current = false; setPending(false); }
  }
  return <section className="member-simulation" aria-label="회원 탈퇴">
    {snapshot.phase === "ready" && <button type="button" className="account-refresh" onClick={() => {
      const intent = readWithdrawalIntent(); setOwner(snapshot.memberId); setReceipt(null); failures.current = 0; setReady(!!intent?.returned && intent.memberId === snapshot.memberId); clearWithdrawalIntent();
      setAcknowledged(false); setConfirmation(""); setError(null); dialog.current?.showModal();
    }}>회원 탈퇴</button>}
    {((receipt && (snapshot.memberId === null || owner === snapshot.memberId)) || snapshot.phase === "withdrawing") && <><h2>탈퇴 진행 상태</h2><p className="member-message" role="status">{receipt === "COMPLETED" ? "Trading 정리와 개인정보 제거가 완료되었습니다. 같은 소셜 계정으로 새로 가입할 수 있으며 이전 회원 ID·회차·자산은 복구하거나 이전하지 않습니다."
      : receipt === "NOT_REQUESTED" ? "서버에서 접수된 탈퇴 요청을 찾지 못했습니다. 로그인 상태를 다시 확인한 뒤 시도해 주세요."
      : receipt === "UNCERTAIN" ? "탈퇴 요청 결과를 확인하지 못했습니다. 새 요청을 반복하지 않고 서버의 진행 상태를 확인합니다."
      : "탈퇴 요청을 접수했습니다. Trading 주문·포지션 정리와 개인정보 제거를 진행 중이며 아직 완료되지 않았습니다."}</p>
      {snapshot.phase === "withdrawing" && <button className="member-secondary" disabled={pending} onClick={() => void status()}>{pending ? "조회 중…" : "진행 상태 확인"}</button>}
      {receipt === "NOT_REQUESTED" && <button className="member-secondary" onClick={() => void session.restore().catch(() => {})}>로그인 상태 다시 확인</button>}
    </>}
    {error && <p role="alert" className="member-message">{error}{snapshot.phase === "withdrawing" && " 상태 조회 인증이 만료되면 로그인 화면에서 처리 상태를 다시 확인해 주세요."}</p>}
    <dialog key={snapshot.memberId} ref={dialog} className="position-close-dialog member-withdrawal-dialog" aria-labelledby="member-withdraw-title" onCancel={event => { if (pending) event.preventDefault(); }}>
      <WithdrawalConfirmation ready={ready && owner === snapshot.memberId} pending={pending} acknowledged={acknowledged} confirmation={confirmation} onAcknowledge={setAcknowledged} onConfirmation={setConfirmation} onSubmit={event => void withdraw(event)} onCancel={() => dialog.current?.close()} error={error} />
      {!ready && snapshot.memberId && <div className="member-actions">{(["google", "kakao"] as const).map(provider => <a key={provider} className="member-secondary" href={oauthUrl(origin, provider)} onClick={event => {
        try { saveWithdrawalIntent(snapshot.memberId!); } catch { event.preventDefault(); setError("본인 확인을 위한 임시 상태를 저장하지 못했습니다. 브라우저 저장 설정을 확인해 주세요."); }
      }}>{provider === "google" ? "Google" : "Kakao"}로 본인 확인</a>)}</div>}
    </dialog>
  </section>;
}
