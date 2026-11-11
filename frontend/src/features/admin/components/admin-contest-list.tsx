"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  createAdminContestSeason,
  fetchAdminContestSeasons,
  formatContestDateTime,
  formatContestSeedPlain,
  patchAdminContestSeasonStatus,
  toDatetimeLocalInput,
  toIsoInstantFromInput,
  updateAdminContestSeason,
  type ContestSeasonView,
} from "../../contest/api/contest-client";
import { DimModal } from "../../member/components/dim-modal";
import { useOptionalMember } from "../../member/components/member-provider";
import {
  cn,
  V1Button,
  V1IconCalendar,
  V1IconCheck,
  V1IconTrophy,
  V1IconUsers,
  V1Input,
} from "../../member/components/v1-ui";
import { AdminShell } from "./admin-layout";

export type AdminContestProgressState = "모집중" | "Live" | "대기중" | "정산완료";
export type AdminContestDisplayStatus = "공개중" | "비공개" | "종료" | "취소됨";

export interface AdminContestSeasonRecord {
  id: number;
  title: string;
  description: string;
  seedMoney: string;
  recruitmentStartAt: string;
  recruitmentEndAt: string;
  contestStartAt: string;
  contestEndAt: string;
  isPublic: boolean;
  isCancel: boolean;
  progressState: AdminContestProgressState;
  settledAt: string | null;
  applicantCount: number;
  participantCount: number;
  rejectedCount: number;
  pendingOrderCount: number;
  openPositionCount: number;
}

export const INITIAL_ADMIN_CONTEST_SEASONS: AdminContestSeasonRecord[] = [
  {
    id: 202605,
    title: "2026 정규 시즌 4 알트코인 변동성 챌린지",
    description:
      "비트코인·이더리움·솔라나·리플 무기한 선물을 대상으로 동일 10,000 USDT 시드머니에서 출발해 시즌 누적 수익률을 겨루는 공식 대회입니다.",
    seedMoney: "10,000",
    recruitmentStartAt: "2026-11-01T00:00",
    recruitmentEndAt: "2026-11-25T23:59",
    contestStartAt: "2026-11-26T09:00",
    contestEndAt: "2026-12-15T23:59",
    isPublic: true,
    isCancel: false,
    progressState: "모집중",
    settledAt: null,
    applicantCount: 14,
    participantCount: 112,
    rejectedCount: 3,
    pendingOrderCount: 0,
    openPositionCount: 0,
  },
  {
    id: 202602,
    title: "2026 정규 시즌 2 선물 수익률 대회",
    description:
      "현재 진행 중인 정규 시즌 2 대회로, 종료 시각 도래 시 미체결 주문 500개 청크 소프트 취소 및 오픈 포지션 500개 청크 강제청산 스케줄러가 동작합니다.",
    seedMoney: "10,000",
    recruitmentStartAt: "2026-10-20T00:00",
    recruitmentEndAt: "2026-10-31T23:59",
    contestStartAt: "2026-11-01T09:00",
    contestEndAt: "2026-11-30T23:59",
    isPublic: true,
    isCancel: false,
    progressState: "Live",
    settledAt: null,
    applicantCount: 4,
    participantCount: 186,
    rejectedCount: 2,
    pendingOrderCount: 128,
    openPositionCount: 342,
  },
  {
    id: 202603,
    title: "2026 연말 메이저 코인 단기 스프린트",
    description:
      "비트코인과 이더리움 무기한 선물 중심의 단기 집중 수익률 스프린트 시즌입니다.",
    seedMoney: "10,000",
    recruitmentStartAt: "2026-10-25T00:00",
    recruitmentEndAt: "2026-11-04T23:59",
    contestStartAt: "2026-11-05T09:00",
    contestEndAt: "2026-11-20T23:59",
    isPublic: true,
    isCancel: false,
    progressState: "Live",
    settledAt: null,
    applicantCount: 2,
    participantCount: 94,
    rejectedCount: 1,
    pendingOrderCount: 54,
    openPositionCount: 119,
  },
  {
    id: 202604,
    title: "2026 윈터 파이널 챔피언십 시즌 3",
    description:
      "12월 오프닝 예정인 연말 결산 선물 모의투자 챔피언십 시즌입니다.",
    seedMoney: "10,000",
    recruitmentStartAt: "2026-11-15T00:00",
    recruitmentEndAt: "2026-11-30T23:59",
    contestStartAt: "2026-12-01T09:00",
    contestEndAt: "2026-12-31T23:59",
    isPublic: false,
    isCancel: false,
    progressState: "대기중",
    settledAt: null,
    applicantCount: 0,
    participantCount: 68,
    rejectedCount: 0,
    pendingOrderCount: 0,
    openPositionCount: 0,
  },
  {
    id: 202601,
    title: "2026 정규 시즌 1 선물 수익률 대회",
    description:
      "종료 및 정산이 완료된 정규 시즌 1 대회입니다. 최종 올림픽 순위와 참가자별 실현손익이 영구 박제되었습니다.",
    seedMoney: "10,000",
    recruitmentStartAt: "2026-09-20T00:00",
    recruitmentEndAt: "2026-09-30T23:59",
    contestStartAt: "2026-10-01T09:00",
    contestEndAt: "2026-10-31T23:59",
    isPublic: true,
    isCancel: false,
    progressState: "정산완료",
    settledAt: "2026.10.31 23:59",
    applicantCount: 0,
    participantCount: 240,
    rejectedCount: 5,
    pendingOrderCount: 0,
    openPositionCount: 0,
  },
  {
    id: 202511,
    title: "2026 파일럿 테스트 시즌",
    description:
      "초기 정산 파이프라인 점검을 위해 생성 후 운영 취소 처리된 테스트 시즌입니다.",
    seedMoney: "10,000",
    recruitmentStartAt: "2026-08-01T00:00",
    recruitmentEndAt: "2026-08-10T23:59",
    contestStartAt: "2026-08-11T09:00",
    contestEndAt: "2026-08-20T23:59",
    isPublic: false,
    isCancel: true,
    progressState: "대기중",
    settledAt: null,
    applicantCount: 0,
    participantCount: 12,
    rejectedCount: 0,
    pendingOrderCount: 0,
    openPositionCount: 0,
  },
];

export function resolveDisplayStatus(season: AdminContestSeasonRecord): AdminContestDisplayStatus {
  if (season.isCancel) return "취소됨";
  if (season.settledAt || season.progressState === "정산완료") return "종료";
  if (!season.isPublic) return "비공개";
  return "공개중";
}

export function formatReadableDateTime(isoLike: string): string {
  return isoLike.replace("T", " ").replace(/-/g, ".");
}

export function AdminToggleSwitch({
  checked,
  onChange,
  tone = "blue",
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  tone?: "blue" | "rose";
  label: string;
  disabled?: boolean;
}) {
  const activeBg = tone === "rose" ? "bg-rose-600" : "bg-[#0058FF]";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50",
        checked ? activeBg : "bg-gray-300",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export interface ContestFormDraft {
  title: string;
  description: string;
  seedMoney: string;
  recruitmentStartAt: string;
  recruitmentEndAt: string;
  contestStartAt: string;
  contestEndAt: string;
  isPublic: boolean;
}

export function ContestCreateEditModal({
  open,
  mode,
  initialSeason,
  onClose,
  onSave,
}: {
  open: boolean;
  mode: "create" | "edit";
  initialSeason?: AdminContestSeasonRecord | null;
  onClose: () => void;
  onSave: (draft: ContestFormDraft) => void;
}) {
  const [title, setTitle] = useState(initialSeason?.title ?? "");
  const [description, setDescription] = useState(initialSeason?.description ?? "");
  const [seedMoney, setSeedMoney] = useState(initialSeason?.seedMoney ?? "10,000");
  const [recruitmentStartAt, setRecruitmentStartAt] = useState(
    initialSeason?.recruitmentStartAt ?? "2026-12-01T00:00",
  );
  const [recruitmentEndAt, setRecruitmentEndAt] = useState(
    initialSeason?.recruitmentEndAt ?? "2026-12-10T23:59",
  );
  const [contestStartAt, setContestStartAt] = useState(
    initialSeason?.contestStartAt ?? "2026-12-11T09:00",
  );
  const [contestEndAt, setContestEndAt] = useState(
    initialSeason?.contestEndAt ?? "2026-12-31T23:59",
  );
  const [isPublic, setIsPublic] = useState(initialSeason?.isPublic ?? true);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedDesc = description.trim();
    if (!trimmedTitle) {
      setValidationError("대회 제목을 입력해 주세요.");
      return;
    }
    if (!trimmedDesc) {
      setValidationError("대회 상세 설명을 입력해 주세요.");
      return;
    }
    const rStart = Date.parse(recruitmentStartAt);
    const rEnd = Date.parse(recruitmentEndAt);
    const cStart = Date.parse(contestStartAt);
    const cEnd = Date.parse(contestEndAt);

    if (Number.isFinite(rStart) && Number.isFinite(rEnd) && rEnd <= rStart) {
      setValidationError("참가 신청 마감 일시는 신청 시작 일시보다 뒤여야 합니다.");
      return;
    }
    if (Number.isFinite(cStart) && Number.isFinite(cEnd) && cEnd <= cStart) {
      setValidationError("대회 진행 종료 일시는 대회 시작 일시보다 뒤여야 합니다.");
      return;
    }
    if (Number.isFinite(rStart) && Number.isFinite(cStart) && cStart < rStart) {
      setValidationError("대회 진행 시작 일시는 참가 신청 시작 일시 이후여야 합니다.");
      return;
    }

    setValidationError(null);
    onSave({
      title: trimmedTitle,
      description: trimmedDesc,
      seedMoney: seedMoney.trim() || "10,000",
      recruitmentStartAt,
      recruitmentEndAt,
      contestStartAt,
      contestEndAt,
      isPublic,
    });
  }

  return (
    <DimModal
      open={open}
      onClose={onClose}
      title={mode === "create" ? "새 대회 시즌 생성" : "대회 시즌 정보 수정"}
      subtitle="시즌별 독립 대회 지갑 시드머니와 모집·진행 일정을 설정합니다."
      maxWidth="640px"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs sm:text-sm">
        {validationError ? (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700"
          >
            {validationError}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <label htmlFor="contest-title-input" className="block text-xs font-black text-gray-800">
            대회 제목
          </label>
          <V1Input
            id="contest-title-input"
            value={title}
            onChange={event => setTitle(event.currentTarget.value)}
            placeholder="예: 2026 정규 시즌 5 선물 수익률 대회"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="contest-desc-input" className="block text-xs font-black text-gray-800">
            대회 상세 설명
          </label>
          <textarea
            id="contest-desc-input"
            rows={3}
            value={description}
            onChange={event => setDescription(event.currentTarget.value)}
            placeholder="참가 조건, 대상 종목, 정산 기준 및 포상 안내를 입력해 주세요."
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="contest-seed-input" className="block text-xs font-black text-gray-800">
              시즌 초기 시드머니 (USDT)
            </label>
            <V1Input
              id="contest-seed-input"
              value={seedMoney}
              onChange={event => setSeedMoney(event.currentTarget.value)}
              placeholder="10,000"
            />
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-[#F9FAFB] px-4 py-3">
            <span className="text-xs font-black text-gray-800">즉시 공개 여부</span>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-500">
                {isPublic ? "대회 허브에 즉시 공개" : "비공개 초안으로 저장"}
              </span>
              <AdminToggleSwitch
                checked={isPublic}
                onChange={() => setIsPublic(prev => !prev)}
                label="즉시 공개 여부"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="recruitment-start-input"
              className="block text-xs font-black text-gray-800"
            >
              참가 신청 시작 일시
            </label>
            <V1Input
              id="recruitment-start-input"
              type="datetime-local"
              value={recruitmentStartAt}
              onChange={event => setRecruitmentStartAt(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="recruitment-end-input"
              className="block text-xs font-black text-gray-800"
            >
              참가 신청 마감 일시
            </label>
            <V1Input
              id="recruitment-end-input"
              type="datetime-local"
              value={recruitmentEndAt}
              onChange={event => setRecruitmentEndAt(event.currentTarget.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="contest-start-input"
              className="block text-xs font-black text-gray-800"
            >
              대회 진행 시작 일시
            </label>
            <V1Input
              id="contest-start-input"
              type="datetime-local"
              value={contestStartAt}
              onChange={event => setContestStartAt(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="contest-end-input"
              className="block text-xs font-black text-gray-800"
            >
              대회 진행 종료 일시
            </label>
            <V1Input
              id="contest-end-input"
              type="datetime-local"
              value={contestEndAt}
              onChange={event => setContestEndAt(event.currentTarget.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
          <V1Button variant="white" size="sm" onClick={onClose}>
            취소
          </V1Button>
          <V1Button type="submit" variant="blue" size="sm">
            {mode === "create" ? "시즌 생성 완료" : "변경사항 저장"}
          </V1Button>
        </div>
      </form>
    </DimModal>
  );
}

export function mapSeasonViewToAdminRecord(view: ContestSeasonView): AdminContestSeasonRecord {
  const progressState: AdminContestProgressState =
    view.displayStatus === "LIVE"
      ? "Live"
      : view.displayStatus === "RECRUITING"
        ? "모집중"
        : view.displayStatus === "FINISHED" || Boolean(view.settledAt)
          ? "정산완료"
          : "대기중";
  return {
    id: view.id,
    title: view.title,
    description: view.description,
    seedMoney: formatContestSeedPlain(view.seedMoney),
    recruitmentStartAt: toDatetimeLocalInput(view.recruitmentStartAt),
    recruitmentEndAt: toDatetimeLocalInput(view.recruitmentEndAt),
    contestStartAt: toDatetimeLocalInput(view.contestStartAt),
    contestEndAt: toDatetimeLocalInput(view.contestEndAt),
    isPublic: view.isPublic,
    isCancel: view.isCanceled,
    progressState,
    settledAt: view.settledAt ? formatContestDateTime(view.settledAt) : null,
    applicantCount: view.applicantCount,
    participantCount: view.participantCount,
    rejectedCount: 0,
    pendingOrderCount: view.pendingOrderCount,
    openPositionCount: view.openPositionCount,
  };
}

export function AdminContestList() {
  const memberCtx = useOptionalMember();
  const [seasons, setSeasons] = useState<AdminContestSeasonRecord[]>(
    INITIAL_ADMIN_CONTEST_SEASONS,
  );
  const [visibleCount, setVisibleCount] = useState(5);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingSeason, setEditingSeason] = useState<AdminContestSeasonRecord | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (
      memberCtx?.snapshot.phase !== "ready" ||
      memberCtx.snapshot.role !== "ADMIN" ||
      !memberCtx.session
    ) {
      return;
    }
    const controller = new AbortController();
    void memberCtx.session
      .authorized(cred =>
        fetchAdminContestSeasons({
          token: cred.accessToken,
          size: 50,
          signal: controller.signal,
        }),
      )
      .then(res => {
        if (res && Array.isArray(res.items)) {
          setSeasons(res.items.map(mapSeasonViewToAdminRecord));
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSeasons([]);
        setStatusMessage("대회 시즌 목록을 불러오지 못했습니다. 서버 연결 상태를 확인해 주세요.");
      });

    return () => controller.abort();
  }, [memberCtx?.session, memberCtx?.snapshot.phase, memberCtx?.snapshot.role]);

  const recruitingCount = seasons.filter(
    s => s.progressState === "모집중" && s.isPublic && !s.isCancel,
  ).length;
  const liveCount = seasons.filter(
    s => s.progressState === "Live" && s.isPublic && !s.isCancel,
  ).length;

  async function handleToggleField(id: number, field: "isPublic" | "isCancel") {
    const target = seasons.find(item => item.id === id);
    if (!target || !memberCtx?.session) return;
    const nextValue = !target[field];
    const patchBody = field === "isPublic" ? { isPublic: nextValue } : { isCanceled: nextValue };

    try {
      const updatedView = await memberCtx.session.authorized(cred =>
        patchAdminContestSeasonStatus(id, patchBody, { token: cred.accessToken }),
      );
      if (updatedView) {
        const mapped = mapSeasonViewToAdminRecord(updatedView);
        setSeasons(prev => prev.map(item => (item.id === id ? mapped : item)));
        const label =
          field === "isPublic"
            ? mapped.isPublic
              ? "공개중"
              : "비공개"
            : mapped.isCancel
              ? "취소됨"
              : "정상 운영";
        setStatusMessage(`시즌 #${id} "${mapped.title}" 상태가 [${label}](으)로 변경되었습니다.`);
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error && error.message
          ? error.message
          : `시즌 #${id} 상태 변경에 실패했습니다.`,
      );
    }
  }

  async function handleCreateSeason(draft: ContestFormDraft) {
    if (!memberCtx?.session) return;
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
      const serverView = await memberCtx.session.authorized(cred =>
        createAdminContestSeason(payload, { token: cred.accessToken }),
      );
      if (serverView) {
        const mapped = mapSeasonViewToAdminRecord(serverView);
        setSeasons(prev => [mapped, ...prev]);
        setCreateModalOpen(false);
        setStatusMessage(`새 대회 시즌 #${mapped.id} "${mapped.title}"이(가) 생성되었습니다.`);
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error && error.message
          ? error.message
          : "새 대회 시즌 생성에 실패했습니다. 일정 순서 및 입력값을 확인해 주세요.",
      );
    }
  }

  async function handleUpdateSeason(draft: ContestFormDraft) {
    if (!editingSeason || !memberCtx?.session) return;
    const targetId = editingSeason.id;
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
      const serverView = await memberCtx.session.authorized(cred =>
        updateAdminContestSeason(targetId, payload, { token: cred.accessToken }),
      );
      if (serverView) {
        const mapped = mapSeasonViewToAdminRecord(serverView);
        setSeasons(prev => prev.map(item => (item.id === targetId ? mapped : item)));
        setEditingSeason(null);
        setStatusMessage(`시즌 #${targetId} "${mapped.title}" 정보가 수정되었습니다.`);
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error && error.message
          ? error.message
          : `시즌 #${targetId} 정보 수정에 실패했습니다.`,
      );
    }
  }

  const visibleSeasons = seasons.slice(0, visibleCount);

  return (
    <AdminShell activeSection="contest">
      <div className="space-y-8">
        {/* 상단 타이틀 + 새 대회 시즌 생성 버튼 */}
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#0058FF]">
              ADMIN CONTEST MANAGEMENT
            </span>
            <h1 className="mt-2 text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
              대회 시즌 관리
            </h1>
            <p className="mt-1 text-sm font-medium text-gray-500">
              시즌별 선물 모의투자 대회 생성, 모집·진행 일정, 공개/취소 상태 및 500개 청크 정산을 통합 운영합니다.
            </p>
          </div>

          <V1Button
            variant="blue"
            size="sm"
            data-admin-action="open-create-season"
            onClick={() => setCreateModalOpen(true)}
          >
            <span>+ 새 대회 시즌 생성</span>
          </V1Button>
        </div>

        {/* 상태 변경 피드백 배너 */}
        {statusMessage ? (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-3.5 text-xs sm:text-sm font-bold text-[#0058FF]"
          >
            <div className="flex items-center gap-2">
              <V1IconCheck className="h-4 w-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-bold text-gray-500 hover:bg-blue-100"
            >
              닫기
            </button>
          </div>
        ) : null}

        {/* 상단 3열 요약 통계 카드 */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-6">
            <div>
              <p className="text-xs font-bold text-gray-400">전체 대회 시즌</p>
              <p className="mt-1.5 text-3xl font-black text-gray-900 tabular-nums">
                {seasons.length}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[#0058FF]">
              <V1IconTrophy className="h-6 w-6" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-6">
            <div>
              <p className="text-xs font-bold text-gray-400">참가 모집중 시즌</p>
              <p className="mt-1.5 text-3xl font-black text-emerald-600 tabular-nums">
                {recruitingCount}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <V1IconUsers className="h-6 w-6" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-6">
            <div>
              <p className="text-xs font-bold text-gray-400">진행중(LIVE) 시즌</p>
              <p className="mt-1.5 text-3xl font-black text-[#0058FF] tabular-nums">
                {liveCount}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <V1IconCalendar className="h-6 w-6" />
            </div>
          </div>
        </section>

        {/* 대회 시즌 목록 테이블 */}
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-black text-gray-900">대회 시즌 목록</h2>
            <span className="text-xs font-bold text-gray-400">
              총 {seasons.length}개 시즌
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1220px] text-left text-xs">
              <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                <tr>
                  <th className="w-[64px] px-3 py-3.5 font-bold whitespace-nowrap">시즌 ID</th>
                  <th className="w-[220px] max-w-[220px] px-3 py-3.5 font-bold whitespace-nowrap">대회명</th>
                  <th className="px-2.5 py-3.5 font-bold text-center whitespace-nowrap">진행 상태</th>
                  <th className="px-2.5 py-3.5 font-bold text-center whitespace-nowrap">운영상태</th>
                  <th className="px-2.5 py-3.5 font-bold text-center whitespace-nowrap">공개여부</th>
                  <th className="px-2.5 py-3.5 font-bold text-center whitespace-nowrap">취소여부</th>
                  <th className="px-3 py-3.5 font-bold text-right whitespace-nowrap">초기 시드머니</th>
                  <th className="px-2.5 py-3.5 font-bold text-center whitespace-nowrap">신청 기간</th>
                  <th className="px-2.5 py-3.5 font-bold text-center whitespace-nowrap">대회 기간</th>
                  <th className="px-2.5 py-3.5 font-bold text-center whitespace-nowrap">정산 상태</th>
                  <th className="px-3 py-3.5 font-bold text-center whitespace-nowrap">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {visibleSeasons.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center font-bold text-gray-400">
                      등록된 대회 시즌이 없습니다.
                    </td>
                  </tr>
                ) : null}
                {visibleSeasons.map(row => {
                  const displayStatus = resolveDisplayStatus(row);
                  const progressBadgeClass =
                    row.progressState === "모집중"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : row.progressState === "Live"
                        ? "bg-blue-50 text-[#0058FF] border border-blue-200"
                        : row.progressState === "정산완료"
                          ? "bg-gray-100 text-gray-600 border border-gray-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200";

                  const statusBadgeClass =
                    displayStatus === "공개중"
                      ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                      : displayStatus === "비공개"
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : displayStatus === "취소됨"
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : "bg-gray-100 text-gray-600 border border-gray-200";

                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="w-[64px] px-3 py-3.5 font-black text-gray-500 tabular-nums whitespace-nowrap">
                        #{row.id}
                      </td>
                      <td className="w-[220px] max-w-[220px] px-3 py-3.5">
                        <Link
                          href={`/admin/contest/${row.id}`}
                          className="block truncate text-sm font-black text-gray-900 hover:text-[#0058FF]"
                        >
                          {row.title}
                        </Link>
                        <p className="mt-0.5 block truncate text-[11px] font-medium text-gray-400">
                          {row.description}
                        </p>
                      </td>
                      <td className="px-2.5 py-3.5 text-center whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                            progressBadgeClass,
                          )}
                        >
                          {row.progressState === "Live" ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                          ) : null}
                          <span>{row.progressState}</span>
                        </span>
                      </td>
                      <td className="px-2.5 py-3.5 text-center whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                            statusBadgeClass,
                          )}
                        >
                          {displayStatus}
                        </span>
                      </td>
                      <td className="px-2.5 py-3.5 text-center whitespace-nowrap">
                        <AdminToggleSwitch
                          checked={row.isPublic}
                          onChange={() => handleToggleField(row.id, "isPublic")}
                          label={`${row.title} 공개여부 토글`}
                        />
                      </td>
                      <td className="px-2.5 py-3.5 text-center whitespace-nowrap">
                        <AdminToggleSwitch
                          checked={row.isCancel}
                          tone="rose"
                          onChange={() => handleToggleField(row.id, "isCancel")}
                          label={`${row.title} 취소여부 토글`}
                        />
                      </td>
                      <td className="px-3 py-3.5 text-right font-black text-gray-900 tabular-nums whitespace-nowrap">
                        {row.seedMoney} USDT
                      </td>
                      <td className="px-2.5 py-3.5 text-center text-[11px] font-bold text-gray-600 tabular-nums whitespace-nowrap">
                        <div className="whitespace-nowrap">{formatReadableDateTime(row.recruitmentStartAt)}</div>
                        <div className="whitespace-nowrap text-gray-400">
                          ~ {formatReadableDateTime(row.recruitmentEndAt)}
                        </div>
                      </td>
                      <td className="px-2.5 py-3.5 text-center text-[11px] font-bold text-gray-600 tabular-nums whitespace-nowrap">
                        <div className="whitespace-nowrap">{formatReadableDateTime(row.contestStartAt)}</div>
                        <div className="whitespace-nowrap text-gray-400">
                          ~ {formatReadableDateTime(row.contestEndAt)}
                        </div>
                      </td>
                      <td className="px-2.5 py-3.5 text-center whitespace-nowrap">
                        {row.settledAt ? (
                          <span className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                            정산 완료
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                            미정산
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            data-admin-edit-season={row.id}
                            onClick={() => setEditingSeason(row)}
                            className="inline-flex h-8 shrink-0 whitespace-nowrap items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer"
                          >
                            수정
                          </button>
                          <Link
                            href={`/admin/contest/${row.id}`}
                            data-admin-detail-link={row.id}
                            className="inline-flex h-8 shrink-0 whitespace-nowrap items-center justify-center rounded-lg bg-[#0058FF] px-3 text-xs font-bold text-white hover:bg-blue-700"
                          >
                            상세 운영
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {visibleCount < seasons.length ? (
            <div className="flex justify-center border-t border-gray-100 py-4">
              <V1Button
                variant="white"
                size="sm"
                onClick={() => setVisibleCount(prev => prev + 5)}
              >
                대회 시즌 더보기 ({visibleCount}/{seasons.length})
              </V1Button>
            </div>
          ) : null}
        </section>
      </div>

      {/* 생성 모달 */}
      {createModalOpen ? (
        <ContestCreateEditModal
          open={createModalOpen}
          mode="create"
          onClose={() => setCreateModalOpen(false)}
          onSave={handleCreateSeason}
        />
      ) : null}

      {/* 수정 모달 */}
      {editingSeason ? (
        <ContestCreateEditModal
          open={Boolean(editingSeason)}
          mode="edit"
          initialSeason={editingSeason}
          onClose={() => setEditingSeason(null)}
          onSave={handleUpdateSeason}
        />
      ) : null}
    </AdminShell>
  );
}
