"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DimModal } from "../../member/components/dim-modal";
import { useOptionalMember } from "../../member/components/member-provider";
import { RequestIdChip } from "../../../components/request-id-copy";
import { getErrorRequestId, isUnexpectedApiError } from "../../../lib/request-id";
import { cn, V1IconAlert, V1IconCheck, V1IconRefresh } from "../../member/components/v1-ui";
import {
  type AdminReportDto,
  type AdminReportReasonFilter,
  type AdminReportStatusFilter,
  dismissAdminReport,
  fetchAdminReports,
  formatAdminDateTime,
  moderateAdminReportTarget,
} from "../api/admin-api";
import { AdminShell } from "./admin-layout";

type ReportTargetTypeFilter = "ALL" | "POST" | "COMMENT";
type ReportTargetStatusFilter = "ALL" | "ACTIVE" | "DELETED";

export const ADMIN_REPORT_REASON_LABELS: Record<string, string> = {
  SPAM: "스팸·홍보",
  SEXUAL: "음란물·선정성",
  ILLEGAL: "불법정보",
  YOUTH_HARMFUL: "청소년 유해",
  ABUSE: "욕설·혐오·비방",
  PRIVACY: "개인정보 노출",
  INAPPROPRIATE: "부적절 콘텐츠",
  FRAUD: "사기·리딩방",
  ETC: "기타",
  OTHER: "기타",
};

const REPORT_STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: "대기 (PENDING)",
    className: "border border-amber-200 bg-amber-50 text-amber-800",
  },
  RESOLVED: {
    label: "처리 완료 (RESOLVED)",
    className: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  DISMISSED: {
    label: "반려 (DISMISSED)",
    className: "border border-gray-200 bg-gray-100 text-gray-600",
  },
};

export function AdminReportsView() {
  const memberCtx = useOptionalMember();
  const phase = memberCtx?.snapshot.phase;
  const role = memberCtx?.snapshot.role;
  const generation = memberCtx?.snapshot.generation;
  const session = memberCtx?.session;

  const [items, setItems] = useState<AdminReportDto[]>([]);
  const [page, setPage] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [postReportCount, setPostReportCount] = useState(0);
  const [commentReportCount, setCommentReportCount] = useState(0);
  const [activeTargetReportCount, setActiveTargetReportCount] = useState(0);
  const [pendingReportCount, setPendingReportCount] = useState(0);

  const [targetTypeFilter, setTargetTypeFilter] = useState<ReportTargetTypeFilter>("ALL");
  const [targetStatusFilter, setTargetStatusFilter] =
    useState<ReportTargetStatusFilter>("ALL");
  const [reasonFilter, setReasonFilter] = useState<AdminReportReasonFilter>("ALL");
  const [reportStatusFilter, setReportStatusFilter] =
    useState<AdminReportStatusFilter>("ALL");
  const [keywordInput, setKeywordInput] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ text: string; requestId?: string } | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{
    kind: "success" | "error";
    text: string;
    requestId?: string;
  } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    item: AdminReportDto;
    kind: "DELETE_TARGET" | "CLEAR_REPORTS" | "DISMISS";
  } | null>(null);
  const [modalError, setModalError] = useState<{ text: string; requestId?: string } | null>(null);

  const [settledQueryKey, setSettledQueryKey] = useState<string | null>(null);
  const queryKey = `${generation ?? 0}:${targetTypeFilter}:${targetStatusFilter}:${reasonFilter}:${reportStatusFilter}:${appliedKeyword}:${page}:${reloadTick}`;
  const loadingReports = phase === "ready" && role === "ADMIN" && settledQueryKey !== queryKey;

  useEffect(() => {
    if (phase !== "ready" || role !== "ADMIN" || !session) {
      return;
    }
    const controller = new AbortController();
    void session
      .authorized(
        cred =>
          fetchAdminReports(
            cred.accessToken,
            {
              targetType: targetTypeFilter,
              targetStatus: targetStatusFilter,
              reasonType: reasonFilter,
              reportStatus: reportStatusFilter,
              keyword: appliedKeyword || undefined,
              page,
              size: 20,
            },
            { signal: controller.signal },
          ),
        true,
      )
      .then(res => {
        setLoadError(null);
        setSettledQueryKey(queryKey);
        if (res.totalPages > 0 && page >= res.totalPages) {
          setPage(res.totalPages - 1);
          return;
        }
        setItems(res.content);
        setPage(res.page);
        setTotalElements(res.totalElements);
        setTotalPages(res.totalPages);
        setHasNext(res.hasNext);
        setPostReportCount(res.postReportCount);
        setCommentReportCount(res.commentReportCount);
        setActiveTargetReportCount(res.activeTargetReportCount);
        setPendingReportCount(res.pendingReportCount);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setSettledQueryKey(queryKey);
        setLoadError({
          text: "신고 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
          requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
        });
      });
    return () => controller.abort();
  }, [
    phase,
    role,
    generation,
    session,
    targetTypeFilter,
    targetStatusFilter,
    reasonFilter,
    reportStatusFilter,
    appliedKeyword,
    page,
    reloadTick,
    queryKey,
  ]);

  async function executeConfirmedAction() {
    if (!confirmAction || !session || busyKey !== null) return;
    const { item, kind } = confirmAction;
    setModalError(null);
    setBusyKey(`${kind}:${item.reportKey}`);
    try {
      if (kind === "DISMISS") {
        await session.authorized(cred =>
          dismissAdminReport(
            cred.accessToken,
            item.targetType,
            item.targetId,
            item.reporterId,
          ),
        );
        setBannerMessage({
          kind: "success",
          text: `${item.targetType === "POST" ? "게시글" : "댓글"} #${item.targetId}에 대한 신고자(#${item.reporterId})의 신고를 반려 처리했습니다.`,
        });
      } else {
        await session.authorized(cred =>
          moderateAdminReportTarget(
            cred.accessToken,
            item.targetType,
            item.targetId,
            kind,
          ),
        );
        setBannerMessage({
          kind: "success",
          text:
            kind === "DELETE_TARGET"
              ? `${item.targetType === "POST" ? "게시글" : "댓글"} #${item.targetId}을(를) 소프트 삭제하고 누적 신고를 일괄 정리했습니다.`
              : `${item.targetType === "POST" ? "게시글" : "댓글"} #${item.targetId}의 허위·중복 신고를 일괄 해제했습니다.`,
        });
      }
      setConfirmAction(null);
      setReloadTick(t => t + 1);
    } catch (error) {
      setModalError({
        text: kind === "DISMISS" ? "신고 반려 처리에 실패했습니다." : "대상 제재 처리에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <AdminShell activeSection="reports">
      <div data-admin-reports="true" className="space-y-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full bg-blue-50 px-2.5 text-[11px] font-black text-[#0058FF]">
                ADMIN REPORTS
              </span>
              <span className="text-xs font-semibold text-gray-500">
                신고 접수 통합 조회 · 단건 반려 · 대상 소프트 삭제 및 일괄 제재
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-gray-900">
              커뮤니티 신고 관리 센터
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              게시글 및 댓글에 접수된 모든 신고 사유를 실시간으로 검수하고, 대상 글 소프트 삭제 또는 허위 신고 반려를 즉시 집행합니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setReloadTick(t => t + 1)}
              className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
            >
              <V1IconRefresh className="h-4 w-4 shrink-0" />
              <span>새로고침</span>
            </button>
          </div>
        </div>

        {/* KPI 요약 카드 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-bold text-gray-500">현재 필터 조회 건수</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-gray-900">
              {totalElements.toLocaleString("ko-KR")}건
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-bold text-gray-500">미처리 대기 (PENDING)</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-amber-600">
              {pendingReportCount.toLocaleString("ko-KR")}건
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-bold text-gray-500">활성 대상 미처리 신고</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-[#F6465D]">
              {activeTargetReportCount.toLocaleString("ko-KR")}건
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-bold text-gray-500">게시글 누적 신고</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-[#0058FF]">
              {postReportCount.toLocaleString("ko-KR")}건
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-bold text-gray-500">댓글 누적 신고</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-gray-800">
              {commentReportCount.toLocaleString("ko-KR")}건
            </p>
          </div>
        </div>

        {loadError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3.5 text-xs font-bold text-[#F6465D]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <V1IconAlert className="h-4 w-4 shrink-0" />
              <span>{loadError.text}</span>
              {loadError.requestId && <RequestIdChip requestId={loadError.requestId} />}
            </div>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setReloadTick(t => t + 1);
              }}
              className="shrink-0 whitespace-nowrap rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-bold text-[#F6465D] hover:bg-rose-100"
            >
              다시 시도
            </button>
          </div>
        ) : null}

        {bannerMessage ? (
          <div
            role={bannerMessage.kind === "error" ? "alert" : "status"}
            className={cn(
              "flex items-center justify-between gap-3 rounded-2xl border px-5 py-3.5 text-xs font-bold",
              bannerMessage.kind === "error"
                ? "border-rose-200 bg-rose-50 text-[#F6465D]"
                : "border-blue-200 bg-blue-50/80 text-[#0058FF]",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {bannerMessage.kind === "error" ? (
                <V1IconAlert className="h-4 w-4 shrink-0" />
              ) : (
                <V1IconCheck className="h-4 w-4 shrink-0" />
              )}
              <span>{bannerMessage.text}</span>
              {bannerMessage.requestId && <RequestIdChip requestId={bannerMessage.requestId} />}
            </div>
            <button
              type="button"
              onClick={() => setBannerMessage(null)}
              className="shrink-0 whitespace-nowrap text-gray-500 hover:text-gray-800"
            >
              닫기
            </button>
          </div>
        ) : null}

        {/* 필터 바 */}
        <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-xs lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { key: "ALL", label: "전체 대상" },
                { key: "POST", label: "게시글 신고" },
                { key: "COMMENT", label: "댓글 신고" },
              ] as const
            ).map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setTargetTypeFilter(tab.key);
                  setPage(0);
                }}
                className={cn(
                  "h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-bold transition-colors",
                  targetTypeFilter === tab.key
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                )}
              >
                {tab.label}
              </button>
            ))}

            <select
              value={reportStatusFilter}
              onChange={e => {
                setReportStatusFilter(e.target.value as AdminReportStatusFilter);
                setPage(0);
              }}
              aria-label="신고 처리 상태 필터"
              className="h-9 shrink-0 rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-bold text-gray-700 outline-none focus:border-[#0058FF]"
            >
              <option value="ALL">처리 상태: 전체</option>
              <option value="PENDING">대기 (PENDING)</option>
              <option value="RESOLVED">처리 완료 (RESOLVED)</option>
              <option value="DISMISSED">반려 (DISMISSED)</option>
            </select>

            <select
              value={targetStatusFilter}
              onChange={e => {
                setTargetStatusFilter(e.target.value as ReportTargetStatusFilter);
                setPage(0);
              }}
              aria-label="대상 삭제 상태 필터"
              className="h-9 shrink-0 rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-bold text-gray-700 outline-none focus:border-[#0058FF]"
            >
              <option value="ALL">대상 상태: 전체</option>
              <option value="ACTIVE">대상 상태: 활성(미삭제)</option>
              <option value="DELETED">대상 상태: 삭제됨</option>
            </select>

            <select
              value={reasonFilter}
              onChange={e => {
                setReasonFilter(e.target.value as AdminReportReasonFilter);
                setPage(0);
              }}
              aria-label="신고 사유 필터"
              className="h-9 shrink-0 rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-bold text-gray-700 outline-none focus:border-[#0058FF]"
            >
              <option value="ALL">신고 사유: 전체</option>
              <option value="SPAM">스팸·홍보 (SPAM)</option>
              <option value="SEXUAL">음란물·선정성 (SEXUAL)</option>
              <option value="ILLEGAL">불법정보 (ILLEGAL)</option>
              <option value="YOUTH_HARMFUL">청소년 유해 (YOUTH_HARMFUL)</option>
              <option value="ABUSE">욕설·혐오·비방 (ABUSE)</option>
              <option value="PRIVACY">개인정보 노출 (PRIVACY)</option>
              <option value="INAPPROPRIATE">부적절 콘텐츠 (INAPPROPRIATE)</option>
              <option value="FRAUD">사기·리딩방 (FRAUD)</option>
              <option value="ETC">기타 (ETC)</option>
            </select>
          </div>

          <form
            onSubmit={e => {
              e.preventDefault();
              setAppliedKeyword(keywordInput.trim());
              setPage(0);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="text"
              value={keywordInput}
              onChange={e => setKeywordInput(e.target.value)}
              placeholder="제목·내용·작성자·신고자 닉네임 검색"
              className="h-9 w-64 rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 outline-none focus:border-[#0058FF]"
            />
            <button
              type="submit"
              className="h-9 shrink-0 whitespace-nowrap rounded-xl bg-[#0058FF] px-4 text-xs font-black text-white hover:bg-[#0047D1]"
            >
              검색
            </button>
          </form>
        </div>

        {/* 신고 목록 테이블 */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1360px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-[#F9FAFB] text-[11px] font-black uppercase tracking-wider text-gray-500">
                  <th className="whitespace-nowrap px-4 py-3.5 text-center">구분</th>
                  <th className="whitespace-nowrap px-3 py-3.5">대상 ID</th>
                  <th className="w-[260px] max-w-[260px] whitespace-nowrap px-4 py-3.5">
                    대상 게시글·내용
                  </th>
                  <th className="whitespace-nowrap px-3 py-3.5">대상 작성자</th>
                  <th className="whitespace-nowrap px-3 py-3.5 text-right">대상 누적신고</th>
                  <th className="whitespace-nowrap px-3 py-3.5">신고자</th>
                  <th className="whitespace-nowrap px-3 py-3.5 text-center">신고 사유</th>
                  <th className="whitespace-nowrap px-3 py-3.5 text-center">처리 상태</th>
                  <th className="whitespace-nowrap px-3 py-3.5 text-center">대상 상태</th>
                  <th className="whitespace-nowrap px-3 py-3.5">신고 일시</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loadingReports && items.length === 0 ? (
                  [1, 2, 3, 4].map(idx => (
                    <tr key={`rep-sk-${idx}`}>
                      <td colSpan={11} className="px-4 py-3.5">
                        <div className="h-5 w-full animate-pulse rounded bg-gray-100" />
                      </td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-4 py-12 text-center text-xs font-semibold text-gray-500"
                    >
                      조건에 일치하는 신고 접수 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  items.map(r => {
                    const isDeleted = r.targetDeleteYn === "Y";
                    const statusBadge = REPORT_STATUS_META[r.reportStatus] ?? {
                      label: r.reportStatus,
                      className: "border border-gray-200 bg-gray-100 text-gray-600",
                    };
                    return (
                      <tr
                        key={r.reportKey}
                        className="transition-colors hover:bg-gray-50/70"
                      >
                        <td className="whitespace-nowrap px-4 py-3.5 text-center">
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-black",
                              r.targetType === "POST"
                                ? "bg-blue-50 text-[#0058FF]"
                                : "bg-gray-100 text-gray-700",
                            )}
                          >
                            {r.targetType === "POST" ? "게시글" : "댓글"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 font-black tabular-nums text-gray-700">
                          #{r.targetId}
                        </td>
                        <td className="w-[260px] max-w-[260px] px-4 py-3.5">
                          <Link
                            href={
                              r.targetType === "COMMENT"
                                ? `/community/all/${r.postId}#comment-${r.targetId}`
                                : `/community/all/${r.postId}`
                            }
                            className="line-clamp-1 font-black text-gray-900 hover:text-[#0058FF] hover:underline"
                          >
                            {r.postTitle}
                          </Link>
                          <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">
                            {r.targetContent}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-xs font-bold text-gray-800">
                          {r.targetAuthorNickname ?? "-"} (#{r.targetAuthorId})
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-right font-black tabular-nums text-[#F6465D]">
                          {r.targetReportCount}건
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-xs font-bold text-gray-800">
                          {r.reporterNickname ?? "-"} (#{r.reporterId})
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-center">
                          <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                            {ADMIN_REPORT_REASON_LABELS[r.reasonType] ?? r.reasonType}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-center">
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                              statusBadge.className,
                            )}
                          >
                            {statusBadge.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-center">
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                              isDeleted
                                ? "bg-red-50 text-[#F6465D]"
                                : "bg-emerald-50 text-bull",
                            )}
                          >
                            {isDeleted ? "삭제됨 (Y)" : "활성 (N)"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-[11px] font-semibold tabular-nums text-gray-600">
                          {formatAdminDateTime(r.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-center">
                          <div className="inline-flex items-center justify-center gap-1.5">
                            {r.reportStatus === "PENDING" ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busyKey !== null || isDeleted}
                                  onClick={() => {
                                    setModalError(null);
                                    setConfirmAction({ item: r, kind: "DELETE_TARGET" });
                                  }}
                                  className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-40 cursor-pointer"
                                >
                                  대상 삭제 조치
                                </button>
                                <button
                                  type="button"
                                  disabled={busyKey !== null}
                                  onClick={() => {
                                    setModalError(null);
                                    setConfirmAction({ item: r, kind: "CLEAR_REPORTS" });
                                  }}
                                  className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
                                >
                                  신고 일괄해제
                                </button>
                                <button
                                  type="button"
                                  disabled={busyKey !== null}
                                  onClick={() => {
                                    setModalError(null);
                                    setConfirmAction({ item: r, kind: "DISMISS" });
                                  }}
                                  className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-40 cursor-pointer"
                                >
                                  단건 반려
                                </button>
                              </>
                            ) : (
                              <>
                                {!isDeleted ? (
                                  <button
                                    type="button"
                                    disabled={busyKey !== null}
                                    onClick={() => {
                                      setModalError(null);
                                      setConfirmAction({ item: r, kind: "DELETE_TARGET" });
                                    }}
                                    className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-40 cursor-pointer"
                                  >
                                    대상 삭제 조치
                                  </button>
                                ) : null}
                                <span
                                  data-report-action-status={r.reportStatus}
                                  className={cn(
                                    "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 text-xs font-bold",
                                    statusBadge.className,
                                  )}
                                >
                                  {r.reportStatus === "RESOLVED"
                                    ? "조치 완료"
                                    : r.reportStatus === "DISMISSED"
                                      ? "반려 완료"
                                      : statusBadge.label}
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {(page > 0 || hasNext) && (
            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
              <span className="text-xs font-bold text-gray-500">
                페이지 {page + 1} / {Math.max(1, totalPages)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  이전 페이지
                </button>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => setPage(p => p + 1)}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  다음 페이지
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 신고 제재 확인 모달 */}
        <DimModal
          open={confirmAction !== null}
          onClose={() => {
            if (busyKey === null) {
              setModalError(null);
              setConfirmAction(null);
            }
          }}
          title={
            confirmAction?.kind === "DELETE_TARGET"
              ? "신고 대상 삭제 조치 확인"
              : confirmAction?.kind === "CLEAR_REPORTS"
                ? "신고 일괄 해제 확인"
                : "단건 신고 반려 확인"
          }
          maxWidth="440px"
        >
          {confirmAction ? (
            <div className="space-y-4">
              {modalError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-[#F6465D]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{modalError.text}</span>
                    {modalError.requestId && <RequestIdChip requestId={modalError.requestId} />}
                  </div>
                </div>
              ) : null}
              <p className="text-xs leading-relaxed text-gray-700">
                {confirmAction.kind === "DELETE_TARGET"
                  ? `${confirmAction.item.targetType === "POST" ? "게시글" : "댓글"} #${confirmAction.item.targetId}을(를) 소프트 삭제하고 누적 신고를 일괄 처리 완료하시겠습니까?`
                  : confirmAction.kind === "CLEAR_REPORTS"
                    ? `${confirmAction.item.targetType === "POST" ? "게시글" : "댓글"} #${confirmAction.item.targetId}의 대기 중 신고를 모두 반려·해제하시겠습니까?`
                    : `신고자 #${confirmAction.item.reporterId}의 단건 신고를 반려 처리하시겠습니까?`}
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => {
                    setModalError(null);
                    setConfirmAction(null);
                  }}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void executeConfirmedAction()}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl px-4 text-xs font-black text-white disabled:opacity-50 cursor-pointer",
                    confirmAction.kind === "DELETE_TARGET"
                      ? "bg-[#F6465D] hover:bg-rose-700"
                      : "bg-[#0058FF] hover:bg-blue-700",
                  )}
                >
                  {busyKey !== null
                    ? "처리 중…"
                    : confirmAction.kind === "DELETE_TARGET"
                      ? "삭제 조치 실행"
                      : confirmAction.kind === "CLEAR_REPORTS"
                        ? "일괄 해제 실행"
                        : "반려 실행"}
                </button>
              </div>
            </div>
          ) : null}
        </DimModal>
      </div>
    </AdminShell>
  );
}
