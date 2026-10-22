"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ContentApiError, contentJson, contentMessage, oauthUrl } from "../api/client";
import { parseFlow, validNickname } from "../api/contracts";
import { useMember } from "./member-provider";
import { MemberLoginView, MemberShell, SignupForm } from "./member-views";

export function policyUrl(value: string | undefined) {
  if (!value) return null;
  if (value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function MemberLogin() {
  const { origin, snapshot } = useMember();
  return <MemberShell title="로그인">{snapshot.phase === "ready" ? <p className="member-message">로그인되어 있습니다. <Link href="/account">내 계정으로 이동</Link></p>
    : <MemberLoginView google={oauthUrl(origin, "google")} kakao={oauthUrl(origin, "kakao")} />}</MemberShell>;
}
export function MemberCallback() {
  const { origin, session, snapshot, announce } = useMember(), router = useRouter();
  const [flow, setFlow] = useState<ReturnType<typeof parseFlow> | null>(null), [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false);
  const active = useRef(false);
  const flowGeneration = useRef<number | null>(null);
  useEffect(() => { if (snapshot.phase === "ready") router.replace("/account"); }, [snapshot.phase, router]);
  useEffect(() => {
    const controller = new AbortController();
    const generation = session.getSnapshot().generation;
    void (async () => {
      try {
        const value = parseFlow(await contentJson(origin, "/auth/flow", { signal: controller.signal }));
        if (controller.signal.aborted || generation !== session.getSnapshot().generation) return;
        flowGeneration.current = generation;
        setFlow(value);
        if (value.status === "LOGIN_READY") { await session.complete(); if (!controller.signal.aborted) { announce("changed"); router.replace("/account"); } }
      } catch (error) { if (!controller.signal.aborted) setError(contentMessage(error)); }
    })();
    return () => controller.abort();
  }, [origin, session, announce, router]);
  async function signup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (active.current) return;
    if (flowGeneration.current !== session.getSnapshot().generation) { setError("로그인 상태가 변경되었습니다. 다시 로그인해 주세요."); return; }
    const fields = new FormData(event.currentTarget), nickname = String(fields.get("nickname") ?? ""), profileMessage = String(fields.get("profileMessage") ?? "");
    if (!validNickname(nickname) || profileMessage.length > 255 || !fields.has("termAgree") || !fields.has("privateAgree")) {
      setError("닉네임은 공백·특수문자 없이 1~8자로 입력하고 필수 동의를 확인해 주세요."); return;
    }
    active.current = true; setPending(true); setError(null);
    try { await session.signup({ nickname, profileMessage, termAgree: true, privateAgree: true }); announce("changed"); router.replace("/account"); }
    catch (error) {
      setError(contentMessage(error));
      if (error instanceof ContentApiError && [400, 409].includes(error.status)) {
        const generation = session.getSnapshot().generation;
        try {
          const current = parseFlow(await contentJson(origin, "/auth/flow"));
          if (generation === session.getSnapshot().generation && session.getSnapshot().phase !== "ready") { flowGeneration.current = generation; setFlow(current); }
        } catch { /* A consumed/expired proof requires a fresh OAuth login. */ }
      }
    }
    finally { active.current = false; setPending(false); }
  }
  return <MemberShell title={flow?.status === "SIGNUP_REQUIRED" ? "회원가입" : "로그인 확인"}>
    {error && <p role="alert" className="member-message">{error}</p>}
    {!flow && !error && <p role="status" className="member-message">로그인을 확인하는 중입니다. 계속 진행되지 않으면 <Link href="/login">다시 로그인</Link>해 주세요.</p>}
    {flow?.status === "LOGIN_READY" && !error && <p role="status" className="member-message">로그인을 완료하는 중입니다.</p>}
    {flow?.status === "SIGNUP_REQUIRED" && snapshot.phase !== "ready" && <><p className="member-message">{flow.provider} · {flow.accountHint} 계정을 확인했습니다. 닉네임과 가입 동의를 입력해 주세요.</p><SignupForm onSubmit={event => void signup(event)} pending={pending} terms={policyUrl(process.env.NEXT_PUBLIC_TERMS_URL)} privacy={policyUrl(process.env.NEXT_PUBLIC_PRIVACY_URL)} /></>}
    {error && <Link href="/login">로그인으로 돌아가기</Link>}
  </MemberShell>;
}
