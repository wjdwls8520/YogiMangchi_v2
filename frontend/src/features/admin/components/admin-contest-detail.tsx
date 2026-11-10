"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  approveAdminContestApplicant,
  bulkApproveAdminContestApplicants,
  cleanupRemainingAdminContestSeason,
  fetchAdminContestSeasonDetail,
  formatContestDateTime,
  formatContestSignedRoi,
  formatContestSignedUsdt,
  formatContestUsdt,
  isNonNegativeContestDecimal,
  patchAdminContestSeasonStatus,
  rejectAdminContestApplicant,
  settleAdminContestSeason,
  toDatetimeLocalInput,
  toIsoInstantFromInput,
  updateAdminContestSeason,
  type AdminSeasonDetailResponse,
} from "../../contest/api/contest-client";
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
  INITIAL_ADMIN_CONTEST_SEASONS,
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
  status: "COMPLETED" | "READY";
  executedAt: string;
  pipelineSummary: string;
  deactivatedWalletCount: number;
  canceledOrderCount: number;
  liquidatedPositionCount: number;
  finalizedParticipantCount: number;
}

const INITIAL_APPLICANTS: AdminContestApplicantItem[] = [
  {
    applicantId: 501,
    memberId: 71,
    nickname: "델타헤저",
    appliedAt: "2026.11.10 10:15",
    profileMsg: "BTC/ETH 변동성 돌파 및 펀딩비 전략",
  },
  {
    applicantId: 502,
    memberId: 72,
    nickname: "차트아키텍트",
    appliedAt: "2026.11.10 11:42",
    profileMsg: "4시간봉 추세 매매 원칙 준수",
  },
  {
    applicantId: 503,
    memberId: 73,
    nickname: "스캘핑장인",
    appliedAt: "2026.11.10 12:08",
    profileMsg: "단기 호가창 수급 분석 트레이더",
  },
];

const INITIAL_PARTICIPANTS: AdminContestParticipantWalletItem[] = [
  {
    participantId: 1001,
    memberId: 11,
    nickname: "알파트레이더",
    walletId: 92001,
    walletStatus: "ACTIVE",
    seedMoney: "10,000.00 USDT",
    equity: "24,850.00 USDT",
    realizedPnl: "+14,850.00 USDT",
    roi: "+148.50%",
    isPositive: true,
    pendingOrderCount: 3,
    openPositionCount: 2,
    rank: 1,
    approvedAt: "2026.10.28 14:20",
    approvedBy: "총괄관리자",
  },
  {
    participantId: 1002,
    memberId: 22,
    nickname: "솔라나고래",
    walletId: 92002,
    walletStatus: "ACTIVE",
    seedMoney: "10,000.00 USDT",
    equity: "19,320.40 USDT",
    realizedPnl: "+9,320.40 USDT",
    roi: "+93.20%",
    isPositive: true,
    pendingOrderCount: 2,
    openPositionCount: 1,
    rank: 2,
    approvedAt: "2026.10.29 09:10",
    approvedBy: "총괄관리자",
  },
  {
    participantId: 1003,
    memberId: 15,
    nickname: "퀀트매니저",
    walletId: 92003,
    walletStatus: "ACTIVE",
    seedMoney: "10,000.00 USDT",
    equity: "16,740.00 USDT",
    realizedPnl: "+6,740.00 USDT",
    roi: "+67.40%",
    isPositive: true,
    pendingOrderCount: 1,
    openPositionCount: 2,
    rank: 3,
    approvedAt: "2026.10.29 16:45",
    approvedBy: "총괄관리자",
  },
  {
    participantId: 1004,
    memberId: 31,
    nickname: "매크로워처",
    walletId: 92004,
    walletStatus: "ACTIVE",
    seedMoney: "10,000.00 USDT",
    equity: "13,480.50 USDT",
    realizedPnl: "+3,480.50 USDT",
    roi: "+34.81%",
    isPositive: true,
    pendingOrderCount: 0,
    openPositionCount: 1,
    rank: 4,
    approvedAt: "2026.10.30 11:30",
    approvedBy: "총괄관리자",
  },
];

const INITIAL_REJECTED: AdminContestRejectedItem[] = [
  {
    rejectedId: 301,
    memberId: 88,
    nickname: "테스트계정01",
    appliedAt: "2026.10.27 18:12",
    rejectedAt: "2026.10.28 09:05",
    rejectReason: "동일 회차 중복 신청 계정에 해당하여 반려 처리되었습니다.",
    processedBy: "총괄관리자",
  },
];

function resolveInitialSeason(seasonIdInput: number | string): AdminContestSeasonRecord {
  const numericId = Number(seasonIdInput);
  const safeId = Number.isFinite(numericId) && numericId > 0 ? numericId : 202602;
  const matched = INITIAL_ADMIN_CONTEST_SEASONS.find(item => item.id === safeId);
  if (matched) return matched;
  return {
    ...INITIAL_ADMIN_CONTEST_SEASONS[1]!,
    id: safeId,
    title: `2026 정규 시즌 #${safeId} 선물 수익률 대회`,
  };
}

export function AdminContestDetail({
  seasonId,
}: {
  seasonId: number | string;
}) {
  const memberCtx = useOptionalMember();
  const [season, setSeason] = useState<AdminContestSeasonRecord>(() =>
    resolveInitialSeason(seasonId),
  );
  const [applicants, setApplicants] =
    useState<AdminContestApplicantItem[]>(INITIAL_APPLICANTS);
  const [participants, setParticipants] = useState<
    AdminContestParticipantWalletItem[]
  >(INITIAL_PARTICIPANTS);
  const [rejectedList, setRejectedList] =
    useState<AdminContestRejectedItem[]>(INITIAL_REJECTED);

  const [selectedApplicantIds, setSelectedApplicantIds] = useState<number[]>([]);
  const [activeMemberTab, setActiveMemberTab] = useState<
    "applicants" | "participants" | "rejected"
  >("applicants");

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [earlySettleModalOpen, setEarlySettleModalOpen] = useState(false);
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<AdminContestApplicantItem | null>(
    null,
  );
  const [rejectReasonInput, setRejectReasonInput] = useState("");
  const [operationBanner, setOperationBanner] = useState<string | null>(null);

  const [settlementRuns, setSettlementRuns] = useState<ContestSettlementRunLog[]>([
    {
      attemptNo: 1,
      triggeredBy: "SYSTEM_SCHEDULER",
      status: season.settledAt ? "COMPLETED" : "READY",
      executedAt: season.settledAt ?? "종료 시각 도래 대기 중 (60초 주기 감시)",
      pipelineSummary:
        "가격 스냅샷 → 지갑 비활성화 → 미체결 주문 500청크 소프트 취소 → 오픈 포지션 500청크 강제청산 → 올림픽 순위 확정",
      deactivatedWalletCount: season.settledAt ? season.participantCount : 0,
      canceledOrderCount: 0,
      liquidatedPositionCount: 0,
      finalizedParticipantCount: season.settledAt ? season.participantCount : 0,
    },
  ]);

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
        profileMsg: "시즌 대회 참가 신청",
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
        approvedBy: "총괄관리자",
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
        processedBy: "총괄관리자",
      })),
    );

    if (detail.settlementRuns.length > 0) {
      setSettlementRuns(
        detail.settlementRuns.map(run => ({
          attemptNo: run.attemptNo,
          triggeredBy: run.triggeredBy.startsWith("ADMIN") ? "ADMIN" : "SYSTEM_SCHEDULER",
          status: run.status === "COMPLETED" ? "COMPLETED" : "READY",
          executedAt: formatContestDateTime(run.completedAt ?? run.startedAt),
          pipelineSummary:
            "가격 스냅샷 → 지갑 비활성화 → 미체결 주문 500청크 소프트 취소 → 오픈 포지션 500청크 강제청산 → 올림픽 순위 확정",
          deactivatedWalletCount: run.deactivatedWalletCount,
          canceledOrderCount: run.canceledOrderCount,
          liquidatedPositionCount: run.liquidatedPositionCount,
          finalizedParticipantCount: run.finalizedParticipantCount,
        })),
      );
    }
  }

  function reloadDetailFromServer(targetId: number) {
    const requestDetail =
      memberCtx?.snapshot.phase === "ready" && memberCtx.session
        ? memberCtx.session.authorized(cred =>
            fetchAdminContestSeasonDetail(targetId, { token: cred.accessToken }),
          )
        : fetchAdminContestSeasonDetail(targetId);

    void requestDetail
      .then(detail => {
        if (detail && detail.season) {
          applyDetailResponse(detail);
        }
      })
      .catch(() => {
        // Keep current state when server is unreachable
      });
  }

  useEffect(() => {
    const controller = new AbortController();
    const targetId = resolveInitialSeason(seasonId).id;
    const requestDetail =
      memberCtx?.snapshot.phase === "ready" && memberCtx.session
        ? memberCtx.session.authorized(cred =>
            fetchAdminContestSeasonDetail(targetId, {
              token: cred.accessToken,
              signal: controller.signal,
            }),
          )
        : fetchAdminContestSeasonDetail(targetId, { signal: controller.signal });

    void requestDetail
      .then(detail => {
        if (detail && detail.season) {
          applyDetailResponse(detail);
        }
      })
      .catch(() => {
        // Keep fallback detail seed data when server is unreachable
      });

    return () => controller.abort();
  }, [seasonId, memberCtx?.session, memberCtx?.snapshot.phase]);

  const displayStatus = resolveDisplayStatus(season);
  const isAllApplicantsSelected =
    applicants.length > 0 && selectedApplicantIds.length === applicants.length;

  function handleToggleStatus(field: "isPublic" | "isCancel") {
    let nextValue = false;
    setSeason(prev => {
      nextValue = !prev[field];
      const next = { ...prev, [field]: nextValue };
      const label =
        field === "isPublic"
          ? next.isPublic
            ? "공개중"
            : "비공개"
          : next.isCancel
            ? "취소됨"
            : "정상 운영";
      setOperationBanner(
        `시즌 #${next.id} "${next.title}" 상태가 [${label}](으)로 즉시 반영되었습니다.`,
      );
      return next;
    });

    const patchBody = field === "isPublic" ? { isPublic: nextValue } : { isCanceled: nextValue };
    const callPatch =
      memberCtx?.snapshot.phase === "ready" && memberCtx.session
        ? memberCtx.session.authorized(cred =>
            patchAdminContestSeasonStatus(season.id, patchBody, { token: cred.accessToken }),
          )
        : patchAdminContestSeasonStatus(season.id, patchBody);

    void callPatch
      .then(updatedView => {
        if (!updatedView) return;
        setSeason(prev => ({
          ...prev,
          ...mapSeasonViewToAdminRecord(updatedView),
        }));
      })
      .catch(() => {
        // Keep optimistic toggle state
      });
  }

  function handleSaveSeasonEdit(draft: ContestFormDraft) {
    setSeason(prev => ({
      ...prev,
      title: draft.title,
      description: draft.description,
      seedMoney: draft.seedMoney,
      recruitmentStartAt: draft.recruitmentStartAt,
      recruitmentEndAt: draft.recruitmentEndAt,
      contestStartAt: draft.contestStartAt,
      contestEndAt: draft.contestEndAt,
      isPublic: draft.isPublic,
    }));
    setEditModalOpen(false);
    setOperationBanner(`시즌 #${season.id} "${draft.title}" 정보가 저장되었습니다.`);

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
    const callUpdate =
      memberCtx?.snapshot.phase === "ready" && memberCtx.session
        ? memberCtx.session.authorized(cred =>
            updateAdminContestSeason(season.id, payload, { token: cred.accessToken }),
          )
        : updateAdminContestSeason(season.id, payload);

    void callUpdate
      .then(updatedView => {
        if (!updatedView) return;
        setSeason(prev => ({
          ...prev,
          ...mapSeasonViewToAdminRecord(updatedView),
        }));
      })
      .catch(() => {
        // Keep optimistic edit state
      });
  }

  function handleConfirmEarlyFinishSettle() {
    const deactivatedCount = participants.length || season.participantCount;
    const canceledCount =
      season.pendingOrderCount ||
      participants.reduce((acc, cur) => acc + cur.pendingOrderCount, 0) ||
      128;
    const liquidatedCount =
      season.openPositionCount ||
      participants.reduce((acc, cur) => acc + cur.openPositionCount, 0) ||
      342;
    const finalizedCount = participants.length || season.participantCount;
    const nowStamp = "2026.11.10 22:30";

    setSeason(prev => ({
      ...prev,
      contestEndAt: "2026-11-10T22:30",
      settledAt: nowStamp,
      progressState: "정산완료",
      pendingOrderCount: 0,
      openPositionCount: 0,
    }));

    setParticipants(prev =>
      prev.map(p => ({
        ...p,
        walletStatus: "INACTIVE",
        pendingOrderCount: 0,
        openPositionCount: 0,
      })),
    );

    setSettlementRuns(prev => [
      {
        attemptNo: prev.length + 1,
        triggeredBy: "ADMIN",
        status: "COMPLETED",
        executedAt: nowStamp,
        pipelineSummary:
          "가격 스냅샷 → 지갑 비활성화 → 미체결 주문 500청크 소프트 취소 → 오픈 포지션 500청크 강제청산 → 올림픽 순위 확정",
        deactivatedWalletCount: deactivatedCount,
        canceledOrderCount: canceledCount,
        liquidatedPositionCount: liquidatedCount,
        finalizedParticipantCount: finalizedCount,
      },
      ...prev,
    ]);

    setEarlySettleModalOpen(false);
    setOperationBanner(
      `정산 완료: 비활성화 지갑 ${deactivatedCount}건 · 미체결 주문 소프트 취소 ${canceledCount}건 · 포지션 강제청산 ${liquidatedCount}건 · 최종 순위 확정 ${finalizedCount}명`,
    );

    const callSettle =
      memberCtx?.snapshot.phase === "ready" && memberCtx.session
        ? memberCtx.session.authorized(cred =>
            settleAdminContestSeason(season.id, { token: cred.accessToken }),
          )
        : settleAdminContestSeason(season.id);

    void callSettle
      .then(res => {
        if (!res) return;
        const settledLabel = formatContestDateTime(res.settledAt ?? res.completedAt) || nowStamp;
        setSeason(prev => ({
          ...prev,
          contestEndAt: toDatetimeLocalInput(res.settledAt ?? res.completedAt ?? prev.contestEndAt),
          settledAt: settledLabel,
          progressState: "정산완료",
          pendingOrderCount: 0,
          openPositionCount: 0,
        }));
        setOperationBanner(
          `정산 완료: 비활성화 지갑 ${res.deactivatedWalletCount}건 · 미체결 주문 소프트 취소 ${res.canceledOrderCount}건 · 포지션 강제청산 ${res.liquidatedPositionCount}건 · 최종 순위 확정 ${res.finalizedParticipantCount}명`,
        );
        reloadDetailFromServer(season.id);
      })
      .catch(() => {
        // Keep optimistic settlement state
      });
  }

  function handleConfirmCleanupRemaining() {
    const canceledCount = season.pendingOrderCount;
    const liquidatedCount = season.openPositionCount;
    const finalizedCount = participants.length || season.participantCount;
    const nowStamp = "2026.11.10 22:35";

    setSeason(prev => ({
      ...prev,
      settledAt: prev.settledAt ?? nowStamp,
      progressState: "정산완료",
      pendingOrderCount: 0,
      openPositionCount: 0,
    }));

    setParticipants(prev =>
      prev.map(p => ({
        ...p,
        walletStatus: "INACTIVE",
        pendingOrderCount: 0,
        openPositionCount: 0,
      })),
    );

    setSettlementRuns(prev => [
      {
        attemptNo: prev.length + 1,
        triggeredBy: "ADMIN",
        status: "COMPLETED",
        executedAt: nowStamp,
        pipelineSummary:
          "가격 스냅샷 → 지갑 비활성화 → 미체결 주문 500청크 소프트 취소 → 오픈 포지션 500청크 강제청산 → 올림픽 순위 확정",
        deactivatedWalletCount: participants.length,
        canceledOrderCount: canceledCount,
        liquidatedPositionCount: liquidatedCount,
        finalizedParticipantCount: finalizedCount,
      },
      ...prev,
    ]);

    setCleanupModalOpen(false);
    setOperationBanner(
      `잔여 재정리 완료: 미체결 주문 500청크 소프트 취소 ${canceledCount}건 · 오픈 포지션 500청크 강제청산 ${liquidatedCount}건 · 최종 순위 재집계 ${finalizedCount}명`,
    );

    const callCleanup =
      memberCtx?.snapshot.phase === "ready" && memberCtx.session
        ? memberCtx.session.authorized(cred =>
            cleanupRemainingAdminContestSeason(season.id, { token: cred.accessToken }),
          )
        : cleanupRemainingAdminContestSeason(season.id);

    void callCleanup
      .then(res => {
        if (!res) return;
        setOperationBanner(
          `잔여 재정리 완료: 미체결 주문 500청크 소프트 취소 ${res.canceledOrderCount}건 · 오픈 포지션 500청크 강제청산 ${res.liquidatedPositionCount}건 · 최종 순위 재집계 ${res.finalizedParticipantCount}명`,
        );
        reloadDetailFromServer(season.id);
      })
      .catch(() => {
        // Keep optimistic cleanup state
      });
  }

  function approveApplicantsByIds(targetIds: number[]) {
    if (targetIds.length === 0) return;
    const approvedItems = applicants.filter(item =>
      targetIds.includes(item.applicantId),
    );
    if (approvedItems.length === 0) return;

    setApplicants(prev =>
      prev.filter(item => !targetIds.includes(item.applicantId)),
    );
    setSelectedApplicantIds(prev => prev.filter(id => !targetIds.includes(id)));

    const newlyCreatedParticipants: AdminContestParticipantWalletItem[] =
      approvedItems.map((item, idx) => ({
        participantId: 2000 + item.applicantId,
        memberId: item.memberId,
        nickname: item.nickname,
        walletId: 95000 + item.applicantId,
        walletStatus: season.settledAt ? "INACTIVE" : "ACTIVE",
        seedMoney: `${season.seedMoney}.00 USDT`,
        equity: `${season.seedMoney}.00 USDT`,
        realizedPnl: "0.00 USDT",
        roi: "0.00%",
        isPositive: true,
        pendingOrderCount: 0,
        openPositionCount: 0,
        rank: participants.length + idx + 1,
        approvedAt: "2026.11.10 22:20",
        approvedBy: "총괄관리자",
      }));

    setParticipants(prev => [...newlyCreatedParticipants, ...prev]);
    setSeason(prev => ({
      ...prev,
      applicantCount: Math.max(0, prev.applicantCount - approvedItems.length),
      participantCount: prev.participantCount + approvedItems.length,
    }));
    setActiveMemberTab("participants");
    setOperationBanner(
      `${approvedItems.length}명의 참가 신청을 승인하고 시즌 전용 ${season.seedMoney} USDT 대회 지갑(ACTIVE)을 자동 발급했습니다.`,
    );

    const callApprove =
      targetIds.length === 1
        ? memberCtx?.snapshot.phase === "ready" && memberCtx.session
          ? memberCtx.session.authorized(cred =>
              approveAdminContestApplicant(season.id, targetIds[0]!, {
                token: cred.accessToken,
              }),
            )
          : approveAdminContestApplicant(season.id, targetIds[0]!)
        : memberCtx?.snapshot.phase === "ready" && memberCtx.session
          ? memberCtx.session.authorized(cred =>
              bulkApproveAdminContestApplicants(season.id, targetIds, {
                token: cred.accessToken,
              }),
            )
          : bulkApproveAdminContestApplicants(season.id, targetIds);

    void callApprove
      .then(() => reloadDetailFromServer(season.id))
      .catch(() => {
        // Keep optimistic approved participants
      });
  }

  function handleConfirmReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectTarget) return;
    const targetAppId = rejectTarget.applicantId;
    const reason =
      rejectReasonInput.trim() || "시즌 참가 기준 미충족으로 반려되었습니다.";

    setApplicants(prev =>
      prev.filter(item => item.applicantId !== targetAppId),
    );
    setSelectedApplicantIds(prev =>
      prev.filter(id => id !== targetAppId),
    );

    const rejectedEntry: AdminContestRejectedItem = {
      rejectedId: 700 + targetAppId,
      memberId: rejectTarget.memberId,
      nickname: rejectTarget.nickname,
      appliedAt: rejectTarget.appliedAt,
      rejectedAt: "2026.11.10 22:25",
      rejectReason: reason,
      processedBy: "총괄관리자",
    };

    setRejectedList(prev => [rejectedEntry, ...prev]);
    setSeason(prev => ({
      ...prev,
      applicantCount: Math.max(0, prev.applicantCount - 1),
      rejectedCount: prev.rejectedCount + 1,
    }));
    setRejectTarget(null);
    setRejectReasonInput("");
    setActiveMemberTab("rejected");
    setOperationBanner(
      `"${rejectTarget.nickname}" 신청자의 참가 신청을 반려 처리했습니다.`,
    );

    const callReject =
      memberCtx?.snapshot.phase === "ready" && memberCtx.session
        ? memberCtx.session.authorized(cred =>
            rejectAdminContestApplicant(season.id, targetAppId, reason, {
              token: cred.accessToken,
            }),
          )
        : rejectAdminContestApplicant(season.id, targetAppId, reason);

    void callReject
      .then(() => reloadDetailFromServer(season.id))
      .catch(() => {
        // Keep optimistic reject entry
      });
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
              onClick={() => setEarlySettleModalOpen(true)}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-rose-200 bg-rose-50 px-4 text-xs font-black text-rose-700 transition-colors hover:bg-rose-100 cursor-pointer"
            >
              <V1IconAlert className="h-4 w-4 shrink-0 text-rose-600" />
              <span>대회 조기 종료 및 강제 정산</span>
            </button>

            <button
              type="button"
              data-admin-action="cleanup-remaining"
              onClick={() => setCleanupModalOpen(true)}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-amber-200 bg-amber-50 px-4 text-xs font-black text-amber-800 transition-colors hover:bg-amber-100 cursor-pointer"
            >
              <V1IconRefresh className="h-4 w-4 shrink-0 text-amber-700" />
              <span>남은 포지션·미체결 주문 재정리</span>
            </button>

            <V1Button
              variant="white"
              size="sm"
              onClick={() => setEditModalOpen(true)}
            >
              대회 정보 수정
            </V1Button>
          </div>
        </header>

        {/* 운영 실행 결과 배너 */}
        {operationBanner ? (
          <div
            role="status"
            data-admin-settlement-result="true"
            className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-xs sm:text-sm font-bold text-emerald-800"
          >
            <div className="flex items-center gap-2">
              <V1IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{operationBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setOperationBanner(null)}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
            >
              닫기
            </button>
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
                  onChange={() => handleToggleStatus("isPublic")}
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
                  onChange={() => handleToggleStatus("isCancel")}
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
                  {settlementRuns.map(run => (
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
                            "rounded px-1.5 py-0.5 text-[10px]",
                            run.status === "COMPLETED"
                              ? "bg-emerald-100 text-emerald-800"
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
                  ))}
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
                disabled={selectedApplicantIds.length === 0}
                onClick={() => approveApplicantsByIds(selectedApplicantIds)}
              >
                선택 일괄 승인 ({selectedApplicantIds.length})
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
                              onClick={() =>
                                approveApplicantsByIds([applicant.applicantId])
                              }
                              className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                            >
                              승인
                            </button>
                            <button
                              type="button"
                              data-admin-reject-applicant={applicant.applicantId}
                              onClick={() => {
                                setRejectTarget(applicant);
                                setRejectReasonInput("");
                              }}
                              className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
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
              <table className="w-full min-w-[920px] text-left text-xs">
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
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
                            {participant.walletStatus}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-gray-500 tabular-nums whitespace-nowrap">
                        {participant.seedMoney}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-gray-900 tabular-nums whitespace-nowrap">
                        {participant.equity}
                      </td>
                      <td className="px-4 py-3.5 text-right font-black text-red-500 tabular-nums whitespace-nowrap">
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
        onClose={() => setEarlySettleModalOpen(false)}
        title="대회 조기 종료 및 강제 정산 확인"
        subtitle={`시즌 #${season.id} · ${season.title}`}
        footer={
          <div className="flex justify-end gap-2">
            <V1Button
              variant="white"
              size="sm"
              onClick={() => setEarlySettleModalOpen(false)}
            >
              취소
            </V1Button>
            <V1Button
              variant="red"
              size="sm"
              data-admin-confirm="early-finish-settle"
              onClick={handleConfirmEarlyFinishSettle}
            >
              조기 종료 및 강제 정산 실행
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
        </div>
      </DimModal>

      {/* 2. 남은 포지션·미체결 주문 재정리 확인 모달 */}
      <DimModal
        open={cleanupModalOpen}
        onClose={() => setCleanupModalOpen(false)}
        title="남은 포지션·미체결 주문 500청크 재정리"
        subtitle={`시즌 #${season.id} · ${season.title}`}
        footer={
          <div className="flex justify-end gap-2">
            <V1Button
              variant="white"
              size="sm"
              onClick={() => setCleanupModalOpen(false)}
            >
              취소
            </V1Button>
            <V1Button
              variant="blue"
              size="sm"
              data-admin-confirm="cleanup-remaining"
              onClick={handleConfirmCleanupRemaining}
            >
              잔여 주문 취소·포지션 강제청산 재실행
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
        </div>
      </DimModal>

      {/* 3. 신청자 반려 사유 입력 모달 */}
      <DimModal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
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
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <V1Button
              variant="white"
              size="sm"
              onClick={() => setRejectTarget(null)}
            >
              취소
            </V1Button>
            <V1Button type="submit" variant="red" size="sm">
              반려 처리 확정
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
          onClose={() => setEditModalOpen(false)}
          onSave={handleSaveSeasonEdit}
        />
      ) : null}
    </AdminShell>
  );
}
