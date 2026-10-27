"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useMember } from "../../member/components/member-provider";
import { MemberTradingPrompt } from "./member-trading-prompt";
import { initialSession, type GuestSession, type SessionSnapshot } from "../api/guest-session";

const GuestAccessContext = createContext<{ snapshot: SessionSnapshot; open: () => void } | null>(null);

export function GuestAccessProvider({ session, children }: { session: GuestSession; children: ReactNode }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, () => initialSession);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const active = useRef(false);
  const [failed, setFailed] = useState(false);
  function close() { dialog.current?.close(); }
  function restoreFocus() {
    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    else document.getElementById("guest-header-status")?.focus({ preventScroll: true });
  }
  function open() {
    if (snapshot.phase === "loading" || snapshot.phase === "creating" || snapshot.phase === "ready" || dialog.current?.open) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFailed(false);
    dialog.current?.showModal();
  }
  async function start() {
    if (active.current) return;
    active.current = true;
    setFailed(false);
    try {
      if (snapshot.mode === "member") {
        if (snapshot.phase === "anonymous") await session.createMember(); else await session.restore();
      } else await session.createGuest();
      if (session.getSnapshot().phase === "ready") close();
      else setFailed(!(snapshot.mode === "member" && snapshot.phase !== "anonymous" && session.getSnapshot().phase === "anonymous"));
    } finally { active.current = false; }
  }
  useEffect(() => { if (snapshot.phase === "ready") close(); }, [snapshot.phase]);
  return <GuestAccessContext.Provider value={{ snapshot, open }}>{children}
    <GuestStartDialog member={snapshot.mode === "member"} dialogRef={dialog} creating={snapshot.phase === "creating"} failed={failed} onStart={() => void start()} onCancel={close} onClose={restoreFocus} />
  </GuestAccessContext.Provider>;
}

function useGuestAccess() {
  const access = useContext(GuestAccessContext);
  if (!access) throw new Error("GuestAccessProvider required");
  return access;
}

export function GuestHeaderAction() {
  const { snapshot } = useGuestAccess();
  return snapshot.phase === "ready" ? <div className="guest-header-action">
    <span id="guest-header-status" tabIndex={-1} className="preview-label" role="status">{snapshot.mode === "member" ? "회원 선물" : "Guest 모의투자"} · #{snapshot.accountId}</span>
  </div> : null;
}

export function GuestStartPrompt() {
  const { snapshot, open } = useGuestAccess();
  const member = useMember();
  if (snapshot.mode === "checking" || (member.snapshot.phase === "recovering" || member.snapshot.recovery)) return <MemberTradingPrompt member={member.snapshot} retry={() => void member.session.restore().catch(() => {})} retryConsents={member.retryConsents} />;
  if (snapshot.mode === "member") return <div className="guest-entry-prompt"><p>{snapshot.phase === "loading" || snapshot.phase === "creating" ? "회원 선물 계정과 현재 회차를 확인하는 중입니다." : snapshot.authRequired ? "거래 서버에서 회원 인증을 확인하지 못했습니다. 로그인 상태 또는 거래 서버 인증 설정을 확인해 주세요." : snapshot.phase === "error" ? "회원 선물 계정을 확인하지 못했습니다. 서버 연결과 회원 인증 설정을 확인해 주세요." : "회원 계정 준비 상태를 확인해 주세요. 신규 계정은 서버가 1회차를 10,000 USDT로 시작하며 Guest 자금과 분리됩니다."}</p><button type="button" className="guest-start-button" disabled={snapshot.phase === "loading" || snapshot.phase === "creating" || snapshot.authRequired} onClick={open}>회원 선물 계정 확인</button>{snapshot.authRequired && <Link className="account-refresh" href="/login">로그인 다시 확인</Link>}</div>;
  return <GuestEntryPrompt onStart={open} busy={snapshot.phase === "loading" || snapshot.phase === "creating"} storageError={snapshot.phase === "error"} />;
}

export function GuestStartDialog({ dialogRef, creating, failed, onStart, onCancel, onClose, member = false }: {
  dialogRef: RefObject<HTMLDialogElement | null>; creating: boolean; failed: boolean;
  onStart: () => void; onCancel: () => void; onClose: () => void; member?: boolean;
}) {
  return <dialog ref={dialogRef} className="guest-start-dialog" aria-modal="true" aria-labelledby="guest-start-heading" aria-describedby="guest-start-description"
    onCancel={(event) => { if (creating) event.preventDefault(); }} onClose={onClose}>
    <h2 id="guest-start-heading">{member ? "회원 선물 계정 열기" : "게스트 모의투자 시작"}</h2>
    <div id="guest-start-description">
      {member ? <><p>회원 계정과 현재 회차를 서버에서 확인합니다. 신규 계정의 1회차 시작 자금은 10,000 USDT이며 기존 계정 잔액은 자동 변경하지 않습니다.</p><p>Guest의 체험 자산과 금융 이력을 가져오거나 초기화하지 않습니다.</p></> : <>
      <p>10,000 USDT의 가상 자산으로 실제 자금 없이 모의투자를 체험할 수 있습니다.</p>
      <p>모의투자 기록은 같은 브라우저에서 최대 7일간 유지됩니다. 다른 브라우저나 기기에서는 복구할 수 없습니다.</p>
      <p>브라우저 데이터를 삭제하거나 기간이 만료되면 복구할 수 없습니다.</p>
      </>}
    </div>
    {failed && <p role="alert" className="order-warning">{member ? "회원 계정을 열지 못했습니다. 서버 연결과 인증 설정을 확인한 뒤 다시 시도해 주세요." : "계정을 생성하지 못했습니다. 연결과 브라우저 저장소 설정을 확인한 뒤 다시 시도해 주세요."}</p>}
    <div className="guest-dialog-actions">
      <button type="button" className="guest-cancel" disabled={creating} onClick={onCancel}>취소</button>
      <button type="button" className="guest-start-button" disabled={creating} onClick={onStart}>{creating ? member ? "계정 확인 중…" : "계정 생성 중…" : member ? "회원 계정 준비 확인" : "10,000 USDT로 시작하기"}</button>
    </div>
  </dialog>;
}

export function GuestEntryPrompt({ onStart, busy, storageError }: { onStart: () => void; busy: boolean; storageError: boolean }) {
  return <div className="guest-entry-prompt">
    <div className="guest-entry-balance"><span>시작 가상 자산</span><strong>10,000 <small>USDT</small></strong></div>
    <p>{storageError ? "브라우저 저장소를 확인할 수 없습니다. 저장소 설정을 확인해 주세요." : busy ? "게스트 계정을 확인하는 중입니다." : "실시간 시세로 주문하고 포지션을 관리해 보세요."}</p>
    <button type="button" className="guest-start-button" disabled={busy} onClick={onStart}>게스트로 모의투자 시작</button>
  </div>;
}
