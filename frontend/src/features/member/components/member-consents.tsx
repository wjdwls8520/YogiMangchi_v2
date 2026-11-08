"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMember } from "./member-provider";
import { usePolicies, PolicyConsentControl } from "./policy-controls";
import { acceptance, parsePolicyState, type ConsentSelection } from "../api/policies";
import { ContentApiError, contentMessage, contentRecovery } from "../api/client";
import { MemberErrorActions } from "./member-error-actions";

function useOwnConsents() {
  const { session, snapshot } = useMember();
  return useQuery({
    queryKey: ["member", "consents", snapshot.memberId, snapshot.generation],
    enabled: snapshot.phase === "ready",
    queryFn: async ({ signal }) =>
      parsePolicyState(await session.request("/members/me/consents", { signal })),
    refetchInterval: 30_000,
  });
}

export function MemberConsentGate({ children }: { children: ReactNode }) {
  const { session, snapshot } = useMember();
  const query = useOwnConsents();

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

  return (
    <>
      {snapshot.phase === "ready" && (query.isError || query.data?.reconsentRequired) && (
        <aside
          className="member-consent-banner flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 bg-blue-50/90 px-6 py-2.5 text-xs font-medium text-gray-800"
          aria-label="필수 정책 동의 상태"
        >
          <span>
            {query.isError
              ? "정책 동의 상태를 확인하지 못했습니다. 회원 모의투자를 사용하기 전에 다시 확인해 주세요."
              : "새로운 필수 동의가 필요합니다. 원문과 이전 동의 버전을 확인해 주세요."}
          </span>
          <Link
            href="/account#policy-consents"
            className="inline-flex h-7 items-center justify-center rounded-full bg-[#0058FF] px-3 text-xs font-bold text-white transition-colors hover:bg-blue-700"
          >
            정책 확인
          </Link>
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
      mine.isError ||
      policies.isFetching ||
      mine.isFetching
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
            ✓ 필수 동의 완료
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
                {mine.data.policies.map(p => (
                  <li key={p.type}>
                    {p.type === "TERMS" ? "이용약관" : "개인정보 동의"} · 이전 동의{" "}
                    {p.lastAcceptedVersion ?? "버전 기록 없음"} · 현재 {p.version}{" "}
                    {p.accepted ? "동의됨" : "동의 필요"}
                  </li>
                ))}
              </ul>
              <PolicyConsentControl
                bundle={policies.data}
                selection={selection}
                onChange={setSelection}
                pending={pending || policies.isFetching || mine.isFetching}
                previous={mine.data}
              />
              <button
                type="button"
                className="member-primary inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0058FF] px-5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                disabled={pending || policies.isFetching || mine.isFetching}
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
                  const agreedVersion = p.lastAcceptedVersion ?? p.version;
                  const agreedAt = p.lastAcceptedAt ?? p.lastAgreedAt;
                  const document = policies.data?.documents[p.type];
                  return (
                    <li
                      key={`summary-${p.type}`}
                      className="rounded-xl border border-gray-200 bg-[#F9FAFB] p-4 text-xs leading-relaxed text-gray-700"
                    >
                      <strong>{label}</strong> · 동의 버전 {agreedVersion} · 동의 시각{" "}
                      {agreedAt ?? "기록 없음"}
                      {document && (
                        <details>
                          <summary>
                            {label} 원문 보기 ({document.version})
                          </summary>
                          <pre className="policy-original">{document.text}</pre>
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
