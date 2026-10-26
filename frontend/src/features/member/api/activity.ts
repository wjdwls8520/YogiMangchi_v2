import type { MemberSession } from "./session";

export function memberTabVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

// No expiry timer: restore only on initial visible use, a return event, or an explicit cross-tab change.
export function bindMemberActivity(session: MemberSession, page: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
  browser: Pick<Window, "addEventListener" | "removeEventListener">, callback: boolean) {
  let requested = !callback, stopped = false;
  const resume = () => {
    if (stopped || callback || page.visibilityState === "hidden" || !requested && !["ready", "recovering"].includes(session.getSnapshot().phase)) return;
    requested = false;
    void session.restore().catch(error => {
      if (!stopped && error instanceof DOMException && error.name === "AbortError") requested = true;
    });
  };
  page.addEventListener("visibilitychange", resume);
  browser.addEventListener("focus", resume);
  browser.addEventListener("pageshow", resume);
  resume();
  return {
    restore() { requested = true; resume(); },
    cancel() { requested = false; },
    stop() {
      stopped = true;
      page.removeEventListener("visibilitychange", resume);
      browser.removeEventListener("focus", resume);
      browser.removeEventListener("pageshow", resume);
    },
  };
}
