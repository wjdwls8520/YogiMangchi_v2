"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createNoticeStore, type TradingNotice } from "../api/notices";

type NoticeActions = { push: (notice: TradingNotice) => void };
const NoticeContext = createContext<NoticeActions>({ push: () => {} });
const empty: readonly never[] = [];

// Keep notifications within the active modal's accessible layer and above its backdrop.
function activeLayer() { return document.querySelector("dialog[open]") ?? document.body; }
function subscribeDialog(listener: () => void) {
  document.addEventListener("toggle", listener, true);
  document.addEventListener("close", listener, true);
  return () => { document.removeEventListener("toggle", listener, true); document.removeEventListener("close", listener, true); };
}

export function TradingNoticeList({ notices, dismiss }: { notices: readonly (TradingNotice & { id: number })[]; dismiss: (id: number) => void }) {
  const target = useSyncExternalStore(subscribeDialog, activeLayer, () => null);
  const content = <aside className="trading-notices" aria-label="주문 알림">{notices.map(notice =>
    <div key={notice.id} className="trading-notice" role={notice.kind === "success" ? "status" : "alert"}>
      <span className="trading-notice-icon" data-kind={notice.kind} aria-hidden="true">{notice.kind === "success" ? "✓" : notice.kind === "error" ? "×" : "!"}</span>
      <div><strong>{notice.title}</strong><p>{notice.message}</p></div>
      <button type="button" aria-label={`${notice.title} 알림 닫기`} onClick={() => dismiss(notice.id)}>×</button>
    </div>)}</aside>;
  return target ? createPortal(content, target) : content;
}

export function TradingNoticeProvider({ identity, children }: { identity: string; children: ReactNode }) {
  const [store] = useState(createNoticeStore);
  const notices = useSyncExternalStore(store.subscribe, store.getSnapshot, () => empty);
  useEffect(() => () => store.clear(), [store, identity]);
  const actions = useMemo(() => ({ push: (notice: TradingNotice) => store.push(notice, identity) }), [store, identity]);
  return <NoticeContext.Provider value={actions}>{children}<TradingNoticeList notices={notices.filter(notice => notice.identity === identity)} dismiss={store.dismiss} /></NoticeContext.Provider>;
}
export function useTradingNotices() { return useContext(NoticeContext); }
