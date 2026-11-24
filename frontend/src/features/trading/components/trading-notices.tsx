"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createNoticeStore, type TradingNotice } from "../api/notices";
import { RequestIdChip } from "../../../components/request-id-copy";

type NoticeActions = { push: (notice: TradingNotice) => number | null; dismiss: (id: number) => void };
const NoticeContext = createContext<NoticeActions>({ push: () => null, dismiss: () => {} });
const empty: readonly never[] = [];

type PopoverElement = HTMLElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

function promotePopover(el: PopoverElement | null, visible: boolean) {
  if (!el || typeof el.showPopover !== "function" || typeof el.hidePopover !== "function") return;
  try {
    const isOpen = typeof el.matches === "function" && el.matches(":popover-open");
    if (!visible) {
      if (isOpen) el.hidePopover();
      return;
    }
    // Re-show so this popover always sits above any newly opened modal <dialog> in the browser Top Layer.
    if (isOpen) el.hidePopover();
    el.showPopover();
  } catch {
    // Ignore browsers without full Popover API support
  }
}

export function TradingNoticeList({ notices, dismiss }: { notices: readonly (TradingNotice & { id: number })[]; dismiss: (id: number) => void }) {
  const popoverRef = useRef<HTMLElement>(null);
  const hasNotices = notices.length > 0;

  useEffect(() => {
    const el = popoverRef.current as PopoverElement | null;
    promotePopover(el, hasNotices);
    if (!hasNotices || typeof MutationObserver === "undefined" || typeof document === "undefined" || !document.body) {
      return;
    }
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const target = mutation.target;
        if (target instanceof HTMLDialogElement && target.open) {
          promotePopover(popoverRef.current as PopoverElement | null, true);
          break;
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => {
      observer.disconnect();
    };
  }, [hasNotices, notices.length]);

  const content = (
    <aside
      ref={popoverRef}
      popover="manual"
      className="trading-notices"
      aria-label="주문 알림"
    >
      {notices.map(notice => (
        <div key={notice.id} className="trading-notice" role={notice.kind === "success" ? "status" : "alert"}>
          <span className="trading-notice-icon" data-kind={notice.kind} aria-hidden="true">
            {notice.kind === "success" ? "✓" : notice.kind === "error" ? "×" : "!"}
          </span>
          <div className="min-w-0">
            <strong>{notice.title}</strong>
            <p>{notice.message}</p>
            {notice.requestId && (
              <div className="mt-1.5">
                <RequestIdChip requestId={notice.requestId} compact dark />
              </div>
            )}
          </div>
          <button type="button" aria-label={`${notice.title} 알림 닫기`} onClick={() => dismiss(notice.id)}>
            ×
          </button>
        </div>
      ))}
    </aside>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(content, document.body);
  }
  return content;
}

export function TradingNoticeProvider({
  identity,
  suppressRender = false,
  children,
}: {
  identity: string;
  suppressRender?: boolean;
  children: ReactNode;
}) {
  const [store] = useState(createNoticeStore);
  const notices = useSyncExternalStore(store.subscribe, store.getSnapshot, () => empty);
  useEffect(() => () => store.clear(), [store, identity]);
  const actions = useMemo(() => ({ push: (notice: TradingNotice) => store.push(notice, identity), dismiss: store.dismiss }), [store, identity]);
  return (
    <NoticeContext.Provider value={actions}>
      {children}
      {!suppressRender && (
        <TradingNoticeList
          notices={notices.filter(notice => notice.identity === identity)}
          dismiss={store.dismiss}
        />
      )}
    </NoticeContext.Provider>
  );
}
export function useTradingNotices() { return useContext(NoticeContext); }
