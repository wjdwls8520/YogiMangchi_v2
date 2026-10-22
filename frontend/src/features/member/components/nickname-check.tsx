"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMember } from "./member-provider";
import { checkNickname, type NicknameFeedback } from "../api/nickname";

export function NicknameCheck() {
  const { origin } = useMember();
  const request = useRef<AbortController | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null), feedbackId = useId();
  const [pending, setPending] = useState(false), [feedback, setFeedback] = useState<NicknameFeedback | null>(null);
  useEffect(() => {
    const input = buttonRef.current?.form?.elements.namedItem("nickname");
    if (!(input instanceof HTMLInputElement)) return;
    input.setAttribute("aria-describedby", feedbackId);
    const changed = () => { request.current?.abort(); request.current = null; setPending(false); setFeedback(null); };
    input.addEventListener("input", changed);
    return () => { request.current?.abort(); input.removeEventListener("input", changed); input.removeAttribute("aria-describedby"); };
  }, [feedbackId]);
  async function check(button: HTMLButtonElement) {
    const input = button.form?.elements.namedItem("nickname");
    if (!(input instanceof HTMLInputElement) || request.current) return;
    const nickname = input.value;
    const controller = request.current = new AbortController(); setPending(true); setFeedback(null);
    try {
      const result = await checkNickname(origin, nickname, controller.signal);
      if (!controller.signal.aborted && input.value === nickname) setFeedback(result);
    } catch { /* Changed input/unmounted forms cancel their checks without showing stale feedback. */ }
    finally { if (request.current === controller) { setPending(false); request.current = null; } }
  }
  return <div><button ref={buttonRef} type="button" className="member-secondary" disabled={pending} onClick={event => void check(event.currentTarget)}>{pending ? "확인 중…" : "닉네임 중복 확인"}</button>
    <p id={feedbackId} role={feedback && feedback.kind !== "available" ? "alert" : "status"} className={feedback ? "member-message" : undefined}>{feedback?.message}</p></div>;
}
