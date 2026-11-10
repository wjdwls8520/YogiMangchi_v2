"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useOptionalMember } from "../../member/components/member-provider";
import { cn, V1IconCheck, V1IconRefresh } from "../../member/components/v1-ui";
import {
  type AdminReportDto,
  dismissAdminReport,
  fetchAdminReports,
  formatAdminDateTime,
  moderateAdminReportTarget,
} from "../api/admin-api";
import { AdminShell } from "./admin-layout";

type ReportTargetTypeFilter = "ALL" | "POST" | "COMMENT";
type ReportTargetStatusFilter = "ALL" | "ACTIVE" | "DELETED";
type ReportReasonFilter = "ALL" | "SPAM" | "ABUSE" | "FRAUD" | "INAPPROPRIATE" | "OTHER";

const REASON_LABELS: Record<string, string> = {
  SPAM: "스팸·홍보",
  ABUSE: "욕설·비방",
  FRAUD: "사기·리딩방",
  INAPPROPRIATE: "부적절 콘텐츠",
  OTHER: "기타 사유",
};

export function AdminReportsView() {
  const memberCtx = useOptionalMember();
  const [items, setItems] = useState<AdminReportDto[]>([]);
  const [page, setPage] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [postReportCount, setPostReportCount] = useState(0);
  const [commentReportCount, setCommentReportCount] = useState(0);
  const [activeTargetReportCount, setActiveTargetReportCount] = useState(0);

  const [targetTypeFilter, setTargetTypeFilter] = useState<ReportTargetTypeFilter>("ALL");
  const [targetStatusFilter, setTargetStatusFilter] =
    useState<ReportTargetStatusFilter>("ALL");
  const [reasonFilter, setReasonFilter] = useState<ReportReasonFilter>("ALL");
  const [keywordInput, setKeywordInput] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  useEffect(() => {
    if (memberCtx?.snapshot.phase !== "ready" || !memberCtx.session) return;
    const controller = new AbortController();
    void memberCtx.session
      .authorized(cred =>
        fetchAdminReports(
          cred.accessToken,
          {
            targetType: targetTypeFilter,
            targetStatus: targetStatusFilter,
            reasonType: reasonFilter,
            keyword: appliedKeyword || undefined,
            page,
            size: 20,
          },
          { signal: controller.signal },
        ),
      )
      .then(res => {
        setItems(res.content);
        setPage(res.page);
        setTotalElements(res.totalElements);
        setTotalPages(res.totalPages);
        setHasNext(res.hasNext);
        setPostReportCount(res.postReportCount);
        setCommentReportCount(res.commentReportCount);
        setActiveTargetReportCount(res.activeTargetReportCount);
      })
      .catch(() => {
        // Keep current list on transient error
      });
    return () => controller.abort();
  }, [
    memberCtx,
    targetTypeFilter,
    targetStatusFilter,
    reasonFilter,
    appliedKeyword,
    page,
    reloadTick,
  ]);

  async function handleDismissSingle(item: AdminReportDto) {
    if (!memberCtx?.session) return;
    setBusyKey(`dismiss:${item.reportKey}`);
    try {
      await memberCtx.session.authorized(cred =>
        dismissAdminReport(
          cred.accessToken,
          item.targetType,
          item.targetId,
          item.reporterId,
        ),
      );
      setBannerMessage(
        `${item.targetType === "POST" ? "게시글" : "댓글"} #${item.targetId}에 대한 신고자(#${item.reporterId})의 신고를 반려 처리했습니다.`,
      );
      setReloadTick(t => t + 1);
    } catch {
      setBannerMessage("신고 반려 처리에 실패했습니다.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleModerateTarget(
    item: AdminReportDto,
    action: "DELETE_TARGET" | "CLEAR_REPORTS",
  ) {
    if (!memberCtx?.session) return;
    setBusyKey(`${action}:${item.reportKey}`);
    try {
      await memberCtx.session.authorized(cred =>
        moderateAdminReportTarget(
          cred.accessToken,
          item.targetType,
          item.targetId,
          action,
        ),
      );
      setBannerMessage(
        action === "DELETE_TARGET"
          ? `${item.targetType === "POST" ? "게시글" : "댓글"} #${item.targetId}을(를) 소프트 삭제하고 누적 신고를 일괄 정리했습니다.`
          : `${item.targetType === "POST" ? "게시글" : "댓글"} #${item.targetId}의 허위·중복 신고를 일괄 해제했습니다.`,
      );
      setReloadTick(t => t + 1);
    } catch {
      setBannerMessage("대상 제재 처리에 실패했습니다.");
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-bold text-gray-500">현재 필터 조회 건수</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-gray-900">
              {totalElements.toLocaleString("ko-KR")}건
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-bold text-gray-500">활성 대상 미처리 신고</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-red-600">
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

        {bannerMessage ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50/80 px-5 py-3.5 text-xs font-bold text-[#0058FF]">
            <div className="flex items-center gap-2">
              <V1IconCheck className="h-4 w-4 shrink-0" />
              <span>{bannerMessage}</span>
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
                setReasonFilter(e.target.value as ReportReasonFilter);
                setPage(0);
              }}
              aria-label="신고 사유 필터"
              className="h-9 shrink-0 rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-bold text-gray-700 outline-none focus:border-[#0058FF]"
            >
              <option value="ALL">신고 사유: 전체</option>
              <option value="SPAM">스팸·홍보 (SPAM)</option>
              <option value="ABUSE">욕설·비방 (ABUSE)</option>
              <option value="FRAUD">사기·리딩방 (FRAUD)</option>
              <option value="INAPPROPRIATE">부적절 콘텐츠 (INAPPROPRIATE)</option>
              <option value="OTHER">기타 사유 (OTHER)</option>
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
            <table className="w-full min-w-[1160px] text-left text-sm">
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
                  <th className="whitespace-nowrap px-3 py-3.5 text-center">대상 상태</th>
                  <th className="whitespace-nowrap px-3 py-3.5">신고 일시</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-12 text-center text-xs font-semibold text-gray-500"
                    >
                      조건에 일치하는 신고 접수 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  items.map(r => {
                    const isDeleted = r.targetDeleteYn === "Y";
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
                            href={`/community/${r.postId}`}
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
                        <td className="whitespace-nowrap px-3 py-3.5 text-right font-black tabular-nums text-red-600">
                          {r.targetReportCount}건
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-xs font-bold text-gray-800">
                          {r.reporterNickname ?? "-"} (#{r.reporterId})
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-center">
                          <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                            {REASON_LABELS[r.reasonType] ?? r.reasonType}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-center">
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                              isDeleted
                                ? "bg-red-50 text-red-600"
                                : "bg-emerald-50 text-emerald-700",
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
                            <button
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => void handleModerateTarget(r, "DELETE_TARGET")}
                              className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-bold text-red-600 hover:bg-red-100"
                            >
                              {busyKey === `DELETE_TARGET:${r.reportKey}`
                                ? "처리중..."
                                : "대상 삭제 조치"}
                            </button>
                            <button
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => void handleModerateTarget(r, "CLEAR_REPORTS")}
                              className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
                            >
                              {busyKey === `CLEAR_REPORTS:${r.reportKey}`
                                ? "처리중..."
                                : "신고 일괄해제"}
                            </button>
                            <button
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => void handleDismissSingle(r)}
                              className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs font-bold text-gray-600 hover:bg-gray-100"
                            >
                              {busyKey === `dismiss:${r.reportKey}`
                                ? "반려중..."
                                : "단건 반려"}
                            </button>
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
      </div>
    </AdminShell>
  );
}
