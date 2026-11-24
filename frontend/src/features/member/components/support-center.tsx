"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMember } from "./member-provider";
import { MemberShell } from "./member-views";
import { DimModal } from "./dim-modal";
import { contentMessage } from "../api/client";
import { parseOwnProfile } from "../api/contracts";
import { RequestIdChip } from "../../../components/request-id-copy";
import { getErrorRequestId, isUnexpectedApiError } from "../../../lib/request-id";
import {
  SUPPORT_INQUIRY_CATEGORIES,
  mySupportInquiriesPath,
  parseSupportInquiry,
  parseSupportInquiryPage,
  supportCategoryLabel,
  type SupportInquiry,
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
  const [formFeedback, setFormFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
    requestId?: string;
  } | null>(null);

  const [editingInquiry, setEditingInquiry] = useState<SupportInquiry | null>(null);
  const [editCategory, setEditCategory] = useState<SupportInquiryCategory>("TRADING");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState<{ text: string; requestId?: string } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<SupportInquiry | null>(null);
  const [deleteError, setDeleteError] = useState<{ text: string; requestId?: string } | null>(null);
  const [closeBusyId, setCloseBusyId] = useState<number | null>(null);
  const [listActionFeedback, setListActionFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
    requestId?: string;
  } | null>(null);

  const ownProfileQuery = useQuery({
    queryKey: ["member", "own", snapshot.memberId, snapshot.generation],
    enabled: isLoggedIn && snapshot.memberId !== null,
    queryFn: async ({ signal }) =>
      parseOwnProfile(await session.request("/members/me", { signal }), snapshot.memberId!),
  });
  const isSuspendedMember =
    ownProfileQuery.data?.status === "SUSPENDED" || snapshot.accountStatus === "SUSPENDED";
  const suspendedReason = ownProfileQuery.data?.suspendedReason ?? snapshot.suspensionReason ?? null;

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
        requestId: getErrorRequestId(err),
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async (payload: {
      id: number;
      category: SupportInquiryCategory;
      title: string;
      content: string;
    }) =>
      parseSupportInquiry(
        await session.request(`/support/inquiries/${payload.id}`, {
          method: "PATCH",
          body: {
            category: payload.category,
            title: payload.title,
            content: payload.content,
          },
        }),
      ),
    onSuccess: () => {
      setEditingInquiry(null);
      setEditError(null);
      setListActionFeedback({ kind: "ok", text: "문의 내용을 수정했습니다." });
      void queryClient.invalidateQueries({ queryKey: ["member", "support-inquiries"] });
    },
    onError: err => {
      setEditError({
        text: contentMessage(err),
        requestId: getErrorRequestId(err),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (inquiryId: number) => {
      await session.request(`/support/inquiries/${inquiryId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteError(null);
      setListActionFeedback({ kind: "ok", text: "접수 대기 중인 문의를 취소(삭제)했습니다." });
      void queryClient.invalidateQueries({ queryKey: ["member", "support-inquiries"] });
    },
    onError: err => {
      setDeleteError({
        text: contentMessage(err),
        requestId: getErrorRequestId(err),
      });
    },
  });

  async function handleCloseInquiry(inquiry: SupportInquiry) {
    if (closeBusyId !== null) return;
    setCloseBusyId(inquiry.id);
    setListActionFeedback(null);
    try {
      await session.request(`/support/inquiries/${inquiry.id}/close`, {
        method: "POST",
      });
      setListActionFeedback({ kind: "ok", text: `문의 #${inquiry.id}을(를) 종료했습니다.` });
      await queryClient.invalidateQueries({ queryKey: ["member", "support-inquiries"] });
    } catch (err) {
      setListActionFeedback({
        kind: "error",
        text: contentMessage(err),
        requestId: getErrorRequestId(err),
      });
    } finally {
      setCloseBusyId(null);
    }
  }

  function openEditModal(inquiry: SupportInquiry) {
    setEditingInquiry(inquiry);
    setEditCategory(
      (SUPPORT_INQUIRY_CATEGORIES.some(c => c.code === inquiry.category)
        ? inquiry.category
        : "GENERAL") as SupportInquiryCategory,
    );
    setEditTitle(inquiry.title);
    setEditContent(inquiry.content);
    setEditError(null);
  }

  function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingInquiry || editMutation.isPending) return;
    const trimmedTitle = editTitle.trim();
    const trimmedContent = editContent.trim();
    if (!trimmedTitle || !trimmedContent) {
      setEditError({ text: "문의 제목과 내용을 모두 입력해 주세요." });
      return;
    }
    setEditError(null);
    editMutation.mutate({
      id: editingInquiry.id,
      category: editCategory,
      title: trimmedTitle,
      content: trimmedContent,
    });
  }

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
            <div className="flex flex-wrap justify-center gap-2.5 pt-2">
              <Link
                href="/login"
                className="inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-[#0058FF] px-5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
              >
                로그인하러 가기
              </Link>
              <Link
                href="/"
                className="inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-gray-300 bg-white px-5 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                홈으로 돌아가기
              </Link>
            </div>
          </section>
        ) : (
          <>
            {isSuspendedMember && (
              <section
                role="status"
                data-suspended-appeal-banner="true"
                className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-xs sm:text-sm text-amber-900 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="font-black text-amber-950">
                    계정 일시 정지 안내 — 1:1 이의제기 접수 가능
                  </strong>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCategory("ACCOUNT")}
                      className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 cursor-pointer"
                    >
                      계정/이의제기 분류 선택
                    </button>
                    <Link
                      href="/account#withdrawal"
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                    >
                      회원 탈퇴 바로가기
                    </Link>
                  </div>
                </div>
                <p className="leading-relaxed">
                  현재 계정은 운영 정책에 따라 일시 정지 상태입니다. 일반 거래 및 커뮤니티 작성은 제한되지만, 아래 1:1 문의 폼에서 이의제기를 접수하고 운영팀 답변을 확인하실 수 있습니다.
                </p>
                {suspendedReason ? (
                  <p className="font-bold text-amber-800">정지 사유: {suspendedReason}</p>
                ) : null}
              </section>
            )}

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
                      className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold text-gray-900 focus:border-[#0058FF]"
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
                      className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-sm font-medium text-gray-900 placeholder-gray-400 focus:border-[#0058FF]"
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
                    className="w-full rounded-xl border border-gray-300 bg-white p-3.5 text-sm leading-relaxed text-gray-900 placeholder-gray-400 focus:border-[#0058FF]"
                  />
                </label>

                {formFeedback && (
                  <div
                    role={formFeedback.kind === "error" ? "alert" : "status"}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-xs font-bold ${
                      formFeedback.kind === "error"
                        ? "border border-red-200 bg-red-50 text-red-600"
                        : "border border-blue-200 bg-blue-50 text-[#0058FF]"
                    }`}
                  >
                    <span>{formFeedback.text}</span>
                    {formFeedback.requestId ? (
                      <RequestIdChip requestId={formFeedback.requestId} />
                    ) : null}
                  </div>
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
                <div
                  role="tablist"
                  aria-label="내 문의 상태 필터"
                  className="flex flex-wrap items-center gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold"
                >
                  {(
                    [
                      { key: "ALL", label: "전체" },
                      { key: "OPEN", label: "답변 대기" },
                      { key: "ANSWERED", label: "답변 완료" },
                      { key: "CLOSED", label: "종료됨" },
                    ] as const
                  ).map(tab => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={statusFilter === tab.key}
                      onClick={() => setStatusFilter(tab.key)}
                      className={`min-h-8 rounded-lg px-3 py-1.5 transition-colors ${
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

              {listActionFeedback && (
                <div
                  role={listActionFeedback.kind === "error" ? "alert" : "status"}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-xs font-bold ${
                    listActionFeedback.kind === "error"
                      ? "border border-red-200 bg-red-50 text-red-600"
                      : "border border-blue-200 bg-blue-50 text-[#0058FF]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{listActionFeedback.text}</span>
                    {listActionFeedback.requestId && (
                      <RequestIdChip requestId={listActionFeedback.requestId} />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setListActionFeedback(null)}
                    className="rounded px-2 py-0.5 text-[11px] font-bold hover:bg-black/5"
                  >
                    닫기
                  </button>
                </div>
              )}

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
                  <div className="flex flex-wrap items-center gap-2">
                    <span>문의 내역을 불러오지 못했습니다. {contentMessage(inquiriesQuery.error)}</span>
                    {isUnexpectedApiError(inquiriesQuery.error) ? (
                      <RequestIdChip requestId={getErrorRequestId(inquiriesQuery.error)} />
                    ) : null}
                  </div>
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
                                ? "bg-emerald-50 text-bull"
                                : inquiry.status === "CLOSED"
                                  ? "bg-gray-200 text-gray-600"
                                  : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {inquiry.status === "ANSWERED"
                              ? "답변 완료"
                              : inquiry.status === "CLOSED"
                                ? "종료됨"
                                : "답변 대기"}
                          </span>
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-[#0058FF]">
                            {supportCategoryLabel(inquiry.category)}
                          </span>
                          <span className="text-[11px] font-medium text-gray-400">
                            #{inquiry.id}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                          <span>{formatSupportKst(inquiry.createdAt)}</span>
                          {inquiry.closedAt && (
                            <span className="text-[11px] font-medium text-gray-500">
                              (종료 {formatSupportKst(inquiry.closedAt)})
                            </span>
                          )}
                        </div>
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

                      {inquiry.status !== "CLOSED" && (
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200/70 pt-3">
                          {inquiry.status === "OPEN" && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(inquiry)}
                                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-xs font-bold text-gray-700 hover:bg-gray-50"
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteTarget(inquiry);
                                  setDeleteError(null);
                                }}
                                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-600 hover:bg-rose-100"
                              >
                                문의 취소(삭제)
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            disabled={closeBusyId === inquiry.id}
                            onClick={() => void handleCloseInquiry(inquiry)}
                            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-gray-300 bg-gray-100 px-3 text-xs font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                          >
                            {closeBusyId === inquiry.id ? "종료 중…" : "문의 종료"}
                          </button>
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

      {/* 문의 수정 모달 */}
      <DimModal
        open={editingInquiry !== null}
        onClose={() => !editMutation.isPending && setEditingInquiry(null)}
        title="1:1 문의 수정"
        subtitle="답변 대기 상태의 문의만 수정할 수 있습니다."
        maxWidth="540px"
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-gray-700">문의 분류</span>
            <select
              value={editCategory}
              onChange={e => setEditCategory(e.target.value as SupportInquiryCategory)}
              className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold text-gray-900"
            >
              {SUPPORT_INQUIRY_CATEGORIES.map(cat => (
                <option key={cat.code} value={cat.code}>
                  {cat.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-gray-700">제목</span>
            <input
              type="text"
              required
              maxLength={160}
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-sm font-medium text-gray-900"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-gray-700">문의 내용</span>
            <textarea
              required
              rows={5}
              maxLength={3000}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-white p-3.5 text-sm leading-relaxed text-gray-900"
            />
          </label>
          {editError && (
            <div role="alert" className="space-y-1.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-600">
              <p>{editError.text}</p>
              {editError.requestId && <RequestIdChip requestId={editError.requestId} />}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={editMutation.isPending}
              onClick={() => setEditingInquiry(null)}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-4 text-xs font-bold text-gray-700 hover:bg-gray-200"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={editMutation.isPending}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#0058FF] px-5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {editMutation.isPending ? "저장 중…" : "수정 저장"}
            </button>
          </div>
        </form>
      </DimModal>

      {/* 문의 삭제 확인 모달 */}
      <DimModal
        open={deleteTarget !== null}
        onClose={() => !deleteMutation.isPending && setDeleteTarget(null)}
        title="문의를 취소(삭제)할까요?"
        subtitle={deleteTarget ? `#${deleteTarget.id} · ${deleteTarget.title}` : undefined}
        maxWidth="440px"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => setDeleteTarget(null)}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-4 text-xs font-bold text-gray-700 hover:bg-gray-200"
            >
              취소
            </button>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#F6465D] px-4 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              {deleteMutation.isPending ? "삭제 중…" : "삭제 확인"}
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            답변 대기 중인 1:1 문의를 삭제하면 복구할 수 없습니다. 정말로 취소하시겠습니까?
          </p>
          {deleteError && (
            <div role="alert" className="space-y-1.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-600">
              <p>{deleteError.text}</p>
              {deleteError.requestId && <RequestIdChip requestId={deleteError.requestId} />}
            </div>
          )}
        </div>
      </DimModal>
    </MemberShell>
  );
}
