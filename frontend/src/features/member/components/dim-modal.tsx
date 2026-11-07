"use client";

import { useEffect, useId, type ReactNode, type RefObject } from "react";

interface ScrollLockTargetWindow {
  scrollY: number;
  scrollTo: (x: number, y: number) => void;
}

interface ScrollLockTargetDocument {
  body: {
    style: Record<string, string>;
    dataset: Record<string, string | undefined>;
  };
  documentElement: {
    scrollTop?: number;
    style: Record<string, string>;
  };
}

let activeLockCount = 0;
let savedScrollY = 0;

export function lockBodyScroll(
  win: ScrollLockTargetWindow | undefined = typeof window !== "undefined" ? window : undefined,
  doc: ScrollLockTargetDocument | undefined = typeof document !== "undefined" ? (document as unknown as ScrollLockTargetDocument) : undefined,
): number {
  if (!win || !doc) return 0;
  if (activeLockCount === 0) {
    savedScrollY = win.scrollY || doc.documentElement.scrollTop || 0;
    doc.body.dataset.scrollLocked = "true";
    doc.body.dataset.savedScrollY = String(savedScrollY);
    doc.body.style.position = "fixed";
    doc.body.style.top = `-${savedScrollY}px`;
    doc.body.style.left = "0";
    doc.body.style.right = "0";
    doc.body.style.width = "100%";
    doc.body.style.overflow = "hidden";
    doc.documentElement.style.overflow = "hidden";
    doc.documentElement.style.scrollbarWidth = "none";
  }
  activeLockCount += 1;
  return savedScrollY;
}

export function unlockBodyScroll(
  win: ScrollLockTargetWindow | undefined = typeof window !== "undefined" ? window : undefined,
  doc: ScrollLockTargetDocument | undefined = typeof document !== "undefined" ? (document as unknown as ScrollLockTargetDocument) : undefined,
): number {
  if (!win || !doc) return 0;
  if (activeLockCount > 0) {
    activeLockCount -= 1;
  }
  if (activeLockCount === 0) {
    const restoreY = Number(doc.body.dataset.savedScrollY ?? savedScrollY) || 0;
    delete doc.body.dataset.scrollLocked;
    delete doc.body.dataset.savedScrollY;
    doc.body.style.position = "";
    doc.body.style.top = "";
    doc.body.style.left = "";
    doc.body.style.right = "";
    doc.body.style.width = "";
    doc.body.style.overflow = "";
    doc.documentElement.style.overflow = "";
    doc.documentElement.style.scrollbarWidth = "";
    win.scrollTo(0, restoreY);
    return restoreY;
  }
  return savedScrollY;
}

export function resetScrollLockForTest() {
  activeLockCount = 0;
  savedScrollY = 0;
}

export function useDimScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    return () => {
      unlockBodyScroll();
    };
  }, [open]);
}

export function useDialogScrollLock(dialogRef: RefObject<HTMLDialogElement | null>, initialOpen = false) {
  useEffect(() => {
    const el = dialogRef.current;
    if (!el || typeof MutationObserver === "undefined") return;
    let locked = false;
    const sync = () => {
      const isOpen = el.hasAttribute("open") || el.open;
      if (isOpen && !locked) {
        locked = true;
        lockBodyScroll();
      } else if (!isOpen && locked) {
        locked = false;
        unlockBodyScroll();
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["open"] });
    return () => {
      observer.disconnect();
      if (locked) {
        locked = false;
        unlockBodyScroll();
      }
    };
  }, [dialogRef, initialOpen]);
}

export function DimModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = "560px",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  const titleId = useId();
  useDimScrollLock(open);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ym-dim-backdrop is-open"
      data-dim-modal="open"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="ym-dim-panel"
        style={{ maxWidth }}
        onClick={event => event.stopPropagation()}
      >
        <header className="ym-dim-header">
          <div>
            <h2 id={titleId} className="ym-dim-title">{title}</h2>
            {subtitle && <p className="ym-dim-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="ym-dim-close"
            aria-label="모달 닫기"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div className="ym-dim-body">{children}</div>
        {footer && <footer className="ym-dim-footer">{footer}</footer>}
      </div>
    </div>
  );
}
