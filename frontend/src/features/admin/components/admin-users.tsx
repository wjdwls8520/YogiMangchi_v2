"use client";

import { useEffect, useState } from "react";
import { DimModal } from "../../member/components/dim-modal";
import { useOptionalMember } from "../../member/components/member-provider";
import {
  cn,
  V1IconAlert,
  V1IconCheck,
  V1IconShield,
  V1IconUsers,
} from "../../member/components/v1-ui";
import {
  fetchAdminMembers,
  formatAdminDateTime,
  suspendAdminMember,
  unsuspendAdminMember,
  withdrawAdminMember,
  type AdminMemberDto,
} from "../api/admin-api";
import { AdminShell } from "./admin-layout";

type MemberStatusFilter = "ALL" | "ACTIVE" | "SUSPENDED" | "WITHDRAWN";

export function AdminUsers() {
  const memberCtx = useOptionalMember();
  const phase = memberCtx?.snapshot.phase;
  const role = memberCtx?.snapshot.role;
  const generation = memberCtx?.snapshot.generation;
  const session = memberCtx?.session;
  const currentMemberId = memberCtx?.snapshot.memberId ?? null;

  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>("ALL");
  const [roleFilter, setRoleFilter] = useState<"ALL" | "ADMIN" | "MEMBER">("ALL");
  const [memberIdInput, setMemberIdInput] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [appliedFilters, setAppliedFilters] = useState<{
    status: MemberStatusFilter;
    role: "ALL" | "ADMIN" | "MEMBER";
    memberId: number | null;
    nickname: string;
  }>({
    status: "ALL",
    role: "ALL",
    memberId: null,
    nickname: "",
  });

  const [members, setMembers] = useState<AdminMemberDto[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [suspendedCount, setSuspendedCount] = useState(0);
  const [withdrawnCount, setWithdrawnCount] = useState(0);
  const [nextCursorId, setNextCursorId] = useState<number | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<AdminMemberDto | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<AdminMemberDto | null>(null);
  const [suspendReasonInput, setSuspendReasonInput] = useState("");
  const [moderatingMemberId, setModeratingMemberId] = useState<number | null>(null);

  useEffect(() => {
    if (phase !== "ready" || role !== "ADMIN" || !session) return;
    const controller = new AbortController();
    void session
      .authorized(cred =>
        fetchAdminMembers(
          cred.accessToken,
          {
            status: appliedFilters.status,
            role: appliedFilters.role,
            memberId: appliedFilters.memberId,
            nickname: appliedFilters.nickname,
            size: 10,
          },
          { signal: controller.signal },
        ),
      )
      .then(res => {
        setLoadError(null);
        setMembers(res.content);
        setTotalCount(res.totalCount);
        setActiveCount(res.activeCount);
        setSuspendedCount(res.suspendedCount);
        setWithdrawnCount(res.withdrawnCount);
        setNextCursorId(res.nextCursorId);
        setHasNext(res.hasNext);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoadError("회원 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      });
    return () => controller.abort();
  }, [appliedFilters, reloadTick, phase, role, generation, session]);

  const handleApplyFilters = () => {
    const parsedId = Number(memberIdInput.trim());
    setAppliedFilters({
      status: statusFilter,
      role: roleFilter,
      memberId:
        memberIdInput.trim() !== "" && Number.isInteger(parsedId) && parsedId > 0
          ? parsedId
          : null,
      nickname: nicknameInput.trim(),
    });
  };

  const handleResetFilters = () => {
    setStatusFilter("ALL");
    setRoleFilter("ALL");
    setMemberIdInput("");
    setNicknameInput("");
    setAppliedFilters({
      status: "ALL",
      role: "ALL",
      memberId: null,
      nickname: "",
    });
  };

  const handleLoadMore = async () => {
    if (!hasNext || nextCursorId == null || loadingMore) return;
    if (phase !== "ready" || !session) return;
    setLoadingMore(true);
    try {
      const res = await session.authorized(cred =>
        fetchAdminMembers(cred.accessToken, {
          status: appliedFilters.status,
          role: appliedFilters.role,
          memberId: appliedFilters.memberId,
          nickname: appliedFilters.nickname,
          cursorId: nextCursorId,
          size: 10,
        }),
      );
      setMembers(prev => [...prev, ...res.content]);
      setTotalCount(res.totalCount);
      setActiveCount(res.activeCount);
      setSuspendedCount(res.suspendedCount);
      setWithdrawnCount(res.withdrawnCount);
      setNextCursorId(res.nextCursorId);
      setHasNext(res.hasNext);
    } catch {
      setActionToast({ kind: "error", text: "추가 회원 목록을 불러오지 못했습니다." });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleConfirmSuspend = async () => {
    if (!suspendTarget || moderatingMemberId !== null) return;
    if (phase !== "ready" || !session) {
      setActionToast({ kind: "error", text: "관리자 인증 세션이 필요합니다." });
      setSuspendTarget(null);
      return;
    }
    const target = suspendTarget;
    setModeratingMemberId(target.memberId);
    try {
      await session.authorized(cred =>
        suspendAdminMember(cred.accessToken, target.memberId, suspendReasonInput),
      );
      setActionToast({
        kind: "success",
        text: `회원 #${target.memberId} (${target.nickname}) 계정을 일시 정지(SUSPENDED) 처리했습니다.`,
      });
      setSuspendTarget(null);
      setSuspendReasonInput("");
      setReloadTick(prev => prev + 1);
    } catch {
      setActionToast({ kind: "error", text: "회원 일시 정지 처리에 실패했습니다." });
    } finally {
      setModeratingMemberId(null);
    }
  };

  const handleUnsuspend = async (member: AdminMemberDto) => {
    if (moderatingMemberId !== null) return;
    if (phase !== "ready" || !session) {
      setActionToast({ kind: "error", text: "관리자 인증 세션이 필요합니다." });
      return;
    }
    setModeratingMemberId(member.memberId);
    try {
      await session.authorized(cred =>
        unsuspendAdminMember(cred.accessToken, member.memberId),
      );
      setActionToast({
        kind: "success",
        text: `회원 #${member.memberId} (${member.nickname}) 계정의 정지를 해제했습니다.`,
      });
      setReloadTick(prev => prev + 1);
    } catch {
      setActionToast({ kind: "error", text: "회원 정지 해제 처리에 실패했습니다." });
    } finally {
      setModeratingMemberId(null);
    }
  };

  const handleConfirmWithdraw = async () => {
    if (!withdrawTarget || withdrawing) return;
    if (phase !== "ready" || !session) {
      setActionToast({ kind: "error", text: "관리자 인증 세션이 필요합니다." });
      setWithdrawTarget(null);
      return;
    }
    setWithdrawing(true);
    try {
      const target = withdrawTarget;
      await session.authorized(cred =>
        withdrawAdminMember(cred.accessToken, target.memberId),
      );
      setActionToast({
        kind: "success",
        text: `회원 #${target.memberId} (${target.nickname}) 강제 탈퇴가 완료되었습니다.`,
      });
      setWithdrawTarget(null);
      setReloadTick(prev => prev + 1);
    } catch {
      setActionToast({ kind: "error", text: "회원 강제 탈퇴 처리에 실패했습니다." });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <AdminShell activeSection="users">
      <div className="space-y-8" data-admin-users-page="true">
        {/* 상단 타이틀 헤더 */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-black tracking-wide text-[#0058FF]">
              <V1IconUsers className="h-4 w-4" />
              <span>USER MANAGEMENT</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
              회원 관리
            </h1>
            <p className="text-sm font-medium text-gray-500">
              전체 회원 계정 상태·소셜 연동 정보 조회 및 운영 정책 위반 계정 강제 탈퇴를 관리합니다.
            </p>
          </div>
        </div>

        {loadError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-[#F6465D]"
          >
            <div className="flex items-center gap-2">
              <V1IconAlert className="h-4 w-4 shrink-0" />
              <span>{loadError}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setReloadTick(t => t + 1);
              }}
              className="shrink-0 whitespace-nowrap rounded-lg border border-rose-200 bg-white px-3 py-1 text-[11px] font-black text-[#F6465D] hover:bg-rose-100"
            >
              다시 시도
            </button>
          </div>
        ) : null}

        {actionToast ? (
          <div
            role={actionToast.kind === "error" ? "alert" : "status"}
            className={cn(
              "flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-bold",
              actionToast.kind === "error"
                ? "border-rose-200 bg-rose-50 text-[#F6465D]"
                : "border-blue-200 bg-blue-50/80 text-[#0058FF]",
            )}
          >
            <div className="flex items-center gap-2">
              {actionToast.kind === "error" ? (
                <V1IconAlert className="h-4 w-4 shrink-0" />
              ) : (
                <V1IconCheck className="h-4 w-4 shrink-0" />
              )}
              <span>{actionToast.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionToast(null)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-black",
                actionToast.kind === "error"
                  ? "text-rose-700 hover:bg-rose-100"
                  : "text-blue-700 hover:bg-blue-100",
              )}
            >
              닫기
            </button>
          </div>
        ) : null}

        {/* 요약 카드 4종 */}
        <section
          aria-label="회원 현황 요약"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold text-gray-400">전체 회원</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-gray-900">
              {totalCount.toLocaleString("ko-KR")}명
            </p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold text-gray-400">활동 회원</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-[#0ECB81]">
              {activeCount.toLocaleString("ko-KR")}명
            </p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold text-gray-400">일시 정지 회원</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-amber-600">
              {suspendedCount.toLocaleString("ko-KR")}명
            </p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold text-gray-400">탈퇴 회원</p>
            <p className="mt-2 text-2xl font-black tabular-nums text-gray-500">
              {withdrawnCount.toLocaleString("ko-KR")}명
            </p>
          </div>
        </section>

        {/* 검색 및 필터 바 */}
        <form
          aria-label="회원 검색 필터"
          onSubmit={e => {
            e.preventDefault();
            handleApplyFilters();
          }}
          className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1.5 text-xs font-bold text-gray-600">
              <span>계정 상태</span>
              <select
                aria-label="계정 상태 필터"
                value={statusFilter}
                onChange={e =>
                  setStatusFilter(e.target.value as MemberStatusFilter)
                }
                className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:bg-white focus:outline-none"
              >
                <option value="ALL">전체 상태 (ALL)</option>
                <option value="ACTIVE">활동 중 (ACTIVE)</option>
                <option value="SUSPENDED">일시 정지 (SUSPENDED)</option>
                <option value="WITHDRAWN">탈퇴 (WITHDRAWN)</option>
              </select>
            </label>

            <label className="space-y-1.5 text-xs font-bold text-gray-600">
              <span>권한 등급</span>
              <select
                aria-label="권한 등급 필터"
                value={roleFilter}
                onChange={e =>
                  setRoleFilter(e.target.value as "ALL" | "ADMIN" | "MEMBER")
                }
                className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:bg-white focus:outline-none"
              >
                <option value="ALL">전체 권한 (ALL)</option>
                <option value="ADMIN">관리자 (ADMIN)</option>
                <option value="MEMBER">일반회원 (MEMBER)</option>
              </select>
            </label>

            <label className="space-y-1.5 text-xs font-bold text-gray-600">
              <span>회원 번호</span>
              <input
                type="text"
                inputMode="numeric"
                value={memberIdInput}
                onChange={e => setMemberIdInput(e.target.value)}
                placeholder="예: 101"
                className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
              />
            </label>

            <label className="space-y-1.5 text-xs font-bold text-gray-600">
              <span>닉네임 검색</span>
              <input
                type="search"
                value={nicknameInput}
                onChange={e => setNicknameInput(e.target.value)}
                placeholder="닉네임 입력"
                className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
              />
            </label>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              초기화
            </button>
            <button
              type="submit"
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-[#0058FF] px-4 text-xs font-black text-white hover:bg-[#0047D1]"
            >
              조회하기
            </button>
          </div>
        </form>

        {/* 회원 목록 테이블 */}
        <section
          aria-label="회원 목록"
          className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-[#F9FAFB] text-[11px] font-black uppercase tracking-wider text-gray-400">
                  <th className="px-4 py-3.5 whitespace-nowrap">회원번호</th>
                  <th className="px-4 py-3.5 whitespace-nowrap">프로필 · 닉네임</th>
                  <th className="px-4 py-3.5 whitespace-nowrap">소셜 연동</th>
                  <th className="px-4 py-3.5 whitespace-nowrap">권한</th>
                  <th className="px-4 py-3.5 whitespace-nowrap">상태</th>
                  <th className="px-4 py-3.5 whitespace-nowrap">가입일 / 탈퇴일</th>
                  <th className="px-4 py-3.5 text-right whitespace-nowrap">관리 액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-xs font-semibold text-gray-400">
                      조건에 맞는 회원이 없습니다.
                    </td>
                  </tr>
                ) : (
                  members.map(member => {
                    const isWithdrawn = member.status === "WITHDRAWN" || member.deleteYn === "Y";
                    const isSuspended = member.status === "SUSPENDED";
                    const isSelf = currentMemberId != null && member.memberId === currentMemberId;
                    const isAdminTarget = member.role === "ADMIN";
                    const canModerate = !isWithdrawn && !isSelf && !isAdminTarget;
                    const isBusy = moderatingMemberId === member.memberId;

                    return (
                      <tr
                        key={member.memberId}
                        className="transition-colors hover:bg-gray-50/70"
                      >
                        <td className="px-4 py-3.5 font-black tabular-nums text-gray-900 whitespace-nowrap">
                          #{member.memberId}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2.5 whitespace-nowrap">
                            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-black text-gray-600">
                              {member.nickname.slice(0, 1)}
                            </span>
                            <span className="font-bold text-gray-900">{member.nickname}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">
                          <span className="font-bold uppercase text-gray-800">
                            {member.oauthProvider ?? "-"}
                          </span>
                          <span className="mx-1.5 text-gray-300">·</span>
                          <span className="text-gray-500">{member.oauthEmail ?? "-"}</span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-black",
                              member.role === "ADMIN"
                                ? "bg-blue-50 text-[#0058FF]"
                                : "bg-gray-100 text-gray-700",
                            )}
                          >
                            {member.role === "ADMIN" ? (
                              <V1IconShield className="h-3 w-3 shrink-0" />
                            ) : null}
                            <span>{member.role}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-black",
                              isWithdrawn
                                ? "bg-gray-100 text-gray-500"
                                : isSuspended
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : "bg-emerald-50 text-[#0ECB81]",
                            )}
                          >
                            {isWithdrawn ? "WITHDRAWN" : isSuspended ? "SUSPENDED" : "ACTIVE"}
                          </span>
                          {isSuspended && member.suspendedReason ? (
                            <p className="mt-1 max-w-[180px] truncate text-[10px] font-medium text-amber-700" title={member.suspendedReason}>
                              사유: {member.suspendedReason}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-gray-500 whitespace-nowrap">
                          <div className="whitespace-nowrap">가입: {formatAdminDateTime(member.createdAt)}</div>
                          {member.suspendedAt ? (
                            <div className="text-[11px] text-amber-600 whitespace-nowrap">
                              정지: {formatAdminDateTime(member.suspendedAt)}
                            </div>
                          ) : null}
                          {member.withdrawnAt ? (
                            <div className="text-[11px] text-rose-500 whitespace-nowrap">
                              탈퇴: {formatAdminDateTime(member.withdrawnAt)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          {canModerate ? (
                            <div className="inline-flex items-center gap-1.5">
                              {isSuspended ? (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleUnsuspend(member)}
                                  className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-black text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                                >
                                  {isBusy ? "해제 중…" : "정지 해제"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => {
                                    setSuspendReasonInput("");
                                    setSuspendTarget(member);
                                  }}
                                  className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-3 text-[11px] font-black text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                                >
                                  정지
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setWithdrawTarget(member)}
                                className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-[11px] font-black text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50"
                              >
                                강제 탈퇴
                              </button>
                            </div>
                          ) : (
                            <span className="whitespace-nowrap text-[11px] font-semibold text-gray-400">
                              {isSelf ? "본인 계정" : isAdminTarget ? "관리자 계정" : "탈퇴 완료"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {hasNext ? (
            <div className="border-t border-gray-100 bg-[#F9FAFB] px-4 py-3 text-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void handleLoadMore()}
                className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-5 text-xs font-black text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                {loadingMore ? "불러오는 중..." : "더 보기"}
              </button>
            </div>
          ) : null}
        </section>

        {/* 계정 일시 정지 확인 모달 */}
        <DimModal
          open={suspendTarget !== null}
          onClose={() => {
            if (moderatingMemberId === null) setSuspendTarget(null);
          }}
          title="회원 계정 일시 정지 (SUSPENDED)"
        >
          {suspendTarget ? (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-gray-600">
                회원 <strong className="font-black text-gray-900">#{suspendTarget.memberId} ({suspendTarget.nickname})</strong> 계정을 일시 정지 처리하시겠습니까?
                정지 시 활성 Refresh 세션이 즉시 폐기되며 로그인 및 회원 전용 기능 이용이 제한됩니다.
              </p>
              <label className="block space-y-1.5 text-xs font-bold text-gray-700">
                <span>정지 사유 (선택)</span>
                <textarea
                  rows={3}
                  maxLength={300}
                  value={suspendReasonInput}
                  onChange={e => setSuspendReasonInput(e.target.value)}
                  placeholder="예: 커뮤니티 반복 도배 및 약관 제4조 위반"
                  className="w-full rounded-xl border border-gray-300 bg-white p-3 text-xs text-gray-900 focus:border-[#0058FF] focus:outline-none"
                />
              </label>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={moderatingMemberId !== null}
                  onClick={() => setSuspendTarget(null)}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={moderatingMemberId !== null}
                  onClick={() => void handleConfirmSuspend()}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-amber-600 px-4 text-xs font-black text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {moderatingMemberId !== null ? "정지 처리 중…" : "일시 정지 실행"}
                </button>
              </div>
            </div>
          ) : null}
        </DimModal>

        {/* 강제 탈퇴 확인 모달 */}
        <DimModal
          open={withdrawTarget !== null}
          onClose={() => {
            if (!withdrawing) setWithdrawTarget(null);
          }}
          title="회원 강제 탈퇴 확인"
        >
          {withdrawTarget ? (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-gray-600">
                회원 <strong className="font-black text-gray-900">#{withdrawTarget.memberId} ({withdrawTarget.nickname})</strong> 계정을 강제 탈퇴 처리하시겠습니까?
                탈퇴 처리 시 활성 세션과 거래 계정이 종료되며 되돌릴 수 없습니다.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={withdrawing}
                  onClick={() => setWithdrawTarget(null)}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={withdrawing}
                  onClick={() => void handleConfirmWithdraw()}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-rose-600 px-4 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {withdrawing ? "처리 중..." : "강제 탈퇴 실행"}
                </button>
              </div>
            </div>
          ) : null}
        </DimModal>
      </div>
    </AdminShell>
  );
}
