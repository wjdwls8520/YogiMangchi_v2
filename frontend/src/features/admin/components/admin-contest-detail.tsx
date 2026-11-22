"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  approveAdminContestApplicant,
  bulkApproveAdminContestApplicants,
  cleanupRemainingAdminContestSeason,
  disqualifyAdminContestParticipant,
  fetchAdminContestSeasonDetail,
  formatContestDateTime,
  formatContestSignedRoi,
  formatContestSignedUsdt,
  formatContestUsdt,
  isNonNegativeContestDecimal,
  patchAdminContestSeasonStatus,
  rejectAdminContestApplicant,
  settleAdminContestSeason,
  toIsoInstantFromInput,
  updateAdminContestSeason,
  type AdminSeasonDetailResponse,
} from "../../contest/api/contest-client";
import { RequestIdChip } from "../../../components/request-id-copy";
import { getErrorRequestId, isUnexpectedApiError } from "../../../lib/request-id";
import { DimModal } from "../../member/components/dim-modal";
import { useOptionalMember } from "../../member/components/member-provider";
import {
  cn,
  V1Button,
  V1IconAlert,
  V1IconArrowLeft,
  V1IconCalendar,
  V1IconCheck,
  V1IconClock,
  V1IconRefresh,
  V1IconShield,
  V1IconUsers,
  V1Tabs,
  V1UserAvatar,
} from "../../member/components/v1-ui";
import {
  AdminToggleSwitch,
  ContestCreateEditModal,
  formatReadableDateTime,
  mapSeasonViewToAdminRecord,
  resolveDisplayStatus,
  type AdminContestSeasonRecord,
  type ContestFormDraft,
} from "./admin-contest-list";
import { AdminShell } from "./admin-layout";

export interface AdminContestApplicantItem {
  applicantId: number;
  memberId: number;
  nickname: string;
  appliedAt: string;
  profileMsg: string;
}

export interface AdminContestParticipantWalletItem {
  participantId: number;
  memberId: number;
  nickname: string;
  walletId: number;
  walletStatus: "ACTIVE" | "INACTIVE";
  seedMoney: string;
  equity: string;
  realizedPnl: string;
  roi: string;
  isPositive: boolean;
  pendingOrderCount: number;
  openPositionCount: number;
  rank: number;
  approvedAt: string;
  approvedBy: string;
}

export interface AdminContestRejectedItem {
  rejectedId: number;
  memberId: number;
  nickname: string;
  appliedAt: string;
  rejectedAt: string;
  rejectReason: string;
  processedBy: string;
}

export interface ContestSettlementRunLog {
  attemptNo: number;
  triggeredBy: "SYSTEM_SCHEDULER" | "ADMIN";
  status: "COMPLETED" | "READY" | "FAILED";
  executedAt: string;
  pipelineSummary: string;
  deactivatedWalletCount: number;
  canceledOrderCount: number;
  liquidatedPositionCount: number;
  finalizedParticipantCount: number;
  failureReason?: string | null;
}

function buildLoadingSeason(seasonIdInput: number | string): AdminContestSeasonRecord {
  const numericId = Number(seasonIdInput);
  const safeId = Number.isFinite(numericId) && numericId > 0 ? numericId : 0;
  return {
    id: safeId,
    title: safeId > 0 ? `대회 시즌 #${safeId}` : "대회 시즌",
    description: "",
    seedMoney: "0",
    recruitmentStartAt: "",
    recruitmentEndAt: "",
    contestStartAt: "",
    contestEndAt: "",
    isPublic: false,
    isCancel: false,
    progressState: "대기중",
    settledAt: null,
    applicantCount: 0,
    participantCount: 0,
    rejectedCount: 0,
    pendingOrderCount: 0,
    openPositionCount: 0,
  };
}

export function AdminContestDetail({
  seasonId,
}: {
  seasonId: number | string;
}) {
  const memberCtx = useOptionalMember();
  const phase = memberCtx?.snapshot.phase;
  const role = memberCtx?.snapshot.role;
  const generation = memberCtx?.snapshot.generation;
  const session = memberCtx?.session;
  const [season, setSeason] = useState<AdminContestSeasonRecord>(() =>
    buildLoadingSeason(seasonId),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ text: string; requestId?: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [applicants, setApplicants] = useState<AdminContestApplicantItem[]>([]);
  const [participants, setParticipants] = useState<AdminContestParticipantWalletItem[]>([]);
  const [rejectedList, setRejectedList] = useState<AdminContestRejectedItem[]>([]);

  const [selectedApplicantIds, setSelectedApplicantIds] = useState<number[]>([]);
  const [activeMemberTab, setActiveMemberTab] = useState<
    "applicants" | "participants" | "rejected"
  >("applicants");

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalError, setEditModalError] = useState<{ text: string; requestId?: string } | null>(
    null,
  );
  const [earlySettleModalOpen, setEarlySettleModalOpen] = useState(false);
  const [earlySettleModalError, setEarlySettleModalError] = useState<{
    text: string;
    requestId?: string;
  } | null>(null);
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [cleanupModalError, setCleanupModalError] = useState<{
    text: string;
    requestId?: string;
  } | null>(null);
  const [cancelSeasonModalOpen, setCancelSeasonModalOpen] = useState(false);
  const [cancelModalError, setCancelModalError] = useState<{
    text: string;
    requestId?: string;
  } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminContestApplicantItem | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState("");
  const [rejectModalError, setRejectModalError] = useState<{
    text: string;
    requestId?: string;
  } | null>(null);
  const [disqualifyTarget, setDisqualifyTarget] =
    useState<AdminContestParticipantWalletItem | null>(null);
  const [disqualifyReasonInput, setDisqualifyReasonInput] = useState("");
  const [disqualifyModalError, setDisqualifyModalError] = useState<{
    text: string;
    requestId?: string;
  } | null>(null);
  const [operationBanner, setOperationBanner] = useState<{
    kind: "success" | "error";
    text: string;
    requestId?: string;
  } | null>(null);

  const [settlementRuns, setSettlementRuns] = useState<ContestSettlementRunLog[]>([]);

  function applyDetailResponse(detail: AdminSeasonDetailResponse) {
    if (!detail || !detail.season) return;
    const mappedSeason = mapSeasonViewToAdminRecord(detail.season);
    setSeason({
      ...mappedSeason,
      pendingOrderCount: detail.pendingOrderCount,
      openPositionCount: detail.openPositionCount,
      applicantCount: detail.applicants.length,
      participantCount: detail.participants.length,
      rejectedCount: detail.rejectedApplicants.length,
    });

    setApplicants(
      detail.applicants.map(app => ({
        applicantId: app.applicationId,
        memberId: app.memberId,
        nickname: app.nickname,
        appliedAt: formatContestDateTime(app.appliedAt),
        profileMsg: `회원 #${app.memberId} · 신청 #${app.applicationId}`,
      })),
    );

    setParticipants(
      detail.participants.map((p, idx) => ({
        participantId: p.participantId,
        memberId: p.memberId,
        nickname: p.nickname,
        walletId: p.accountId,
        walletStatus:
          p.accountStatus === "ACTIVE" && !detail.season.settledAt ? "ACTIVE" : "INACTIVE",
        seedMoney: formatContestUsdt(p.seedMoney),
        equity: formatContestUsdt(p.totalEquity),
        realizedPnl: formatContestSignedUsdt(p.realizedPnl),
        roi: formatContestSignedRoi(p.roiPct),
        isPositive: isNonNegativeContestDecimal(p.roiPct),
        pendingOrderCount: p.pendingOrderCount,
        openPositionCount: p.openPositionCount,
        rank: p.rank ?? idx + 1,
        approvedAt: formatContestDateTime(p.approvedAt),
        approvedBy: "관리자 승인",
      })),
    );

    setRejectedList(
      detail.rejectedApplicants.map(r => ({
        rejectedId: r.applicationId,
        memberId: r.memberId,
        nickname: r.nickname,
        appliedAt: formatContestDateTime(r.appliedAt),
        rejectedAt: formatContestDateTime(r.processedAt ?? r.appliedAt),
        rejectReason: r.rejectReason ?? "운영 기준 미충족으로 반려 처리되었습니다.",
        processedBy: r.processedByMemberId ? `관리자 #${r.processedByMemberId}` : "시스템",
      })),
    );

    setSettlementRuns(
      detail.settlementRuns.map(run => ({
        attemptNo: run.attemptNo,
        triggeredBy: run.triggeredBy.startsWith("ADMIN") ? "ADMIN" : "SYSTEM_SCHEDULER",
        status:
          run.status === "COMPLETED"
            ? "COMPLETED"
            : run.status === "FAILED"
              ? "FAILED"
              : "READY",
        executedAt: formatContestDateTime(run.completedAt ?? run.startedAt),
        pipelineSummary: run.failureReason
          ? `정산 중단(${run.lastCompletedPhase}): ${run.failureReason}`
          : "가격 스냅샷 → 지갑 비활성화 → 미체결 주문 500청크 소프트 취소 → 오픈 포지션 500청크 강제청산 → 올림픽 순위 확정",
        deactivatedWalletCount: run.deactivatedWalletCount,
        canceledOrderCount: run.canceledOrderCount,
        liquidatedPositionCount: run.liquidatedPositionCount,
        finalizedParticipantCount: run.finalizedParticipantCount,
        failureReason: run.failureReason,
      })),
    );
  }

  function reloadDetailFromServer(targetId: number) {
    if (phase !== "ready" || role !== "ADMIN" || !session || targetId <= 0) {
      return;
    }
    void session
      .authorized(
        cred => fetchAdminContestSeasonDetail(targetId, { token: cred.accessToken }),
        true,
      )
      .then(detail => {
        setLoadError(null);
        if (detail && detail.season) {
          applyDetailResponse(detail);
        }
      })
      .catch(error => {
        setLoadError({
          text: "최신 대회 상세 데이터를 새로고침하지 못했습니다.",
          requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
        });
      });
  }

  const parsedSeasonId = Number(seasonId);
  const validSeasonId =
    Number.isFinite(parsedSeasonId) && parsedSeasonId > 0 ? parsedSeasonId : 0;

  useEffect(() => {
    if (phase !== "ready" || role !== "ADMIN" || !session || validSeasonId <= 0) {
      return;
    }
    const controller = new AbortController();

    void session
      .authorized(
        cred =>
          fetchAdminContestSeasonDetail(validSeasonId, {
            token: cred.accessToken,
            signal: controller.signal,
          }),
        true,
      )
      .then(detail => {
        setLoadError(null);
        setIsLoading(false);
        if (detail && detail.season) {
          applyDetailResponse(detail);
        }
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setIsLoading(false);
        setApplicants([]);
        setParticipants([]);
        setRejectedList([]);
        setSettlementRuns([]);
        setLoadError({
          text: "대회 시즌 상세 정보를 불러오지 못했습니다. 시즌 ID 및 서버 상태를 확인해 주세요.",
          requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
        });
      });

    return () => controller.abort();
  }, [validSeasonId, session, phase, role, generation, reloadTick]);

  const effectiveIsLoading = validSeasonId > 0 && isLoading;
  const effectiveLoadError =
    validSeasonId <= 0 ? { text: "유효하지 않은 대회 시즌 ID입니다." } : loadError;

  const displayStatus = resolveDisplayStatus(season);
  const isLockedSeason = season.isCancel || Boolean(season.settledAt);
  const isAllApplicantsSelected =
    applicants.length > 0 && selectedApplicantIds.length === applicants.length;

  async function handleToggleStatus(field: "isPublic" | "isCancel") {
    if (!session || busyAction !== null) return;
    if (field === "isCancel") {
      if (isLockedSeason) return;
      setCancelModalError(null);
      setCancelSeasonModalOpen(true);
      return;
    }
    if (season.isCancel) return;
    const nextValue = !season[field];
    const patchBody = { isPublic: nextValue };
    setBusyAction("toggle-public");

    try {
      const updatedView = await session.authorized(cred =>
        patchAdminContestSeasonStatus(season.id, patchBody, { token: cred.accessToken }),
      );
      if (updatedView) {
        const mapped = mapSeasonViewToAdminRecord(updatedView);
        setSeason(prev => ({ ...prev, ...mapped }));
        const label = mapped.isPublic ? "공개중" : "비공개";
        setOperationBanner({
          kind: "success",
          text: `시즌 #${mapped.id} "${mapped.title}" 상태가 [${label}](으)로 반영되었습니다.`,
        });
      }
    } catch (error) {
      setOperationBanner({
        kind: "error",
        text:
          error instanceof Error && error.message
            ? error.message
            : "시즌 상태 변경에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmCancelSeason() {
    if (!session || busyAction !== null || isLockedSeason) return;
    setBusyAction("cancel-season");
    setCancelModalError(null);
    try {
      const updatedView = await session.authorized(cred =>
        patchAdminContestSeasonStatus(
          season.id,
          { isCanceled: true },
          { token: cred.accessToken },
        ),
      );
      if (updatedView) {
        const mapped = mapSeasonViewToAdminRecord(updatedView);
        setSeason(prev => ({ ...prev, ...mapped }));
        setOperationBanner({
          kind: "success",
          text: `시즌 #${mapped.id} "${mapped.title}"이(가) 영구 취소 처리되었습니다.`,
        });
      }
      setCancelSeasonModalOpen(false);
      reloadDetailFromServer(season.id);
    } catch (error) {
      setCancelModalError({
        text:
          error instanceof Error && error.message
            ? error.message
            : "시즌 취소 처리에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveSeasonEdit(draft: ContestFormDraft) {
    if (!session || busyAction !== null || isLockedSeason) return;
    setBusyAction("edit-season");
    setEditModalError(null);
    const payload = {
      title: draft.title,
      description: draft.description,
      seedMoney: draft.seedMoney.replace(/,/g, ""),
      recruitmentStartAt: toIsoInstantFromInput(draft.recruitmentStartAt),
      recruitmentEndAt: toIsoInstantFromInput(draft.recruitmentEndAt),
      contestStartAt: toIsoInstantFromInput(draft.contestStartAt),
      contestEndAt: toIsoInstantFromInput(draft.contestEndAt),
      isPublic: draft.isPublic,
    };

    try {
      const updatedView = await session.authorized(cred =>
        updateAdminContestSeason(season.id, payload, { token: cred.accessToken }),
      );
      if (updatedView) {
        const mapped = mapSeasonViewToAdminRecord(updatedView);
        setSeason(prev => ({ ...prev, ...mapped }));
        setEditModalOpen(false);
        setOperationBanner({
          kind: "success",
          text: `시즌 #${mapped.id} "${mapped.title}" 정보가 저장되었습니다.`,
        });
      }
    } catch (error) {
      setEditModalError({
        text:
          error instanceof Error && error.message
            ? error.message
            : "시즌 정보 저장에 실패했습니다. 일정 및 입력값을 확인해 주세요.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmEarlyFinishSettle() {
    if (!session || busyAction !== null || isLockedSeason) return;
    setBusyAction("early-settle");
    setEarlySettleModalError(null);
    try {
      const res = await session.authorized(cred =>
        settleAdminContestSeason(season.id, { token: cred.accessToken }),
      );
      if (res) {
        setEarlySettleModalOpen(false);
        setOperationBanner({
          kind: "success",
          text: `정산 완료: 비활성화 지갑 ${res.deactivatedWalletCount}건 · 미체결 주문 소프트 취소 ${res.canceledOrderCount}건 · 포지션 강제청산 ${res.liquidatedPositionCount}건 · 최종 순위 확정 ${res.finalizedParticipantCount}명`,
        });
        reloadDetailFromServer(season.id);
      }
    } catch (error) {
      setEarlySettleModalError({
        text:
          error instanceof Error && error.message
            ? error.message
            : "대회 조기 종료 및 강제 정산 실행에 실패했습니다. 최신 시세 스냅샷 상태를 확인해 주세요.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
      reloadDetailFromServer(season.id);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmCleanupRemaining() {
    if (!session || busyAction !== null) return;
    setBusyAction("cleanup-remaining");
    setCleanupModalError(null);
    try {
      const res = await session.authorized(cred =>
        cleanupRemainingAdminContestSeason(season.id, { token: cred.accessToken }),
      );
      if (res) {
        setCleanupModalOpen(false);
        setOperationBanner({
          kind: "success",
          text: `잔여 재정리 완료: 미체결 주문 500청크 소프트 취소 ${res.canceledOrderCount}건 · 오픈 포지션 500청크 강제청산 ${res.liquidatedPositionCount}건 · 최종 순위 재집계 ${res.finalizedParticipantCount}명`,
        });
        reloadDetailFromServer(season.id);
      }
    } catch (error) {
      setCleanupModalError({
        text:
          error instanceof Error && error.message
            ? error.message
            : "남은 포지션·미체결 주문 재정리 실행에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
      reloadDetailFromServer(season.id);
    } finally {
      setBusyAction(null);
    }
  }

  async function approveApplicantsByIds(targetIds: number[]) {
    if (targetIds.length === 0 || !session || busyAction !== null) return;
    setBusyAction("approve");
    try {
      if (targetIds.length === 1) {
        await session.authorized(cred =>
          approveAdminContestApplicant(season.id, targetIds[0]!, {
            token: cred.accessToken,
          }),
        );
      } else {
        await session.authorized(cred =>
          bulkApproveAdminContestApplicants(season.id, targetIds, {
            token: cred.accessToken,
          }),
        );
      }
      setSelectedApplicantIds([]);
      setActiveMemberTab("participants");
      setOperationBanner({
        kind: "success",
        text: `${targetIds.length}명의 참가 신청을 승인하고 시즌 전용 ${season.seedMoney} USDT 대회 지갑(활성)을 발급했습니다.`,
      });
      reloadDetailFromServer(season.id);
    } catch (error) {
      setOperationBanner({
        kind: "error",
        text:
          error instanceof Error && error.message
            ? error.message
            : "참가 신청 승인 처리에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
      reloadDetailFromServer(season.id);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectTarget || !session || busyAction !== null) return;
    const targetAppId = rejectTarget.applicantId;
    const targetNickname = rejectTarget.nickname;
    const reason =
      rejectReasonInput.trim() || "시즌 참가 기준 미충족으로 반려되었습니다.";
    setBusyAction("reject");
    setRejectModalError(null);

    try {
      await session.authorized(cred =>
        rejectAdminContestApplicant(season.id, targetAppId, reason, {
          token: cred.accessToken,
        }),
      );
      setSelectedApplicantIds(prev => prev.filter(id => id !== targetAppId));
      setRejectTarget(null);
      setRejectReasonInput("");
      setActiveMemberTab("rejected");
      setOperationBanner({
        kind: "success",
        text: `"${targetNickname}" 신청자의 참가 신청을 반려 처리했습니다.`,
      });
      reloadDetailFromServer(season.id);
    } catch (error) {
      setRejectModalError({
        text:
          error instanceof Error && error.message
            ? error.message
            : "참가 신청 반려 처리에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmDisqualify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disqualifyTarget || !session || busyAction !== null) return;
    const target = disqualifyTarget;
    const reason = disqualifyReasonInput.trim();
    setBusyAction("disqualify");
    setDisqualifyModalError(null);
    try {
      await session.authorized(cred =>
        disqualifyAdminContestParticipant(
          season.id,
          target.memberId,
          reason || undefined,
          { token: cred.accessToken },
        ),
      );
      setDisqualifyTarget(null);
      setDisqualifyReasonInput("");
      setOperationBanner({
        kind: "success",
        text: `"${target.nickname}"(#${target.memberId}) 참가자를 실격 처리하고 시즌 지갑·포지션을 정리했습니다.`,
      });
      reloadDetailFromServer(season.id);
    } catch (error) {
      setDisqualifyModalError({
        text:
          error instanceof Error && error.message
            ? error.message
            : `"${target.nickname}" 참가자 실격 처리에 실패했습니다.`,
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AdminShell activeSection="contest">
      <div className="space-y-8">
        {/* 1. 상단 액션 바 */}
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Link
              href="/admin/contest"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-900"
            >
              <V1IconArrowLeft className="h-3.5 w-3.5" />
              <span>대회 목록으로 돌아가기</span>
            </Link>

            <div className="flex flex-wrap items-center gap-2.5">
              <span className="shrink-0 whitespace-nowrap rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-600 tabular-nums">
                #{season.id}
              </span>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
                {season.title}
              </h1>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold",
                  season.progressState === "모집중"
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : season.progressState === "Live"
                      ? "border border-blue-200 bg-blue-50 text-[#0058FF]"
                      : "border border-gray-200 bg-gray-100 text-gray-600",
                )}
              >
                {season.progressState === "Live" ? (
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                ) : null}
                <span>{season.progressState}</span>
              </span>
              <span
                className={cn(
                  "inline-flex shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold",
                  displayStatus === "공개중"
                    ? "border border-indigo-200 bg-indigo-50 text-indigo-700"
                    : displayStatus === "취소됨"
                      ? "border border-rose-200 bg-rose-50 text-rose-700"
                      : "border border-gray-200 bg-gray-100 text-gray-600",
                )}
              >
                {displayStatus}
              </span>
            </div>
          </div>

          {/* 우측 핵심 운영 버튼 3종 */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              data-admin-action="early-finish-settle"
              disabled={isLockedSeason || busyAction !== null}
              onClick={() => {
                setEarlySettleModalError(null);
                setEarlySettleModalOpen(true);
              }}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-rose-200 bg-rose-50 px-4 text-xs font-black text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-40 cursor-pointer"
            >
              <V1IconAlert className="h-4 w-4 shrink-0 text-rose-600" />
              <span>대회 조기 종료 및 강제 정산</span>
            </button>

            <button
              type="button"
              data-admin-action="cleanup-remaining"
              disabled={busyAction !== null}
              onClick={() => {
                setCleanupModalError(null);
                setCleanupModalOpen(true);
              }}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-amber-200 bg-amber-50 px-4 text-xs font-black text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-40 cursor-pointer"
            >
              <V1IconRefresh className="h-4 w-4 shrink-0 text-amber-700" />
              <span>남은 포지션·미체결 주문 재정리</span>
            </button>

            <V1Button
              variant="white"
              size="sm"
              disabled={isLockedSeason || busyAction !== null}
              onClick={() => {
                setEditModalError(null);
                setEditModalOpen(true);
              }}
            >
              대회 정보 수정
            </V1Button>
          </div>
        </header>

        {/* 상세 조회 오류 배너 */}
        {effectiveLoadError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-xs sm:text-sm font-bold text-[#F6465D]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <V1IconAlert className="h-4 w-4 shrink-0" />
              <span>{effectiveLoadError.text}</span>
              {effectiveLoadError.requestId ? (
                <RequestIdChip requestId={effectiveLoadError.requestId} />
              ) : null}
            </div>
            {validSeasonId > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setLoadError(null);
                  setIsLoading(true);
                  setReloadTick(t => t + 1);
                }}
                className="shrink-0 whitespace-nowrap rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-bold text-[#F6465D] hover:bg-rose-100"
              >
                다시 시도
              </button>
            ) : null}
          </div>
        ) : null}

        {/* 운영 실행 결과 배너 */}
        {operationBanner ? (
          <div
            role={operationBanner.kind === "error" ? "alert" : "status"}
            data-admin-settlement-result="true"
            className={cn(
              "flex items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-xs sm:text-sm font-bold",
              operationBanner.kind === "error"
                ? "border-rose-200 bg-rose-50 text-[#F6465D]"
                : "border-emerald-200 bg-emerald-50 text-emerald-800",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {operationBanner.kind === "error" ? (
                <V1IconAlert className="h-4 w-4 shrink-0 text-[#F6465D]" />
              ) : (
                <V1IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              )}
              <span>{operationBanner.text}</span>
              {operationBanner.requestId ? (
                <RequestIdChip requestId={operationBanner.requestId} />
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setOperationBanner(null)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-bold",
                operationBanner.kind === "error"
                  ? "text-rose-600 hover:bg-rose-100"
                  : "text-emerald-700 hover:bg-emerald-100",
              )}
            >
              닫기
            </button>
          </div>
        ) : null}

        {effectiveIsLoading ? (
          <div
            aria-label="대회 시즌 상세 정보 불러오는 중"
            className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5 space-y-2.5"
          >
            <div className="h-4 w-48 rounded bg-gray-100" />
            <div className="h-3 w-full max-w-md rounded bg-gray-100" />
          </div>
        ) : null}

        {/* 2. 중단 3열 운영 대시보드 */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* 카드 1: 대회 개요 및 상태 제어 */}
          <article className="flex flex-col justify-between gap-5 rounded-2xl border border-gray-200 bg-white p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-black text-gray-900">
                  대회 개요 및 상태 제어
                </h2>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-black text-[#0058FF]">
                  시드 {season.seedMoney} USDT
                </span>
              </div>
              <p className="text-xs leading-relaxed font-medium text-gray-600">
                {season.description}
              </p>
            </div>

            <div className="space-y-3 border-t border-gray-100 pt-4 text-xs">
              <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-[#F9FAFB] px-4 py-3">
                <div>
                  <p className="font-black text-gray-900">시즌 공개 여부</p>
                  <p className="text-[11px] font-medium text-gray-500">
                    비공개 시 대회 허브 및 신규 거래에서 즉시 제외됩니다.
                  </p>
                </div>
                <AdminToggleSwitch
                  checked={season.isPublic}
                  disabled={season.isCancel || busyAction !== null}
                  onChange={() => void handleToggleStatus("isPublic")}
                  label="시즌 공개 여부"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-[#F9FAFB] px-4 py-3">
                <div>
                  <p className="font-black text-gray-900">시즌 취소 여부</p>
                  <p className="text-[11px] font-medium text-gray-500">
                    취소 활성화 시 참가 신청 및 시즌 매매가 즉시 차단됩니다.
                  </p>
                </div>
                <AdminToggleSwitch
                  checked={season.isCancel}
                  tone="rose"
                  disabled={isLockedSeason || busyAction !== null}
                  onChange={() => void handleToggleStatus("isCancel")}
                  label="시즌 취소 여부"
                />
              </div>
            </div>
          </article>

          {/* 카드 2: 주요 일정 및 자동 종료 스케줄 */}
          <article className="flex flex-col justify-between gap-5 rounded-2xl border border-gray-200 bg-white p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <V1IconCalendar className="h-4 w-4 text-[#0058FF]" />
                <h2 className="text-base font-black text-gray-900">
                  주요 일정 및 자동 종료 스케줄
                </h2>
              </div>

              <dl className="space-y-3 text-xs">
                <div className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3.5">
                  <dt className="font-bold text-gray-400">참가 신청 기간</dt>
                  <dd className="mt-1 font-black text-gray-900 tabular-nums">
                    {formatReadableDateTime(season.recruitmentStartAt)} ~{" "}
                    {formatReadableDateTime(season.recruitmentEndAt)}
                  </dd>
                </div>

                <div className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3.5">
                  <dt className="font-bold text-gray-400">대회 진행 기간</dt>
                  <dd className="mt-1 font-black text-gray-900 tabular-nums">
                    {formatReadableDateTime(season.contestStartAt)} ~{" "}
                    {formatReadableDateTime(season.contestEndAt)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3.5 text-xs leading-relaxed text-gray-700">
              <p className="font-black text-[#0058FF] flex items-center gap-1.5">
                <V1IconClock className="h-3.5 w-3.5" />
                <span>자동 종료 정산 스케줄러 안내</span>
              </p>
              <p className="mt-1 font-medium">
                지정된 대회 진행 종료 시각이 도래하면 60초 주기 자동 정산 스케줄러가 지갑 비활성화, 미체결 주문 500개 청크 소프트 취소, 오픈 포지션 500개 청크 강제청산 및 최종 순위 확정을 자동 수행합니다.
              </p>
            </div>
          </article>

          {/* 카드 3: 청크 500 정산 시스템 상태 & 실행 이력 */}
          <article className="flex flex-col justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-black text-gray-900">
                  청크 500 정산 시스템 상태 & 실행 이력
                </h2>
                {season.settledAt ? (
                  <span className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                    정산 완료 ({season.settledAt})
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                    미정산
                  </span>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3">
                  <dt className="font-bold text-gray-400">남은 미체결 주문 수</dt>
                  <dd
                    data-remaining-pending-orders={season.pendingOrderCount}
                    className="mt-1 text-lg font-black text-gray-900 tabular-nums"
                  >
                    {season.pendingOrderCount}건
                  </dd>
                </div>
                <div className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3">
                  <dt className="font-bold text-gray-400">남은 오픈 포지션 수</dt>
                  <dd
                    data-remaining-open-positions={season.openPositionCount}
                    className="mt-1 text-lg font-black text-gray-900 tabular-nums"
                  >
                    {season.openPositionCount}건
                  </dd>
                </div>
              </dl>

              <div className="space-y-2">
                <p className="text-xs font-black text-gray-700">최근 정산 실행 로그</p>
                <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                  {settlementRuns.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] p-4 text-center text-[11px] font-medium text-gray-500">
                      아직 실행된 정산 이력이 없습니다.
                    </div>
                  ) : (
                    settlementRuns.map(run => (
                    <div
                      key={run.attemptNo}
                      className="rounded-xl border border-gray-200 bg-[#F9FAFB] p-3 text-[11px] space-y-1"
                    >
                      <div className="flex items-center justify-between font-black text-gray-900">
                        <span>
                          실행 #{run.attemptNo} · 트리거: {run.triggeredBy}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px]",
                            run.status === "COMPLETED"
                              ? "bg-emerald-100 text-emerald-800"
                              : run.status === "FAILED"
                                ? "bg-rose-100 text-rose-800"
                                : "bg-gray-200 text-gray-700",
                          )}
                        >
                          {run.status}
                        </span>
                      </div>
                      <p className="font-bold text-[#0058FF]">{run.pipelineSummary}</p>
                      <p className="text-gray-500 tabular-nums">
                        시각: {run.executedAt} · 취소 {run.canceledOrderCount}건 · 청산{" "}
                        {run.liquidatedPositionCount}건 · 확정{" "}
                        {run.finalizedParticipantCount}명
                      </p>
                    </div>
                  ))
                  )}
                </div>
              </div>
            </div>
          </article>
        </section>

        {/* 3. 하단 참가 신청자 & 시즌 대회 지갑 관리 (ContestMembersManager 3탭) */}
        <section
          data-admin-members-manager="true"
          className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 space-y-6"
        >
          <div className="flex flex-col gap-4 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <V1IconUsers className="h-5 w-5 text-[#0058FF]" />
              <h2 className="text-lg font-black text-gray-900">
                참가 신청자 & 시즌 대회 지갑 관리
              </h2>
            </div>

            {activeMemberTab === "applicants" ? (
              <V1Button
                variant="blue"
                size="sm"
                data-admin-action="approve-selected"
                disabled={selectedApplicantIds.length === 0 || busyAction !== null || isLockedSeason}
                onClick={() => void approveApplicantsByIds(selectedApplicantIds)}
              >
                {busyAction === "approve"
                  ? "승인 처리 중…"
                  : `선택 일괄 승인 (${selectedApplicantIds.length})`}
              </V1Button>
            ) : null}
          </div>

          <V1Tabs
            tabs={[
              {
                label: `신청자 관리 (${applicants.length})`,
                value: "applicants",
                activeColor: "text-[#0058FF] border-[#0058FF]",
              },
              {
                label: `참가자 및 시즌 지갑 목록 (${participants.length})`,
                value: "participants",
                activeColor: "text-emerald-600 border-emerald-600",
              },
              {
                label: `반려 이력 (${rejectedList.length})`,
                value: "rejected",
                activeColor: "text-rose-600 border-rose-600",
              },
            ]}
            activeTab={activeMemberTab}
            onChange={value =>
              setActiveMemberTab(value as "applicants" | "participants" | "rejected")
            }
            variant="underline"
            className="gap-4 sm:gap-8"
          />

          {/* 탭 1: 신청자 관리 */}
          {activeMemberTab === "applicants" ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                  <tr>
                    <th className="w-12 px-4 py-3 text-center whitespace-nowrap">
                      <input
                        type="checkbox"
                        aria-label="전체 신청자 선택"
                        className="m-0 h-4 w-4 align-middle accent-[#0058FF]"
                        checked={isAllApplicantsSelected}
                        onChange={() =>
                          setSelectedApplicantIds(
                            isAllApplicantsSelected
                              ? []
                              : applicants.map(a => a.applicantId),
                          )
                        }
                      />
                    </th>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">신청 ID</th>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">신청자 닉네임</th>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">트레이딩 소개</th>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">신청 일시</th>
                    <th className="px-4 py-3 font-bold text-center whitespace-nowrap">승인 · 반려</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {applicants.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center font-bold text-gray-400"
                      >
                        현재 대기 중인 참가 신청자가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    applicants.map(applicant => (
                      <tr key={applicant.applicantId} className="hover:bg-gray-50">
                        <td className="px-4 py-3.5 text-center whitespace-nowrap">
                          <input
                            type="checkbox"
                            aria-label={`${applicant.nickname} 선택`}
                            className="m-0 h-4 w-4 align-middle accent-[#0058FF]"
                            checked={selectedApplicantIds.includes(
                              applicant.applicantId,
                            )}
                            onChange={() =>
                              setSelectedApplicantIds(prev =>
                                prev.includes(applicant.applicantId)
                                  ? prev.filter(id => id !== applicant.applicantId)
                                  : [...prev, applicant.applicantId],
                              )
                            }
                          />
                        </td>
                        <td className="px-4 py-3.5 font-black text-gray-500 tabular-nums whitespace-nowrap">
                          #{applicant.applicantId}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <Link
                            href={`/members/${applicant.memberId}`}
                            className="inline-flex items-center gap-2.5 font-bold text-gray-900 hover:text-[#0058FF] whitespace-nowrap"
                          >
                            <V1UserAvatar
                              memberId={applicant.memberId}
                              nickname={applicant.nickname}
                              size="sm"
                            />
                            <span>{applicant.nickname}</span>
                          </Link>
                        </td>
                        <td className="max-w-[260px] px-4 py-3.5 text-gray-600">
                          <p className="truncate">{applicant.profileMsg}</p>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-gray-500 tabular-nums whitespace-nowrap">
                          {applicant.appliedAt}
                        </td>
                        <td className="px-4 py-3.5 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              data-admin-approve-applicant={applicant.applicantId}
                              disabled={busyAction !== null || isLockedSeason}
                              onClick={() =>
                                void approveApplicantsByIds([applicant.applicantId])
                              }
                              className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40 cursor-pointer"
                            >
                              승인
                            </button>
                            <button
                              type="button"
                              data-admin-reject-applicant={applicant.applicantId}
                              disabled={busyAction !== null || isLockedSeason}
                              onClick={() => {
                                setRejectModalError(null);
                                setRejectTarget(applicant);
                                setRejectReasonInput("");
                              }}
                              className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-40 cursor-pointer"
                            >
                              반려
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* 탭 2: 참가자 및 시즌 지갑 목록 */}
          {activeMemberTab === "participants" ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">참가자 ID</th>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">닉네임</th>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">시즌 전용 지갑 ID · 상태</th>
                    <th className="px-4 py-3 font-bold text-right whitespace-nowrap">초기 시드머니</th>
                    <th className="px-4 py-3 font-bold text-right whitespace-nowrap">평가자산</th>
                    <th className="px-4 py-3 font-bold text-right whitespace-nowrap">실현손익 · 수익률</th>
                    <th className="px-4 py-3 font-bold text-center whitespace-nowrap">미체결 주문</th>
                    <th className="px-4 py-3 font-bold text-center whitespace-nowrap">오픈 포지션</th>
                    <th className="px-4 py-3 font-bold text-center whitespace-nowrap">현재/최종 순위</th>
                    <th className="px-4 py-3 font-bold text-center whitespace-nowrap">운영 조치</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {participants.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center font-bold text-gray-400">
                        현재 승인된 시즌 참가자가 없습니다.
                      </td>
                    </tr>
                  ) : null}
                  {participants.map(participant => (
                    <tr key={participant.participantId} className="hover:bg-gray-50">
                      <td className="px-4 py-3.5 font-black text-gray-500 tabular-nums whitespace-nowrap">
                        #{participant.participantId}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <Link
                          href={`/members/${participant.memberId}`}
                          className="inline-flex items-center gap-2.5 font-bold text-gray-900 hover:text-[#0058FF] whitespace-nowrap"
                        >
                          <V1UserAvatar
                            memberId={participant.memberId}
                            nickname={participant.nickname}
                            size="sm"
                          />
                          <span>{participant.nickname}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span className="font-bold text-gray-700 tabular-nums">
                            W-{participant.walletId}
                          </span>
                          <span
                            className={cn(
                              "inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-black",
                              participant.walletStatus === "ACTIVE"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-gray-100 text-gray-600 border border-gray-200",
                            )}
                          >
                            {participant.walletStatus === "ACTIVE" ? "활성" : "비활성"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-gray-500 tabular-nums whitespace-nowrap">
                        {participant.seedMoney}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-gray-900 tabular-nums whitespace-nowrap">
                        {participant.equity}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3.5 text-right font-black tabular-nums whitespace-nowrap",
                          participant.realizedPnl.startsWith("-") || participant.roi.startsWith("-")
                            ? "text-[#F6465D]"
                            : participant.roi === "0.00%"
                              ? "text-gray-700"
                              : "text-[#0ECB81]",
                        )}
                      >
                        {participant.realizedPnl} ({participant.roi})
                      </td>
                      <td className="px-4 py-3.5 text-center font-bold text-gray-700 tabular-nums whitespace-nowrap">
                        {participant.pendingOrderCount}건
                      </td>
                      <td className="px-4 py-3.5 text-center font-bold text-gray-700 tabular-nums whitespace-nowrap">
                        {participant.openPositionCount}건
                      </td>
                      <td className="px-4 py-3.5 text-center font-black text-gray-900 tabular-nums whitespace-nowrap">
                        {participant.rank}위
                      </td>
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        {participant.walletStatus === "ACTIVE" && !isLockedSeason ? (
                          <button
                            type="button"
                            data-admin-disqualify-participant={participant.memberId}
                            disabled={busyAction !== null}
                            onClick={() => {
                              setDisqualifyModalError(null);
                              setDisqualifyReasonInput("");
                              setDisqualifyTarget(participant);
                            }}
                            className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-[#F6465D] hover:bg-rose-100 disabled:opacity-40 cursor-pointer"
                          >
                            실격 처리
                          </button>
                        ) : (
                          <span className="text-[11px] font-medium text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* 탭 3: 반려 이력 */}
          {activeMemberTab === "rejected" ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">신청자 닉네임</th>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">신청 일시</th>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">반려 사유</th>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">반려 일시</th>
                    <th className="px-4 py-3 font-bold whitespace-nowrap">처리 관리자</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {rejectedList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center font-bold text-gray-400">
                        반려 처리된 신청 이력이 없습니다.
                      </td>
                    </tr>
                  ) : null}
                  {rejectedList.map(item => (
                    <tr key={item.rejectedId} className="hover:bg-gray-50">
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <Link
                          href={`/members/${item.memberId}`}
                          className="inline-flex items-center gap-2.5 font-bold text-gray-900 hover:text-[#0058FF] whitespace-nowrap"
                        >
                          <V1UserAvatar
                            memberId={item.memberId}
                            nickname={item.nickname}
                            size="sm"
                          />
                          <span>{item.nickname}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 font-medium text-gray-500 tabular-nums whitespace-nowrap">
                        {item.appliedAt}
                      </td>
                      <td className="max-w-[280px] px-4 py-3.5">
                        <span className="inline-flex rounded-xl border border-rose-200 bg-rose-50 px-3 py-1 font-bold text-rose-700">
                          {item.rejectReason}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-medium text-gray-500 tabular-nums whitespace-nowrap">
                        {item.rejectedAt}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-gray-700 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          <V1IconShield className="h-3.5 w-3.5 shrink-0 text-[#0058FF]" />
                          <span>{item.processedBy}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>

      {/* 1. 대회 조기 종료 및 강제 정산 확인 모달 */}
      <DimModal
        open={earlySettleModalOpen}
        onClose={() => {
          if (busyAction !== "early-settle") {
            setEarlySettleModalError(null);
            setEarlySettleModalOpen(false);
          }
        }}
        title="대회 조기 종료 및 강제 정산 확인"
        subtitle={`시즌 #${season.id} · ${season.title}`}
        footer={
          <div className="flex justify-end gap-2">
            <V1Button
              variant="white"
              size="sm"
              disabled={busyAction === "early-settle"}
              onClick={() => {
                setEarlySettleModalError(null);
                setEarlySettleModalOpen(false);
              }}
            >
              취소
            </V1Button>
            <V1Button
              variant="red"
              size="sm"
              data-admin-confirm="early-finish-settle"
              disabled={busyAction === "early-settle"}
              onClick={() => void handleConfirmEarlyFinishSettle()}
            >
              {busyAction === "early-settle"
                ? "강제 정산 실행 중…"
                : "조기 종료 및 강제 정산 실행"}
            </V1Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs sm:text-sm leading-relaxed text-gray-800">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900">
            이 대회 시즌을 마무리(조기 종료 및 정산)하시겠습니까? 대회 종료 시각이 즉시 현재 시각으로 마감되며, 시즌 내 모든 미체결(PENDING) 주문은 500개 청크 단위로 소프트 취소(CANCELED) 처리되고, 모든 오픈 포지션은 현재 마크가격 스냅샷 기준으로 500개 청크 단위 강제청산된 뒤 최종 순위가 확정됩니다.
          </div>
          <ul className="list-disc space-y-1.5 pl-5 text-xs font-medium text-gray-600">
            <li>정산 시작 즉시 대회 종료 일시가 현재 시각으로 정렬되어 신규 주문이 원천 차단됩니다.</li>
            <li>현재 취소 대상 미체결 주문: {season.pendingOrderCount}건 (Keyset 500개 청크 단위 소프트 취소)</li>
            <li>현재 강제청산 대상 오픈 포지션: {season.openPositionCount}건 (Keyset 500개 청크 단위 마크가격 정산)</li>
          </ul>
          {earlySettleModalError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-[#F6465D]"
            >
              <V1IconAlert className="h-4 w-4 shrink-0" />
              <span>{earlySettleModalError.text}</span>
              {earlySettleModalError.requestId ? (
                <RequestIdChip requestId={earlySettleModalError.requestId} />
              ) : null}
            </div>
          ) : null}
        </div>
      </DimModal>

      {/* 2. 남은 포지션·미체결 주문 재정리 확인 모달 */}
      <DimModal
        open={cleanupModalOpen}
        onClose={() => {
          if (busyAction !== "cleanup-remaining") {
            setCleanupModalError(null);
            setCleanupModalOpen(false);
          }
        }}
        title="남은 포지션·미체결 주문 500청크 재정리"
        subtitle={`시즌 #${season.id} · ${season.title}`}
        footer={
          <div className="flex justify-end gap-2">
            <V1Button
              variant="white"
              size="sm"
              disabled={busyAction === "cleanup-remaining"}
              onClick={() => {
                setCleanupModalError(null);
                setCleanupModalOpen(false);
              }}
            >
              취소
            </V1Button>
            <V1Button
              variant="blue"
              size="sm"
              data-admin-confirm="cleanup-remaining"
              disabled={busyAction === "cleanup-remaining"}
              onClick={() => void handleConfirmCleanupRemaining()}
            >
              {busyAction === "cleanup-remaining"
                ? "재정리 실행 중…"
                : "잔여 주문 취소·포지션 강제청산 재실행"}
            </V1Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs sm:text-sm leading-relaxed text-gray-800">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 font-bold text-amber-900">
            마무리된 대회 시즌에 남아 있는 미체결 주문과 오픈 포지션을 다시 500개 청크 단위로 소프트 취소 및 강제청산하고 최종 순위를 재집계하시겠습니까?
          </div>
          <p className="text-xs font-medium text-gray-600">
            이미 정산 완료된 포지션과 취소된 주문은 멱등 가드에 의해 안전하게 건너뛰며, 미처리 잔여 건만 선택적으로 정리한 뒤 올림픽 순위를 다시 산출합니다.
          </p>
          {cleanupModalError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-[#F6465D]"
            >
              <V1IconAlert className="h-4 w-4 shrink-0" />
              <span>{cleanupModalError.text}</span>
              {cleanupModalError.requestId ? (
                <RequestIdChip requestId={cleanupModalError.requestId} />
              ) : null}
            </div>
          ) : null}
        </div>
      </DimModal>

      {/* 3. 신청자 반려 사유 입력 모달 */}
      <DimModal
        open={Boolean(rejectTarget)}
        onClose={() => {
          if (busyAction !== "reject") {
            setRejectModalError(null);
            setRejectTarget(null);
          }
        }}
        title="대회 참가 신청 반려"
        subtitle={
          rejectTarget
            ? `신청자: ${rejectTarget.nickname} (#${rejectTarget.applicantId})`
            : ""
        }
      >
        <form onSubmit={handleConfirmReject} className="space-y-4 text-xs sm:text-sm">
          <div className="space-y-1.5">
            <label
              htmlFor="reject-reason-textarea"
              className="block text-xs font-black text-gray-800"
            >
              반려 사유 입력
            </label>
            <textarea
              id="reject-reason-textarea"
              rows={3}
              value={rejectReasonInput}
              onChange={event => setRejectReasonInput(event.currentTarget.value)}
              placeholder="신청자에게 안내될 반려 사유를 입력해 주세요."
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
            />
          </div>
          {rejectModalError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-[#F6465D]"
            >
              <V1IconAlert className="h-4 w-4 shrink-0" />
              <span>{rejectModalError.text}</span>
              {rejectModalError.requestId ? (
                <RequestIdChip requestId={rejectModalError.requestId} />
              ) : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <V1Button
              variant="white"
              size="sm"
              disabled={busyAction === "reject"}
              onClick={() => {
                setRejectModalError(null);
                setRejectTarget(null);
              }}
            >
              취소
            </V1Button>
            <V1Button
              type="submit"
              variant="red"
              size="sm"
              disabled={busyAction === "reject"}
            >
              {busyAction === "reject" ? "반려 처리 중…" : "반려 처리 확정"}
            </V1Button>
          </div>
        </form>
      </DimModal>

      {/* 4. 대회 정보 수정 모달 */}
      {editModalOpen ? (
        <ContestCreateEditModal
          open={editModalOpen}
          mode="edit"
          initialSeason={season}
          saving={busyAction === "edit-season"}
          externalError={editModalError}
          onClose={() => {
            if (busyAction !== "edit-season") {
              setEditModalError(null);
              setEditModalOpen(false);
            }
          }}
          onSave={handleSaveSeasonEdit}
        />
      ) : null}

      {/* 5. 시즌 영구 취소 확인 모달 */}
      <DimModal
        open={cancelSeasonModalOpen}
        onClose={() => {
          if (busyAction !== "cancel-season") {
            setCancelModalError(null);
            setCancelSeasonModalOpen(false);
          }
        }}
        title="대회 시즌 영구 취소 확인"
        subtitle={`시즌 #${season.id} · ${season.title}`}
        footer={
          <div className="flex justify-end gap-2">
            <V1Button
              variant="white"
              size="sm"
              disabled={busyAction === "cancel-season"}
              onClick={() => {
                setCancelModalError(null);
                setCancelSeasonModalOpen(false);
              }}
            >
              돌아가기
            </V1Button>
            <V1Button
              variant="red"
              size="sm"
              data-admin-confirm="cancel-season"
              disabled={busyAction === "cancel-season"}
              onClick={() => void handleConfirmCancelSeason()}
            >
              {busyAction === "cancel-season" ? "취소 처리 중…" : "시즌 영구 취소 실행"}
            </V1Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs sm:text-sm leading-relaxed text-gray-800">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-800">
            이 작업은 되돌릴 수 없습니다. 시즌을 취소하면 참가 신청 및 신규 주문이 즉시 차단되고, 열려 있는 포지션({season.openPositionCount}건) 종료·미체결 주문({season.pendingOrderCount}건) 취소 및 대기 중인 참가 신청이 취소 처리됩니다.
          </div>
          <p className="text-xs font-medium text-gray-600">
            취소가 완료된 시즌은 다시 정상 운영 상태로 되돌릴 수 없습니다.
          </p>
          {cancelModalError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-[#F6465D]"
            >
              <V1IconAlert className="h-4 w-4 shrink-0" />
              <span>{cancelModalError.text}</span>
              {cancelModalError.requestId ? (
                <RequestIdChip requestId={cancelModalError.requestId} />
              ) : null}
            </div>
          ) : null}
        </div>
      </DimModal>

      {/* 6. 참가자 실격 처리 확인 모달 */}
      <DimModal
        open={disqualifyTarget !== null}
        onClose={() => {
          if (busyAction !== "disqualify") {
            setDisqualifyModalError(null);
            setDisqualifyTarget(null);
          }
        }}
        title="대회 참가자 실격 처리"
        subtitle={
          disqualifyTarget
            ? `${disqualifyTarget.nickname} (회원 #${disqualifyTarget.memberId} · 지갑 W-${disqualifyTarget.walletId})`
            : undefined
        }
      >
        {disqualifyTarget ? (
          <form onSubmit={handleConfirmDisqualify} className="space-y-4 text-xs sm:text-sm">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900">
              &quot;{disqualifyTarget.nickname}&quot; 참가자를 본 시즌에서 실격 처리하시겠습니까?
              실격 즉시 시즌 전용 지갑이 비활성화되며 미체결 주문({disqualifyTarget.pendingOrderCount}건) 취소 및 오픈 포지션({disqualifyTarget.openPositionCount}건)이 청산 처리됩니다.
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="disqualify-reason-textarea"
                className="block text-xs font-black text-gray-800"
              >
                실격 사유 (선택)
              </label>
              <textarea
                id="disqualify-reason-textarea"
                rows={3}
                maxLength={500}
                value={disqualifyReasonInput}
                onChange={event => setDisqualifyReasonInput(event.currentTarget.value)}
                placeholder="예: 비정상 반복 거래 또는 운영 정책 위반"
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
              />
            </div>
            {disqualifyModalError ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-[#F6465D]"
              >
                <V1IconAlert className="h-4 w-4 shrink-0" />
                <span>{disqualifyModalError.text}</span>
                {disqualifyModalError.requestId ? (
                  <RequestIdChip requestId={disqualifyModalError.requestId} />
                ) : null}
              </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
              <V1Button
                variant="white"
                size="sm"
                disabled={busyAction === "disqualify"}
                onClick={() => {
                  setDisqualifyModalError(null);
                  setDisqualifyTarget(null);
                }}
              >
                취소
              </V1Button>
              <V1Button
                type="submit"
                variant="red"
                size="sm"
                data-admin-confirm="disqualify-participant"
                disabled={busyAction === "disqualify"}
              >
                {busyAction === "disqualify" ? "실격 처리 중…" : "참가자 실격 확정"}
              </V1Button>
            </div>
          </form>
        ) : null}
      </DimModal>
    </AdminShell>
  );
}
