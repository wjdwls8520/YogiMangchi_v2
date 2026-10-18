"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
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
      await session.createGuest();
      if (session.getSnapshot().phase === "ready") close();
      else setFailed(true);
    } finally { active.current = false; }
  }
  useEffect(() => { if (snapshot.phase === "ready") close(); }, [snapshot.phase]);
  return <GuestAccessContext.Provider value={{ snapshot, open }}>{children}
    <GuestStartDialog dialogRef={dialog} creating={snapshot.phase === "creating"} failed={failed} onStart={() => void start()} onCancel={close} onClose={restoreFocus} />
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
    <span id="guest-header-status" tabIndex={-1} className="preview-label" role="status">Guest 모의투자 · #{snapshot.accountId}</span>
  </div> : null;
}

export function GuestStartPrompt() {
  const { snapshot, open } = useGuestAccess();
  return <GuestEntryPrompt onStart={open} busy={snapshot.phase === "loading" || snapshot.phase === "creating"} storageError={snapshot.phase === "error"} />;
}

export function GuestStartDialog({ dialogRef, creating, failed, onStart, onCancel, onClose }: {
  dialogRef: RefObject<HTMLDialogElement | null>; creating: boolean; failed: boolean;
  onStart: () => void; onCancel: () => void; onClose: () => void;
}) {
  return <dialog ref={dialogRef} className="guest-start-dialog" aria-modal="true" aria-labelledby="guest-start-heading" aria-describedby="guest-start-description"
    onCancel={(event) => { if (creating) event.preventDefault(); }} onClose={onClose}>
    <h2 id="guest-start-heading">게스트 모의투자 시작</h2>
    <div id="guest-start-description">
      <p>10,000 USDT의 가상 자산으로 실제 자금 없이 모의투자를 체험할 수 있습니다.</p>
      <p>모의투자 기록은 같은 브라우저에서 최대 7일간 유지됩니다. 다른 브라우저나 기기에서는 복구할 수 없습니다.</p>
      <p>브라우저 데이터를 삭제하거나 기간이 만료되면 복구할 수 없습니다.</p>
    </div>
    {failed && <p role="alert" className="order-warning">계정을 생성하지 못했습니다. 연결과 브라우저 저장소 설정을 확인한 뒤 다시 시도해 주세요.</p>}
    <div className="guest-dialog-actions">
      <button type="button" className="guest-cancel" disabled={creating} onClick={onCancel}>취소</button>
      <button type="button" className="guest-start-button" disabled={creating} onClick={onStart}>{creating ? "계정 생성 중…" : "10,000 USDT로 시작하기"}</button>
    </div>
  </dialog>;
}

export function GuestEntryPrompt({ onStart, busy, storageError }: { onStart: () => void; busy: boolean; storageError: boolean }) {
  return <div className="guest-entry-prompt">
    <p>{storageError ? "브라우저 저장소를 확인할 수 없습니다. 저장소 설정을 확인해 주세요." : busy ? "게스트 계정을 확인하는 중입니다." : "모의투자를 시작하면 10,000 USDT로 주문 기능을 이용할 수 있습니다."}</p>
    <button type="button" className="guest-start-button" disabled={busy} onClick={onStart}>게스트로 모의투자 시작</button>
  </div>;
}
