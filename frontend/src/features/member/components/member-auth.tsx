"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ContentApiError, contentJson, contentMessage, contentRecovery, oauthUrl } from "../api/client";
import { MemberErrorActions, RecoveredLoginAction } from "./member-error-actions";
import { readLoginRecovery } from "../api/login-recovery";
import { parseFlow, validNickname } from "../api/contracts";
import { useMember } from "./member-provider";
import { MemberLoginView, MemberShell, SignupForm } from "./member-views";
import { V1IconCheck } from "./v1-ui";
import { validPolicyVersion } from "../api/policies";
import { clearWithdrawalIntent, readWithdrawalIntent, saveWithdrawalIntent } from "../api/withdrawal-intent";

export const LOGIN_RETURN_PATH_KEY = "yogimangchi:login-return-to:v1";

type ReturnPathStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isAuthOnlyPath(path: string): boolean {
  return /^\/(login|signup|auth\/callback|account)(\/|$|\?|#)/i.test(path.trim());
}

function resolveReturnPathStorage(storage?: ReturnPathStorage | null): ReturnPathStorage | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  try {
    if (typeof window.sessionStorage?.getItem === "function") {
      return window.sessionStorage;
    }
  } catch {
    // Fallback to localStorage if sessionStorage is unavailable
  }
  try {
    if (typeof window.localStorage?.getItem === "function") {
      return window.localStorage;
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

export function normalizeLoginReturnPath(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "/";
  const trimmed = raw.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("://") ||
    isAuthOnlyPath(trimmed)
  ) {
    return "/";
  }
  return trimmed;
}

export function saveLoginReturnPath(
  path?: string | null,
  storage?: ReturnPathStorage | null,
): string {
  if (!path || typeof path !== "string") return "/";
  const trimmed = path.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("://") ||
    isAuthOnlyPath(trimmed)
  ) {
    return "/";
  }
  const store = resolveReturnPathStorage(storage);
  try {
    store?.setItem(LOGIN_RETURN_PATH_KEY, trimmed);
  } catch {
    // Ignore storage quota errors
  }
  return trimmed;
}

export function clearLoginReturnPath(storage?: ReturnPathStorage | null): void {
  if (storage !== undefined) {
    try {
      storage?.removeItem(LOGIN_RETURN_PATH_KEY);
    } catch {
      // Ignore storage errors
    }
    return;
  }
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.removeItem(LOGIN_RETURN_PATH_KEY);
  } catch {
    // Ignore
  }
  try {
    window.localStorage?.removeItem(LOGIN_RETURN_PATH_KEY);
  } catch {
    // Ignore
  }
}

export function consumeLoginReturnPath(storage?: ReturnPathStorage | null): string {
  const store = resolveReturnPathStorage(storage);
  let raw: string | null = null;
  try {
    raw = store?.getItem(LOGIN_RETURN_PATH_KEY) ?? null;
    if (!raw && storage === undefined && typeof window !== "undefined") {
      raw = window.localStorage?.getItem(LOGIN_RETURN_PATH_KEY) ?? null;
    }
  } catch {
    raw = null;
  }
  clearLoginReturnPath(storage);
  return normalizeLoginReturnPath(raw);
}

function useSafeRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

export function MemberLogin() {
  const { origin, snapshot } = useMember();
  const router = useSafeRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const explicitReturn = params.get("returnTo") ?? params.get("redirect");
    if (explicitReturn && !isAuthOnlyPath(explicitReturn)) {
      saveLoginReturnPath(explicitReturn);
      return;
    }
    try {
      const existing = resolveReturnPathStorage()?.getItem(LOGIN_RETURN_PATH_KEY);
      if (!existing && document.referrer) {
        const refUrl = new URL(document.referrer);
        if (refUrl.origin === window.location.origin) {
          const candidate = `${refUrl.pathname}${refUrl.search}`;
          if (!isAuthOnlyPath(candidate)) {
            saveLoginReturnPath(candidate);
          }
        }
      }
    } catch {
      // Ignore referrer parse errors
    }
  }, []);

  useEffect(() => {
    if (snapshot.phase === "ready" && !snapshot.recovery) {
      const target = consumeLoginReturnPath();
      if (router) {
        router.replace(target);
      } else if (typeof window !== "undefined") {
        window.location.replace(target);
      }
    }
  }, [snapshot.phase, snapshot.recovery, router]);

  return (
    <MemberShell
      title="로그인"
      subtitle="요기망치 계정으로 실시간 속보·커뮤니티·선물 모의투자를 이용하세요"
      variant="auth"
    >
      {snapshot.phase === "ready" && !snapshot.recovery ? (
        <p className="member-message">
          로그인되어 있습니다. <Link href="/me">마이페이지로 이동</Link>하거나 <Link href="/">메인 페이지로 이동</Link>할 수 있습니다.
        </p>
      ) : (
        <MemberLoginView google={oauthUrl(origin, "google")} kakao={oauthUrl(origin, "kakao")} />
      )}
    </MemberShell>
  );
}

export function MemberSignupPage() {
  const { origin, snapshot } = useMember();
  const router = useSafeRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const google = oauthUrl(origin, "google");
  const kakao = oauthUrl(origin, "kakao");

  useEffect(() => {
    if (snapshot.phase === "ready") {
      if (router) {
        router.replace("/");
      } else if (typeof window !== "undefined") {
        window.location.replace("/");
      }
    }
  }, [snapshot.phase, router]);

  function handlePreviewSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("상단 Google 또는 Kakao 본인확인을 먼저 완료하면 입력하신 닉네임과 약관 동의로 즉시 가입이 완료됩니다.");
  }

  if (snapshot.phase === "ready") {
    return (
      <MemberShell
        title="회원가입"
        subtitle="이미 로그인되어 있어 메인 페이지로 이동합니다."
        variant="signup"
      >
        <p role="status" className="member-message">
          이미 로그인되어 있습니다. 메인 페이지로 자동 이동합니다.
        </p>
      </MemberShell>
    );
  }

  return (
    <MemberShell
      title="회원가입"
      subtitle="소셜 본인확인 후 닉네임과 프로필, 필수 약관 동의를 설정하세요."
      variant="signup"
    >
      <div className="identity_verification_wrap" aria-label="소셜 계정 본인인증">
        <div className="ym-verify-icon" aria-hidden="true">
          <V1IconCheck className="h-4 w-4" />
        </div>
        <h2 className="ym-verify-title">소셜 계정 본인인증</h2>
        <p className="ym-verify-desc">
          요기망치는 별도 비밀번호 없이 Google 또는 Kakao OAuth2 본인확인으로 안전하게 가입을 진행합니다.
        </p>
        <div className="ym-verify-btn-group">
          <a href={google} className="ym-dark-verify-btn">
            Google 본인확인 시작
          </a>
          <a href={kakao} className="ym-dark-verify-btn is-kakao-border">
            Kakao 본인확인 시작
          </a>
        </div>
      </div>

      {notice && (
        <p role="status" className="member-message">
          {notice}
        </p>
      )}

      <SignupForm onSubmit={handlePreviewSubmit} pending={false} />
    </MemberShell>
  );
}

export function MemberCallback() {
  const { origin, session, snapshot, announce } = useMember(), router = useRouter();
  const [flow, setFlow] = useState<ReturnType<typeof parseFlow> | null>(null), [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false);
  const active = useRef(false);
  const client = useQueryClient();
  const [requestError, setRequestError] = useState<ContentApiError | null>(null);
  const [checking, setChecking] = useState(false);
  const [completionReady, setCompletionReady] = useState(false);
  const [withdrawalIntent] = useState(readWithdrawalIntent);
  const flowGeneration = useRef<number | null>(null);
  useEffect(() => {
    if (snapshot.phase === "ready" && !withdrawalIntent) {
      router.replace(consumeLoginReturnPath());
    }
  }, [snapshot.phase, router, withdrawalIntent]);
  useEffect(() => {
    const controller = new AbortController();
    const generation = session.getSnapshot().generation;
    void (async () => {
      try {
        const value = parseFlow(await contentJson(origin, "/auth/flow", { signal: controller.signal }));
        if (controller.signal.aborted || generation !== session.getSnapshot().generation) return;
        flowGeneration.current = generation;
        setFlow(value);
        if (withdrawalIntent) {
          if (value.status !== "LOGIN_READY") throw new ContentApiError(401);
          await session.restore();
          if (session.getSnapshot().memberId !== withdrawalIntent.memberId) throw new ContentApiError(401);
          saveWithdrawalIntent(withdrawalIntent.memberId, true);
          router.replace("/account?withdraw=confirm"); return;
        }
        if (value.status === "LOGIN_READY") {
          await session.complete();
          if (!controller.signal.aborted) {
            announce("changed");
            router.replace(consumeLoginReturnPath());
          }
        }
      } catch (error) { if (!controller.signal.aborted) { setError(contentMessage(error)); setRequestError(error instanceof ContentApiError ? error : null); } }
    })();
    return () => controller.abort();
  }, [origin, session, announce, router, withdrawalIntent]);
  async function signup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (active.current) return;
    if (flowGeneration.current !== session.getSnapshot().generation) { setError("로그인 상태가 변경되었습니다. 다시 로그인해 주세요."); return; }
    const fields = new FormData(event.currentTarget), nickname = String(fields.get("nickname") ?? ""), profileMessage = String(fields.get("profileMessage") ?? "");
    const termsVersion = fields.get("termsVersion"), privacyVersion = fields.get("privacyVersion");
    if (!validNickname(nickname) || profileMessage.length > 255 || !fields.has("termAgree") || !fields.has("privateAgree")) {
      setError("닉네임은 공백·특수문자 없이 1~8자로 입력하고 필수 동의를 확인해 주세요."); return;
    }
    if (!validPolicyVersion(termsVersion) || !validPolicyVersion(privacyVersion)) { setError("최신 이용약관과 개인정보 동의 원문을 확인해 주세요."); return; }
    active.current = true; setPending(true); setError(null); setRequestError(null); setCompletionReady(false);
    try {
      await session.signup({ nickname, profileMessage, termAgree: true, privateAgree: true, termsVersion, privacyVersion });
      clearLoginReturnPath();
      announce("changed");
      router.replace("/");
    }
    catch (error) {
      setError(contentMessage(error));
      setRequestError(error instanceof ContentApiError ? error : null);
      if (contentRecovery(error) === "login") setFlow(null);
      if (contentRecovery(error) === "policies") await client.invalidateQueries({ queryKey: ["public-policies", origin] });
      if (error instanceof ContentApiError && [400, 409].includes(error.status)) {
        const generation = session.getSnapshot().generation;
        try {
          const current = await readLoginRecovery(origin);
          if (generation === session.getSnapshot().generation && session.getSnapshot().phase !== "ready") showRecoveredFlow(current, generation);
        } catch (lookupError) { if (contentRecovery(lookupError) === "login") { setFlow(null); setError(contentMessage(lookupError)); setRequestError(lookupError as ContentApiError); } }
      }
    }
    finally { active.current = false; setPending(false); }
  }
  function showRecoveredFlow(current: ReturnType<typeof parseFlow>, generation: number) {
    flowGeneration.current = generation; setFlow(current);
    const ready = current.status === "LOGIN_READY";
    setCompletionReady(ready);
    if (ready) { setError(null); setRequestError(null); }
  }
  async function completeRecoveredLogin() {
    if (active.current || checking || !completionReady || flow?.status !== "LOGIN_READY") return;
    if (flowGeneration.current !== session.getSnapshot().generation) { setCompletionReady(false); setFlow(null); setError("로그인 상태가 변경되었습니다. 소셜 로그인을 다시 진행해 주세요."); return; }
    active.current = true; setPending(true); setError(null); setRequestError(null);
    try {
      if (withdrawalIntent) {
        await session.restore();
        if (session.getSnapshot().memberId !== withdrawalIntent.memberId) throw new ContentApiError(401);
        saveWithdrawalIntent(withdrawalIntent.memberId, true); router.replace("/account?withdraw=confirm");
      } else {
        await session.complete();
        announce("changed");
        router.replace(consumeLoginReturnPath());
      }
    }
    catch (error) {
      setCompletionReady(false); setError(contentMessage(error)); setRequestError(error instanceof ContentApiError ? error : null);
      if (contentRecovery(error) === "login") setFlow(null);
    } finally { active.current = false; setPending(false); }
  }
  async function checkState() {
    if (checking || pending) return;
    setChecking(true);
    try {
      if (contentRecovery(requestError) === "policies") await client.invalidateQueries({ queryKey: ["public-policies", origin] });
      else {
        const generation = session.getSnapshot().generation;
        const current = await readLoginRecovery(origin);
        if (generation === session.getSnapshot().generation && session.getSnapshot().phase !== "ready") showRecoveredFlow(current, generation);
      }
    } catch (error) { setError(contentMessage(error)); setRequestError(error instanceof ContentApiError ? error : null); if (contentRecovery(error) === "login") setFlow(null); }
    finally { setChecking(false); }
  }
  return <MemberShell title={flow?.status === "SIGNUP_REQUIRED" ? "회원가입" : "로그인 확인"} variant="signup">
    {error && <p role="alert" className="member-message">{error}</p>}
    {error && <MemberErrorActions error={requestError} onCheck={() => void checkState()} checking={checking || pending} onLogin={clearWithdrawalIntent} />}
    {!flow && !error && <p role="status" className="member-message">로그인을 확인하는 중입니다. 계속 진행되지 않으면 <Link href="/login">다시 로그인</Link>해 주세요.</p>}
    {completionReady ? <RecoveredLoginAction pending={pending || checking} onComplete={() => void completeRecoveredLogin()} /> : flow?.status === "LOGIN_READY" && !error && <p role="status" className="member-message">로그인을 완료하는 중입니다.</p>}
    {flow?.status === "WITHDRAWAL_PENDING" && <p role="status" className="member-message">이 계정의 탈퇴 정리를 진행 중입니다. 완료 전에는 신규 가입이나 기존 계정 사용을 할 수 없습니다. 완료 후 같은 소셜 계정으로 새로 가입할 수 있으며 과거 자산·회차는 이전되지 않습니다.</p>}
    {flow?.status === "SIGNUP_REQUIRED" && !withdrawalIntent && snapshot.phase !== "ready" && <>
      <div className="identity_verification_wrap is-verified">
        <div className="ym-verify-icon" aria-hidden="true"><V1IconCheck className="h-4 w-4" /></div>
        <h2 className="ym-verify-title">소셜 계정 본인인증 완료</h2>
        <p className="member-message">{flow.provider} · {flow.accountHint} 계정을 확인했습니다. 닉네임과 가입 동의를 입력해 주세요. 탈퇴 후 재가입인 경우 새로운 회원으로 시작하며 기존 자산·이력은 이전되지 않습니다.</p>
      </div>
      <SignupForm onSubmit={event => void signup(event)} pending={pending} />
    </>}
    {error && <Link href="/login" onClick={clearWithdrawalIntent}>로그인으로 돌아가기</Link>}
  </MemberShell>;
}
