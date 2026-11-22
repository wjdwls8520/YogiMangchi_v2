"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'area[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'summary:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container || typeof container.querySelectorAll !== "function") return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => {
    if (el.hasAttribute("disabled") || el.getAttribute("aria-hidden") === "true") return false;
    if (el.offsetParent === null && el !== document.activeElement) {
      // In non-layout test environments offsetParent may be null for everything; check computed visibility if available
      if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
      }
    }
    return true;
  });
}

export function computeNextFocusTarget(
  focusables: HTMLElement[],
  activeElement: Element | null,
  shiftKey: boolean,
): HTMLElement | null {
  if (focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const currentIndex = activeElement ? focusables.indexOf(activeElement as HTMLElement) : -1;
  if (shiftKey) {
    if (currentIndex <= 0) return last;
    return null;
  }
  if (currentIndex === -1 || currentIndex >= focusables.length - 1) return first;
  return null;
}

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onEscape?: () => void,
) {
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    previousActiveRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const container = containerRef.current;
    const rafId =
      typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(() => {
            const target = containerRef.current;
            if (!target) return;
            if (target.contains(document.activeElement)) return;
            const focusables = getFocusableElements(target);
            if (focusables.length > 0) {
              focusables[0].focus();
            } else {
              if (!target.hasAttribute("tabindex")) {
                target.setAttribute("tabindex", "-1");
              }
              target.focus();
            }
          })
        : null;

    function handleKeyDown(event: KeyboardEvent) {
      const target = containerRef.current;
      if (!target) return;
      if (event.key === "Escape" && onEscapeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = getFocusableElements(target);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const next = computeNextFocusTarget(focusables, document.activeElement, event.shiftKey);
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      if (rafId !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(rafId);
      }
      document.removeEventListener("keydown", handleKeyDown, true);
      const prev = previousActiveRef.current;
      previousActiveRef.current = null;
      if (prev && prev.isConnected && typeof prev.focus === "function" && container !== prev) {
        try {
          prev.focus();
        } catch {
          // Ignore focus errors when previous node cannot receive focus
        }
      }
    };
  }, [active, containerRef]);
}
