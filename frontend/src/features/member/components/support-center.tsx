"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMember } from "./member-provider";
import { MemberShell } from "./member-views";
import { contentMessage } from "../api/client";
import {
  SUPPORT_INQUIRY_CATEGORIES,
  mySupportInquiriesPath,
  parseSupportInquiry,
  parseSupportInquiryPage,
  supportCategoryLabel,
  type SupportInquiryCategory,
  type SupportInquiryFilterStatus,
} from "../api/support";

function formatSupportKst(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const kst = new Date(parsed + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}.${m}.${d} ${hh}:${mm}`;
}

export function SupportCenter() {
  const { session, snapshot } = useMember();
  const queryClient = useQueryClient();
  const isLoggedIn = snapshot.phase === "ready";

  const [category, setCategory] = useState<SupportInquiryCategory>("TRADING");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [statusFilter, setStatusFilter] = useState<SupportInquiryFilterStatus>("ALL");
  const [formFeedback, setFormFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const inquiriesQuery = useInfiniteQuery({
    queryKey: ["member", "support-inquiries", statusFilter, snapshot.memberId, snapshot.generation],
    enabled: isLoggedIn,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) =>
      parseSupportInquiryPage(
        await session.request(
          mySupportInquiriesPath({
            status: statusFilter,
            cursorId: pageParam ?? null,
            size: 20,
          }),
          { signal },
        ),
      ),
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const submitMutation = useMutation({
    mutationFn: async (payload: {
      category: SupportInquiryCategory;
      title: string;
      content: string;
    }) =>
      parseSupportInquiry(
        await session.request("/support/inquiries", {
          method: "POST",
          body: payload,
        }),
      ),
    onSuccess: () => {
      setTitle("");
      setContent("");
      setFormFeedback({
        kind: "ok",
        text: "1:1 문의가 접수되었습니다. 관리자가 답변을 등록하면 알림으로 안내해 드립니다.",
      });
      void queryClient.invalidateQueries({ queryKey: ["member", "support-inquiries"] });
    },
    onError: err => {
      setFormFeedback({
        kind: "error",
        text: contentMessage(err),
      });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle || !trimmedContent) {
      setFormFeedback({ kind: "error", text: "문의 제목과 내용을 모두 입력해 주세요." });
      return;
    }
    setFormFeedback(null);
    submitMutation.mutate({
      category,
      title: trimmedTitle,
      content: trimmedContent,
    });
  }

  const items = inquiriesQuery.data?.pages.flatMap(page => page.items) ?? [];

  return (
    <MemberShell
      title="고객센터 · 1:1 문의"
      subtitle="서비스 이용 중 발생한 오류, 계정·모의투자·대회 관련 문의를 남겨주시면 운영팀이 답변해 드립니다."
      variant="wide"
      hideCardHeading
    >
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-[11px] font-extrabold text-[#0058FF]">
              YOGIMANGCHI SUPPORT
            </span>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
              고객센터 · 1:1 문의
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              답변이 등록되면 실시간 알림 벨과 아래 내 문의 내역에서 즉시 확인할 수 있습니다.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold">
            <Link
              href="/terms"
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-600 hover:bg-gray-50"
            >
              이용약관
            </Link>
            <Link
              href="/privacy"
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-600 hover:bg-gray-50"
            >
              개인정보처리방침
            </Link>
          </div>
        </div>

        {!isLoggedIn ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center space-y-4">
            <h3 className="text-lg font-black text-gray-900">로그인 후 1:1 문의를 이용할 수 있습니다</h3>
            <p className="text-sm text-gray-500">
              Google 또는 Kakao 소셜 로그인으로 간편하게 로그인하고 문의 접수 및 답변 알림을 받아보세요.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Link
                href="/login"
                className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0058FF] px-6 text-sm font-bold text-white transition-colors hover:bg-blue-700"
              >
                로그인하러 가기
              </Link>
              <Link
                href="/"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-5 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                홈으로 돌아가기
              </Link>
            </div>
          </section>
        ) : (
          <>
            {/* 1:1 문의 작성 카드 */}
            <section className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-7">
              <h3 className="mb-4 flex items-center gap-2 text-base font-black text-gray-900">
                <span className="inline-block h-4 w-1.5 rounded-full bg-[#0058FF]" />
                새 1:1 문의 작성
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-gray-700">문의 분류</span>
                    <select
                      aria-label="문의 분류"
                      value={category}
                      onChange={e => setCategory(e.target.value as SupportInquiryCategory)}
                      className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
                    >
                      {SUPPORT_INQUIRY_CATEGORIES.map(cat => (
                        <option key={cat.code} value={cat.code}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1.5 flex items-center justify-between text-xs font-bold text-gray-700">
                      <span>제목</span>
                      <span className="text-[11px] font-medium text-gray-400">
                        {title.length} / 160
                      </span>
                    </span>
                    <input
                      type="text"
                      required
                      maxLength={160}
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="문의 제목을 간략히 입력해 주세요"
                      className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-sm font-medium text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between text-xs font-bold text-gray-700">
                    <span>문의 내용</span>
                    <span className="text-[11px] font-medium text-gray-400">
                      {content.length} / 3000
                    </span>
                  </span>
                  <textarea
                    required
                    rows={5}
                    maxLength={3000}
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder="발생한 화면, 시각, 종목명 또는 상세 문의 사항을 적어주시면 빠르게 확인해 드립니다."
                    className="w-full rounded-xl border border-gray-300 bg-white p-3.5 text-sm leading-relaxed text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
                  />
                </label>

                {formFeedback && (
                  <p
                    role={formFeedback.kind === "error" ? "alert" : "status"}
                    className={`rounded-xl px-4 py-3 text-xs font-bold ${
                      formFeedback.kind === "error"
                        ? "border border-red-200 bg-red-50 text-red-600"
                        : "border border-blue-200 bg-blue-50 text-[#0058FF]"
                    }`}
                  >
                    {formFeedback.text}
                  </p>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submitMutation.isPending}
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0058FF] px-6 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submitMutation.isPending ? "접수 중…" : "문의 등록하기"}
                  </button>
                </div>
              </form>
            </section>

            {/* 내 1:1 문의 내역 */}
            <section className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-7 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
                <h3 className="flex items-center gap-2 text-base font-black text-gray-900">
                  <span className="inline-block h-4 w-1.5 rounded-full bg-[#0058FF]" />
                  내 문의 내역 ({items.length})
                </h3>
                <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold">
                  {(
                    [
                      { key: "ALL", label: "전체" },
                      { key: "OPEN", label: "답변 대기" },
                      { key: "ANSWERED", label: "답변 완료" },
                    ] as const
                  ).map(tab => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setStatusFilter(tab.key)}
                      className={`rounded-lg px-3 py-1.5 transition-colors ${
                        statusFilter === tab.key
                          ? "bg-white text-gray-900"
                          : "text-gray-500 hover:text-gray-800"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {inquiriesQuery.isPending ? (
                <div className="space-y-3" aria-busy="true">
                  {[0, 1, 2].map(idx => (
                    <div key={idx} className="h-24 animate-pulse rounded-xl bg-gray-100" />
                  ))}
                </div>
              ) : inquiriesQuery.isError ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-600"
                >
                  <span>문의 내역을 불러오지 못했습니다. {contentMessage(inquiriesQuery.error)}</span>
                  <button
                    type="button"
                    onClick={() => void inquiriesQuery.refetch()}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-100"
                  >
                    다시 시도
                  </button>
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-12 text-center text-sm font-medium text-gray-500">
                  등록된 1:1 문의 내역이 없습니다.
                </div>
              ) : (
                <ul className="space-y-4">
                  {items.map(inquiry => (
                    <li
                      key={inquiry.id}
                      className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-5 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-extrabold ${
                              inquiry.status === "ANSWERED"
                                ? "bg-emerald-50 text-[#0ECB81]"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {inquiry.status === "ANSWERED" ? "답변 완료" : "답변 대기"}
                          </span>
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-[#0058FF]">
                            {supportCategoryLabel(inquiry.category)}
                          </span>
                          <span className="text-[11px] font-medium text-gray-400">
                            #{inquiry.id}
                          </span>
                        </div>
                        <span className="text-xs font-medium text-gray-400">
                          {formatSupportKst(inquiry.createdAt)}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-sm font-black text-gray-900">{inquiry.title}</h4>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                          {inquiry.content}
                        </p>
                      </div>

                      {inquiry.adminReply && (
                        <div className="rounded-xl border border-blue-100 bg-white p-4 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-black text-[#0058FF]">요기망치 운영팀 답변</span>
                            {inquiry.repliedAt && (
                              <span className="text-gray-400">
                                {formatSupportKst(inquiry.repliedAt)}
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                            {inquiry.adminReply}
                          </p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {inquiriesQuery.hasNextPage && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    disabled={inquiriesQuery.isFetchingNextPage}
                    onClick={() => void inquiriesQuery.fetchNextPage()}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {inquiriesQuery.isFetchingNextPage ? "불러오는 중…" : "이전 문의 더보기"}
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </MemberShell>
  );
}
