"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMember } from "./member-provider";
import { usePolicies, PolicyConsentControl } from "./policy-controls";
import { PolicyMarkdownBody } from "./policy-content";
import { acceptance, parsePolicyState, type ConsentSelection } from "../api/policies";
import { ContentApiError, contentMessage, contentRecovery } from "../api/client";
import { MemberErrorActions } from "./member-error-actions";
import { V1IconCheck, V1IconClose } from "./v1-ui";

function formatAgreedAtKst(agreedAt: string | null | undefined): string {
  if (!agreedAt) return "기록 없음";
  const parsed = new Date(agreedAt);
  if (Number.isNaN(parsed.getTime())) return "기록 없음";
  return `${parsed.toLocaleString("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })} KST`;
}

function useOwnConsents(options?: { backgroundPoll?: boolean }) {
  const { session, snapshot } = useMember();
  const isSuspended = snapshot.accountStatus === "SUSPENDED";
  const allowPoll = options?.backgroundPoll !== false && !isSuspended;
  return useQuery({
    queryKey: ["member", "consents", snapshot.memberId, snapshot.generation],
    enabled: snapshot.phase === "ready",
    queryFn: async ({ signal }) =>
      parsePolicyState(await session.request("/members/me/consents", { signal })),
    refetchInterval: allowPoll ? 30_000 : false,
  });
}

export function MemberConsentGate({ children, headless = false }: { children: ReactNode; headless?: boolean }) {
  const { session, snapshot } = useMember();
  const query = useOwnConsents({ backgroundPoll: true });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot.phase !== "ready" || !snapshot.memberId) return;
    session.setConsentStatus(
      query.isError
        ? "unavailable"
        : !query.data
          ? "checking"
          : query.data.reconsentRequired
            ? "required"
            : "accepted",
      snapshot.memberId,
      snapshot.generation,
    );
  }, [session, snapshot.phase, snapshot.memberId, snapshot.generation, query.data, query.isError]);

  const bannerState = query.isError ? "unavailable" : query.data?.reconsentRequired ? "required" : null;
  const bannerKey = bannerState ? `gate:${snapshot.memberId ?? "0"}:${snapshot.generation}:${bannerState}` : null;

  return (
    <>
      {!headless && snapshot.phase === "ready" && snapshot.accountStatus !== "SUSPENDED" && bannerState && dismissedKey !== bannerKey && (
        <aside
          className="member-consent-banner flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 bg-blue-50/90 px-6 py-2.5 text-xs font-medium text-gray-800"
          aria-label="필수 정책 동의 상태"
        >
          <span className="min-w-0 flex-1">
            {query.isError
              ? "정책 동의 상태를 확인하지 못했습니다. 회원 모의투자를 사용하기 전에 다시 확인해 주세요."
              : "약관이 개정되었습니다. 최신 약관을 확인하고 동의해 주세요."}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {query.isError && (
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="inline-flex h-7 items-center justify-center rounded-full border border-blue-200 bg-white px-3 text-xs font-bold text-[#0058FF] transition-colors hover:bg-blue-50"
              >
                다시 확인
              </button>
            )}
            <Link
              href="/account#policy-consents"
              className="inline-flex h-7 items-center justify-center rounded-full bg-[#0058FF] px-3 text-xs font-bold text-white transition-colors hover:bg-blue-700"
            >
              정책 확인
            </Link>
            <button
              type="button"
              onClick={() => setDismissedKey(bannerKey)}
              aria-label="필수 정책 동의 안내 닫기"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-blue-100 hover:text-gray-800"
            >
              <V1IconClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </aside>
      )}
      {children}
    </>
  );
}

export function MemberConsents() {
  const { session, snapshot } = useMember();
  const client = useQueryClient();
  const mine = useOwnConsents();
  const policies = usePolicies();
  const [selection, setSelection] = useState<ConsentSelection>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const [requestError, setRequestError] = useState<ContentApiError | null>(null);

  async function accept() {
    if (
      active.current ||
      !policies.data ||
      !mine.data ||
      policies.isError ||
      mine.isError


    )
      return;
    setError(null);
    setRequestError(null);
    try {
      const body = acceptance(policies.data, selection, mine.data);
      active.current = true;
      setPending(true);
      const state = parsePolicyState(
        await session.request("/members/me/consents", { method: "POST", body }),
      );
      if (state.reconsentRequired) throw new Error();
      const current = session.getSnapshot();
      if (current.memberId !== snapshot.memberId || current.generation !== snapshot.generation)
        return;
      client.setQueryData(
        ["member", "consents", snapshot.memberId, snapshot.generation],
        state,
      );
      session.setConsentStatus("accepted", snapshot.memberId!, snapshot.generation);
      await client.invalidateQueries({ queryKey: ["member", "consents"] });
    } catch (error) {
      setError(contentMessage(error));
      setRequestError(error instanceof ContentApiError ? error : null);
      if (contentRecovery(error) === "policies") setSelection({});
      void policies.refetch();
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  return (
    <section
      id="policy-consents"
      className="member-simulation space-y-4"
      aria-label="필수 정책 동의"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-black text-gray-900">
          <span className="inline-block h-4 w-1.5 rounded-full bg-[#0058FF]" />
          필수 정책 동의
        </h2>
        {!mine.isError && !policies.isError && mine.data && !mine.data.reconsentRequired && (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600">
            <V1IconCheck className="mr-1 h-3.5 w-3.5" />
            <span>필수 동의 완료</span>
          </span>
        )}
      </div>

      {(mine.isPending || policies.isPending) && (
        <p role="status" className="text-xs font-medium text-gray-500">
          동의 원문과 기록을 확인하는 중입니다.
        </p>
      )}
      {(mine.isError || policies.isError) && (
        <p
          className="member-message rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-600"
          role="alert"
        >
          동의 상태를 확인하지 못했습니다.{" "}
          <button
            type="button"
            className="account-refresh underline font-bold"
            onClick={() => {
              void mine.refetch();
              void policies.refetch();
            }}
          >
            다시 조회
          </button>
        </p>
      )}

      {!mine.isError && !policies.isError && mine.data && policies.data && (
        <>
          {mine.data.reconsentRequired ? (
            <div className="space-y-4">
              <ul className="member-note grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                {mine.data.policies.map(p => {
                  const label = p.type === "TERMS" ? "이용약관" : "개인정보처리방침";
                  const statusText = p.accepted
                    ? "최신 약관 동의 완료"
                    : p.lastAcceptedVersion
                      ? "약관이 개정되어 다시 동의가 필요합니다"
                      : "필수 동의가 필요합니다";
                  return (
                    <li key={p.type}>
                      <strong>{label}</strong> · {statusText}
                    </li>
                  );
                })}
              </ul>
              <PolicyConsentControl
                bundle={policies.data}
                selection={selection}
                onChange={setSelection}
                pending={pending}
                previous={mine.data}
              />
              <button
                type="button"
                className="member-primary inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0058FF] px-5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                disabled={pending}
                onClick={() => void accept()}
              >
                {pending ? "동의 기록 중…" : "필수 정책에 동의하기"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p
                role="status"
                className="member-message rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-2.5 text-xs font-bold text-[#0058FF]"
              >
                현재 필요한 정책 동의가 완료되었습니다.
              </p>
              <ul className="member-note grid gap-3 list-none p-0">
                {mine.data.policies.map(p => {
                  const label = p.type === "TERMS" ? "이용약관" : "개인정보처리방침";
                  const agreedAt = p.lastAcceptedAt ?? p.lastAgreedAt;
                  const document = policies.data?.documents[p.type];
                  return (
                    <li
                      key={`summary-${p.type}`}
                      className="rounded-xl border border-gray-200 bg-[#F9FAFB] p-4 text-xs leading-relaxed text-gray-700"
                    >
                      <strong>{label}</strong> · 동의 완료 · {formatAgreedAtKst(agreedAt)}
                      {document && (
                        <details>
                          <summary>{label} 전문 보기</summary>
                          <PolicyMarkdownBody text={document.text} />
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {error && (
        <>
          <p
            role="alert"
            className="member-message rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-600"
          >
            {error}
          </p>
          <MemberErrorActions
            error={requestError}
            checking={pending || policies.isFetching || mine.isFetching}
            onCheck={() => {
              void policies.refetch();
              void mine.refetch();
            }}
          />
        </>
      )}
    </section>
  );
}
