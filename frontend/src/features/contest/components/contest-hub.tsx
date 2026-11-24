"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { contentJson, ContentApiError } from "../../member/api/client";
import { parseProfile } from "../../member/api/contracts";
import { DimModal } from "../../member/components/dim-modal";
import { RequestIdChip } from "../../../components/request-id-copy";
import { getErrorRequestId, isUnexpectedApiError } from "../../../lib/request-id";
import { useOptionalMember } from "../../member/components/member-provider";
import { MemberShell } from "../../member/components/member-views";
import {
  applyForContestSeason,
  cancelContestSeasonApplication,
  fetchMyContestOverview,
  fetchPublicContestLeaderboard,
  fetchPublicContestSeasons,
  formatContestDateOnly,
  formatContestDateTime,
  formatContestSeedPlain,
  formatContestSignedRoi,
  formatContestSignedUsdt,
  formatContestUsdt,
  formatContestWinRate,
  isNonNegativeContestDecimal,
  selectDefaultContestSidebarSeasonId,
  type ContestSeasonView,
  type LeaderboardPageResponse,
  type MyContestOverviewResponse,
} from "../api/contest-client";
import {
  cn,
  V1Button,
  V1IconAlert,
  V1IconArrowRight,
  V1IconCalendar,
  V1IconCheck,
  V1IconChevronDown,
  V1IconChevronLeft,
  V1IconChevronRight,
  V1IconClock,
  V1IconInfo,
  V1IconMedal,
  V1IconTrophy,
  V1IconUsers,
  V1Tabs,
  V1UserAvatar,
} from "../../member/components/v1-ui";

export type ContestCardType = "apply" | "wait" | "reject" | "past" | "live";

export interface ContestSeasonItem {
  id: number;
  title: string;
  description: string;
  seedMoney: string;
  recruitmentStartAt: string;
  recruitmentEndAt: string;
  contestStartAt: string;
  contestEndAt: string;
  participantCount: number;
  cardType: ContestCardType;
  accentLabel: string;
  actionLabel: string;
  isLive?: boolean;
  rejectReason?: string;
  finalRank?: number;
  finalRoi?: string;
  finalPnl?: string;
  rewardSummary?: string;
}

export interface OngoingMyContestItem {
  id: number;
  title: string;
  period: string;
  contestStartAt: string;
  contestEndAt: string;
  seedMoney: string;
  currentEquity: string;
  myRoi: string;
  myPnl: string;
  myRank: number | null;
  participantCount: number;
  isLive: boolean;
  statusLabel: string;
  dotColor: string;
}

export interface ContestLeaderboardEntry {
  rank: number;
  memberId: number;
  nickname: string;
  profileImgUrl?: string | null;
  withdrawn?: boolean;
  seedMoney: string;
  equity: string;
  realizedPnl: string;
  roi: string;
  isPositive: boolean;
  tradeCount: number;
  winRate: string;
}

export interface ContestLeaderboardSeason {
  seasonId: number;
  seasonTitle: string;
  statusLabel: "실시간 랭킹" | "최종 확정 순위";
  period: string;
  settledAt?: string;
  participantCount: number;
  entries: ContestLeaderboardEntry[];
  nextCursorId?: number | null;
  hasNext?: boolean;
}

type EnrichedMemberMeta = {
  nickname: string;
  profileImgUrl: string | null;
  withdrawn: boolean;
};

export function ContestListCard({
  contest,
  onApply,
  onCancel,
  onViewLeaderboard,
  canEnterTrading = false,
  isLoggedIn = true,
  busy = false,
  defaultExpanded = false,
}: {
  contest: ContestSeasonItem;
  onApply?: (contest: ContestSeasonItem) => void;
  onCancel?: (contest: ContestSeasonItem) => void;
  onViewLeaderboard?: (seasonId: number) => void;
  canEnterTrading?: boolean;
  isLoggedIn?: boolean;
  busy?: boolean;
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const badgeTone =
    contest.cardType === "apply"
      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
      : contest.cardType === "live"
        ? "bg-blue-50 text-[#0058FF] border border-blue-200"
        : contest.cardType === "wait"
          ? "bg-amber-50 text-amber-700 border border-amber-200"
          : contest.cardType === "reject"
            ? "bg-rose-50 text-rose-700 border border-rose-200"
            : "bg-gray-100 text-gray-600 border border-gray-200";

  return (
    <article
      data-contest-card={contest.id}
      data-contest-card-type={contest.cardType}
      className={cn(
        "flex flex-col rounded-2xl border bg-white transition-colors overflow-hidden",
        isExpanded ? "border-gray-300" : "border-gray-200 hover:border-gray-300",
      )}
    >
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "inline-flex shrink-0 whitespace-nowrap items-center rounded-full px-2.5 py-1 text-[11px] font-bold leading-none",
              badgeTone,
            )}
          >
            {contest.accentLabel}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {contest.cardType === "apply" ? (
              !isLoggedIn ? (
                <Link
                  href="/login"
                  data-contest-action="apply-login-required"
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  <span>로그인 후 신청 가능</span>
                </Link>
              ) : onApply ? (
                <button
                  type="button"
                  data-contest-action="apply"
                  disabled={busy}
                  onClick={() => onApply(contest)}
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl bg-emerald-600 px-3.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                >
                  <span>{busy ? "신청 중…" : contest.actionLabel || "신청"}</span>
                  <V1IconArrowRight className="h-3.5 w-3.5 shrink-0" />
                </button>
              ) : null
            ) : contest.cardType === "live" ? (
              canEnterTrading ? (
                <Link
                  href={`/contest/${contest.id}/trading`}
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl bg-[#0058FF] px-3.5 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                >
                  <span>대회 참여하기</span>
                  <V1IconArrowRight className="h-3.5 w-3.5 shrink-0" />
                </Link>
              ) : !isLoggedIn ? (
                <Link
                  href="/login"
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0058FF] transition-colors hover:bg-blue-100"
                >
                  <span>로그인 후 확인</span>
                </Link>
              ) : onViewLeaderboard ? (
                <button
                  type="button"
                  onClick={() => onViewLeaderboard(contest.id)}
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0058FF] transition-colors hover:bg-blue-100 cursor-pointer"
                >
                  <span>실시간 랭킹 보기</span>
                </button>
              ) : (
                <span className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0058FF]">
                  진행중 · 참가 마감
                </span>
              )
            ) : contest.cardType === "wait" ? (
              <div className="inline-flex items-center gap-1.5">
                <span className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-700">
                  {contest.actionLabel}
                </span>
                {onCancel ? (
                  <button
                    type="button"
                    data-contest-action="cancel-application"
                    disabled={busy}
                    onClick={() => onCancel(contest)}
                    className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-gray-300 bg-white px-2.5 text-xs font-bold text-gray-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 cursor-pointer disabled:opacity-50"
                  >
                    {busy ? "취소 중…" : "신청 취소"}
                  </button>
                ) : null}
              </div>
            ) : (
              <span
                className={cn(
                  "inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-xl px-3 text-xs font-bold",
                  contest.cardType === "reject"
                    ? "border border-rose-200 bg-rose-50 text-rose-700"
                    : "border border-gray-200 bg-gray-50 text-gray-600",
                )}
              >
                {contest.actionLabel}
              </span>
            )}
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-label={`${contest.title} 상세 ${isExpanded ? "접기" : "펼치기"}`}
              onClick={() => setIsExpanded(prev => !prev)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 cursor-pointer"
            >
              <V1IconChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform",
                  isExpanded && "rotate-180",
                )}
              />
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(prev => !prev)}
          className="min-w-0 space-y-1 text-left cursor-pointer"
        >
          <h3
            className={cn(
              "text-sm font-black tracking-tight text-gray-900 leading-snug break-keep",
              contest.cardType === "reject" && "line-through text-gray-400",
            )}
          >
            {contest.title}
          </h3>
          <p className="whitespace-nowrap text-[11px] font-bold text-gray-400 tabular-nums">
            {contest.contestStartAt} ~ {contest.contestEndAt}
          </p>
        </button>
      </div>

      {isExpanded ? (
        <div className="border-t border-gray-100 bg-[#F9FAFB] p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] font-bold text-gray-400">대회 일정</p>
              <p className="mt-0.5 font-bold text-gray-800 tabular-nums">
                {contest.contestStartAt} ~ {contest.contestEndAt}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-gray-400">신청 마감일</p>
              <p className="mt-0.5 font-bold text-gray-800 tabular-nums">
                {contest.recruitmentEndAt}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-gray-400">초기 시드머니</p>
              <p className="mt-0.5 font-black text-[#0058FF] tabular-nums">
                {contest.seedMoney}
              </p>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-gray-400">대회 상세 설명</p>
            <p className="mt-1 leading-relaxed font-medium text-gray-700">
              {contest.description}
            </p>
          </div>

          {contest.cardType === "past" && contest.finalRank !== undefined ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <V1IconTrophy className="h-4 w-4 text-[#0058FF]" />
                <span className="font-black text-gray-900">
                  내 최종 정산 결과: {contest.finalRank}위
                </span>
              </div>
              <div className="flex items-center gap-3 font-bold tabular-nums">
                <span className="text-gray-700">최종 손익 {contest.finalPnl}</span>
                <span className="rounded-full bg-[#0058FF] px-2.5 py-0.5 text-[11px] font-black text-white">
                  최종 수익률 {contest.finalRoi}
                </span>
              </div>
            </div>
          ) : null}

          {contest.cardType === "reject" && contest.rejectReason ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 space-y-1">
              <p className="text-[11px] font-black text-rose-700">반려 사유</p>
              <p className="font-bold text-rose-900 leading-relaxed">{contest.rejectReason}</p>
            </div>
          ) : null}

          {contest.rewardSummary ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-0.5">
              <p className="text-[11px] font-black text-emerald-700">시즌 혜택 및 포상</p>
              <p className="font-bold text-emerald-900">{contest.rewardSummary}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ContestOngoingSection({
  contests,
  onBlockedEnter,
}: {
  contests: OngoingMyContestItem[];
  onBlockedEnter: (message: string) => void;
}) {
  const [startIndex, setStartIndex] = useState(0);
  const safeStartIndex = Math.min(startIndex, Math.max(0, contests.length - 3));

  const handlePrev = () => setStartIndex(Math.max(0, safeStartIndex - 1));
  const handleNext = () =>
    setStartIndex(Math.min(Math.max(0, contests.length - 3), safeStartIndex + 1));

  return (
    <section data-contest-section="ongoing" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-[#0058FF]" />
          <h2 className="m-0! text-base font-black leading-tight text-gray-900">내 진행 중인 대회</h2>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-[#0058FF]">
            {contests.length}시즌
          </span>
        </div>

        {contests.length > 3 ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrev}
              disabled={safeStartIndex === 0}
              aria-label="이전 시즌 보기"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <V1IconChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={safeStartIndex >= contests.length - 3}
              aria-label="다음 시즌 보기"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <V1IconChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      {contests.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
          <p className="text-sm font-bold text-gray-400">
            현재 참가 승인된 진행 중 대회가 없습니다. 아래 모집 중인 대회에 참가 신청해 보세요.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contests.slice(safeStartIndex, safeStartIndex + 3).map(contest => (
            <article
              key={contest.id}
              data-ongoing-contest-card={contest.id}
              className="flex flex-col justify-between gap-5 rounded-2xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                      contest.isLive
                        ? "border border-blue-200 bg-blue-50 text-[#0058FF]"
                        : "border border-amber-200 bg-amber-50 text-amber-700",
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: contest.dotColor }}
                    />
                    {contest.statusLabel}
                  </span>
                  <span className="text-[11px] font-bold text-gray-400 tabular-nums">
                    시드 {contest.seedMoney}
                  </span>
                </div>

                <div>
                  <h3 className="text-base font-black text-gray-900 tracking-tight">
                    {contest.title}
                  </h3>
                  <p className="mt-1 text-xs font-bold text-gray-400 tabular-nums">
                    {contest.period}
                  </p>
                </div>

                <dl className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
                  <div>
                    <dt className="text-[11px] font-bold text-gray-400">내 평가자산</dt>
                    <dd className="mt-0.5 text-xs font-black text-gray-900 tabular-nums">
                      {contest.currentEquity}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold text-gray-400">현재 수익률</dt>
                    <dd
                      className={cn(
                        "mt-0.5 text-xs font-black tabular-nums",
                        contest.myRoi.startsWith("+")
                          ? "text-[#0ECB81]"
                          : contest.myRoi.startsWith("-")
                            ? "text-[#F6465D]"
                            : "text-gray-700",
                      )}
                    >
                      {contest.myRoi}
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-[11px] font-bold text-gray-400">현재 순위</dt>
                    <dd className="mt-0.5 text-xs font-black text-gray-900 tabular-nums">
                      {contest.isLive
                        ? contest.myRank !== null
                          ? `${contest.myRank}위 / ${contest.participantCount}명`
                          : "집계 중"
                        : "집계 전"}
                    </dd>
                  </div>
                </dl>
              </div>

              {contest.isLive ? (
                <Link
                  href={`/contest/${contest.id}/trading`}
                  data-contest-enter={contest.id}
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-[#0058FF] px-4 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                >
                  <span>대회 참여하기</span>
                  <V1IconArrowRight className="h-3.5 w-3.5 shrink-0" />
                </Link>
              ) : (
                <button
                  type="button"
                  data-contest-enter={contest.id}
                  onClick={() =>
                    onBlockedEnter(
                      `"${contest.title}" 시즌은 아직 대회 시작 전입니다. 대회 진행 기간(${contest.contestStartAt} 이후)에 입장할 수 있습니다.`,
                    )
                  }
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-gray-200 bg-gray-100 px-4 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-200 cursor-pointer"
                >
                  <span>대회 참여하기</span>
                  <V1IconArrowRight className="h-3.5 w-3.5 shrink-0" />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const ONGOING_DOT_PALETTE = ["#0058FF", "#0ECB81", "#F59E0B", "#0EA5E9", "#F6465D"];

function mapSeasonViewToItem(
  view: ContestSeasonView,
  cardType: ContestCardType,
  extra?: Partial<ContestSeasonItem>,
): ContestSeasonItem {
  const accentLabel =
    cardType === "apply"
      ? "모집중"
      : cardType === "live"
        ? "진행중"
        : cardType === "wait"
          ? "심사중"
          : cardType === "reject"
            ? "반려"
            : "종료";
  const actionLabel =
    cardType === "apply"
      ? "신청"
      : cardType === "live"
        ? "진행중인 대회"
        : cardType === "wait"
          ? "승인 대기중"
          : cardType === "reject"
            ? "반려됨"
            : "정산 완료";
  return {
    id: view.id,
    title: view.title,
    description: view.description,
    seedMoney: `${formatContestSeedPlain(view.seedMoney)} USDT`,
    recruitmentStartAt: formatContestDateTime(view.recruitmentStartAt),
    recruitmentEndAt: formatContestDateTime(view.recruitmentEndAt),
    contestStartAt: formatContestDateTime(view.contestStartAt),
    contestEndAt: formatContestDateTime(view.contestEndAt),
    participantCount: view.participantCount,
    cardType,
    accentLabel,
    actionLabel,
    isLive: cardType === "live" || view.displayStatus === "LIVE",
    ...extra,
  };
}

function mapLeaderboardPageToSeason(
  page: LeaderboardPageResponse,
  profileCache: ReadonlyMap<number, EnrichedMemberMeta>,
): ContestLeaderboardSeason {
  const isFinished = page.season.displayStatus === "FINISHED" || Boolean(page.season.settledAt);
  return {
    seasonId: page.season.id,
    seasonTitle: page.season.title,
    statusLabel: isFinished ? "최종 확정 순위" : "실시간 랭킹",
    period: `${formatContestDateOnly(page.season.contestStartAt)} ~ ${formatContestDateOnly(page.season.contestEndAt)}`,
    settledAt: page.season.settledAt
      ? `${formatContestDateTime(page.season.settledAt)} 정산 확정`
      : undefined,
    participantCount: page.season.participantCount,
    nextCursorId: page.nextCursorId,
    hasNext: page.hasNext,
    entries: page.items.map(entry => {
      const enriched = profileCache.get(entry.memberId);
      return {
        rank: entry.rank,
        memberId: entry.memberId,
        nickname: enriched?.nickname ?? entry.nickname,
        profileImgUrl: enriched?.profileImgUrl ?? null,
        withdrawn: enriched?.withdrawn ?? false,
        seedMoney: formatContestUsdt(entry.seedMoney),
        equity: formatContestUsdt(entry.totalEquity),
        realizedPnl: formatContestSignedUsdt(entry.realizedPnl),
        roi: formatContestSignedRoi(entry.roiPct),
        isPositive: isNonNegativeContestDecimal(entry.roiPct),
        tradeCount: typeof entry.tradeCount === "number" ? entry.tradeCount : 0,
        winRate: formatContestWinRate(entry.winRate),
      };
    }),
  };
}

export function ContestHub() {
  const memberCtx = useOptionalMember();
  const isLoggedIn = memberCtx?.snapshot.phase === "ready";
  const contentOrigin = memberCtx?.origin ?? "http://localhost:8080";

  const [guideOpen, setGuideOpen] = useState(false);
  const guideOpenRef = useRef(false);
  useEffect(() => { guideOpenRef.current = guideOpen; }, [guideOpen]);
  const [activeCatalogTab, setActiveCatalogTab] = useState<"available" | "pending" | "history">(
    "available",
  );
  const [publicRunningContests, setPublicRunningContests] = useState<ContestSeasonItem[]>([]);
  const [myOngoingContests, setMyOngoingContests] = useState<OngoingMyContestItem[]>([]);
  const [availableContests, setAvailableContests] = useState<ContestSeasonItem[]>([]);
  const [pendingContests, setPendingContests] = useState<ContestSeasonItem[]>([]);
  const [historyContests, setHistoryContests] = useState<ContestSeasonItem[]>([]);
  const [leaderboardSeasons, setLeaderboardSeasons] = useState<ContestLeaderboardSeason[]>([]);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<{ text: string; requestId?: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [feedbackNotice, setFeedbackNotice] = useState<{
    kind: "success" | "error";
    text: string;
    requestId?: string;
  } | null>(null);
  const [busySeasonId, setBusySeasonId] = useState<number | null>(null);
  const [pendingCancelContest, setPendingCancelContest] = useState<ContestSeasonItem | null>(null);
  const leaderboardSectionRef = useRef<HTMLElement>(null);

  const [selectedLeaderboardSeasonId, setSelectedLeaderboardSeasonId] = useState<number>(0);
  const [visibleRankCount, setVisibleRankCount] = useState<number>(5);
  const [loadingMoreLeaderboard, setLoadingMoreLeaderboard] = useState(false);

  const profileCacheRef = useRef<Map<number, EnrichedMemberMeta>>(new Map());

  function enrichLeaderboardMemberProfiles(memberIds: number[], signal?: AbortSignal) {
    const missing = memberIds.filter(id => id > 0 && !profileCacheRef.current.has(id));
    if (missing.length === 0) return;

    void Promise.all(
      missing.map(async id => {
        try {
          const profile = parseProfile(await contentJson(contentOrigin, `/members/${id}`, { signal }));
          profileCacheRef.current.set(id, {
            nickname: profile.nickname,
            profileImgUrl: profile.profileImgUrl ?? null,
            withdrawn: false,
          });
        } catch (err) {
          if (err instanceof ContentApiError && err.status === 404) {
            profileCacheRef.current.set(id, {
              nickname: "탈퇴한회원",
              profileImgUrl: null,
              withdrawn: true,
            });
          }
        }
      }),
    ).then(() => {
      if (signal?.aborted) return;
      setLeaderboardSeasons(prev =>
        prev.map(season => ({
          ...season,
          entries: season.entries.map(entry => {
            const meta = profileCacheRef.current.get(entry.memberId);
            if (!meta) return entry;
            return {
              ...entry,
              nickname: meta.nickname,
              profileImgUrl: meta.profileImgUrl,
              withdrawn: meta.withdrawn,
            };
          }),
        })),
      );
    });
  }

  function applyMyOverviewResponse(overview: MyContestOverviewResponse) {
    const ongoing = overview.participatingSeasons
      .filter(p => p.displayStatus !== "FINISHED")
      .map((p, idx): OngoingMyContestItem => {
        const isLive = p.displayStatus === "LIVE";
        return {
          id: p.seasonId,
          title: p.title,
          period: `${formatContestDateTime(p.contestStartAt)} ~ ${formatContestDateTime(p.contestEndAt)}`,
          contestStartAt: formatContestDateTime(p.contestStartAt),
          contestEndAt: formatContestDateTime(p.contestEndAt),
          seedMoney: formatContestUsdt(p.seedMoney),
          currentEquity: formatContestUsdt(p.totalEquity),
          myRoi: formatContestSignedRoi(p.roiPct),
          myPnl: formatContestSignedUsdt(p.totalPnl),
          myRank: p.rank ?? null,
          participantCount: p.totalParticipants,
          isLive,
          statusLabel: isLive ? "라이브 진행중" : "시작 대기중",
          dotColor: ONGOING_DOT_PALETTE[idx % ONGOING_DOT_PALETTE.length] ?? "#0058FF",
        };
      });
    setMyOngoingContests(ongoing);

    const available = overview.recruitingSeasons
      .filter(r => !r.applied)
      .map(r =>
        mapSeasonViewToItem(
          r.season,
          "apply",
          r.applicationStatus === "REJECTED" ? { actionLabel: "재신청" } : undefined,
        ),
      );
    setAvailableContests(available);

    const pending = overview.pendingApplications.map(
      (app): ContestSeasonItem => ({
        id: app.seasonId,
        title: app.seasonTitle,
        description:
          app.seasonDescription ||
          "관리자 심사 대기 중인 시즌입니다. 승인 즉시 시즌 전용 독립 대회 지갑이 자동 생성됩니다.",
        seedMoney: app.seedMoney
          ? `${formatContestSeedPlain(app.seedMoney)} USDT`
          : "10,000 USDT",
        recruitmentStartAt: formatContestDateTime(app.recruitmentStartAt ?? app.appliedAt),
        recruitmentEndAt: formatContestDateTime(app.recruitmentEndAt ?? app.contestStartAt),
        contestStartAt: formatContestDateTime(app.contestStartAt),
        contestEndAt: formatContestDateTime(app.contestEndAt),
        participantCount: 0,
        cardType: "wait",
        accentLabel: "심사중",
        actionLabel: "승인 대기중",
      }),
    );
    setPendingContests(pending);

    const pastParticipations: ContestSeasonItem[] = overview.participatingSeasons
      .filter(p => p.displayStatus === "FINISHED")
      .map(p => ({
        id: p.seasonId,
        title: p.title,
        description: p.description,
        seedMoney: `${formatContestSeedPlain(p.seedMoney)} USDT`,
        recruitmentStartAt: formatContestDateTime(p.recruitmentStartAt),
        recruitmentEndAt: formatContestDateTime(p.recruitmentEndAt),
        contestStartAt: formatContestDateTime(p.contestStartAt),
        contestEndAt: formatContestDateTime(p.contestEndAt),
        participantCount: p.totalParticipants,
        cardType: "past",
        accentLabel: "종료",
        actionLabel: "정산 완료",
        finalRank: p.rank ?? undefined,
        finalRoi: formatContestSignedRoi(p.roiPct),
        finalPnl: formatContestSignedUsdt(p.totalPnl),
      }));

    const rejectedItems: ContestSeasonItem[] = overview.rejectedApplications.map(app => ({
      id: app.seasonId,
      title: app.seasonTitle,
      description: app.seasonDescription || "신청 심사 결과 반려 처리된 시즌입니다.",
      seedMoney: app.seedMoney
        ? `${formatContestSeedPlain(app.seedMoney)} USDT`
        : "10,000 USDT",
      recruitmentStartAt: formatContestDateTime(app.recruitmentStartAt ?? app.appliedAt),
      recruitmentEndAt: formatContestDateTime(app.recruitmentEndAt ?? app.contestStartAt),
      contestStartAt: formatContestDateTime(app.contestStartAt),
      contestEndAt: formatContestDateTime(app.contestEndAt),
      participantCount: 0,
      cardType: "reject",
      accentLabel: "반려",
      actionLabel: "반려됨",
      rejectReason: app.rejectReason ?? "운영 기준 미충족으로 반려 처리되었습니다.",
    }));

    setHistoryContests([...pastParticipations, ...rejectedItems]);
  }

  useEffect(() => {
    const controller = new AbortController();

    const refreshContestOverview = () => {
      void fetchPublicContestSeasons({ signal: controller.signal })
        .then(res => {
          setOverviewError(null);
          setIsLoadingOverview(false);
          if (!res || !Array.isArray(res.seasons)) return;
          setPublicRunningContests(res.running.map(s => mapSeasonViewToItem(s, "live")));
          if (!isLoggedIn) {
            setMyOngoingContests([]);
            setPendingContests([]);
            setAvailableContests(res.recruiting.map(s => mapSeasonViewToItem(s, "apply")));
            setHistoryContests(res.finished.map(s => mapSeasonViewToItem(s, "past")));
          }
          const candidateSeasons = [...res.running, ...res.finished];
          if (candidateSeasons.length > 0) {
            const mappedCandidates: ContestLeaderboardSeason[] = candidateSeasons.map(s => {
              const isFinished = s.displayStatus === "FINISHED" || Boolean(s.settledAt);
              return {
                seasonId: s.id,
                seasonTitle: s.title,
                statusLabel: isFinished ? "최종 확정 순위" : "실시간 랭킹",
                period: `${formatContestDateOnly(s.contestStartAt)} ~ ${formatContestDateOnly(s.contestEndAt)}`,
                settledAt: s.settledAt
                  ? `${formatContestDateTime(s.settledAt)} 정산 확정`
                  : undefined,
                participantCount: s.participantCount,
                entries: [],
              };
            });
            setLeaderboardSeasons(prev =>
              mappedCandidates.map(cand => {
                const existing = prev.find(p => p.seasonId === cand.seasonId);
                return existing && existing.entries.length > 0
                  ? {
                      ...cand,
                      entries: existing.entries,
                      nextCursorId: existing.nextCursorId,
                      hasNext: existing.hasNext,
                    }
                  : cand;
              }),
            );
            const preferredId =
              selectDefaultContestSidebarSeasonId(res) ?? candidateSeasons[0]!.id;
            setSelectedLeaderboardSeasonId(prev =>
              candidateSeasons.some(s => s.id === prev) ? prev : preferredId,
            );
          } else {
            setLeaderboardSeasons([]);
            setSelectedLeaderboardSeasonId(0);
          }
        })
        .catch(err => {
          if (controller.signal.aborted) return;
          setIsLoadingOverview(false);
          setOverviewError({
            text: "대회 시즌 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
            requestId: isUnexpectedApiError(err) ? getErrorRequestId(err) : undefined,
          });
          setPublicRunningContests([]);
          setLeaderboardSeasons([]);
          if (!isLoggedIn) {
            setMyOngoingContests([]);
            setPendingContests([]);
            setAvailableContests([]);
            setHistoryContests([]);
          }
        });

      if (isLoggedIn && memberCtx?.session) {
        void memberCtx.session
          .authorized(cred =>
            fetchMyContestOverview(cred.accessToken, { signal: controller.signal }),
            true,
          )
          .then(overview => {
            setIsLoadingOverview(false);
            if (!overview || !Array.isArray(overview.participatingSeasons)) return;
            applyMyOverviewResponse(overview);
          })
          .catch(err => {
            if (controller.signal.aborted) return;
            setIsLoadingOverview(false);
            setOverviewError({
              text: "내 대회 참가 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
              requestId: isUnexpectedApiError(err) ? getErrorRequestId(err) : undefined,
            });
            setMyOngoingContests([]);
            setAvailableContests([]);
            setPendingContests([]);
            setHistoryContests([]);
          });
      }
    };

    refreshContestOverview();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden" || guideOpenRef.current) return;
      refreshContestOverview();
    }, 10_000);

    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [isLoggedIn, memberCtx?.session, memberCtx?.snapshot.generation, reloadTick]);

  useEffect(() => {
    if (!selectedLeaderboardSeasonId || selectedLeaderboardSeasonId <= 0) return;
    const controller = new AbortController();

    const refreshLeaderboard = () => {
      void fetchPublicContestLeaderboard(selectedLeaderboardSeasonId, {
        size: 20,
        signal: controller.signal,
      })
        .then(page => {
          if (!page || !page.season) return;
          const mapped = mapLeaderboardPageToSeason(page, profileCacheRef.current);
          setLeaderboardSeasons(prev => {
            const existing = prev.find(item => item.seasonId === mapped.seasonId);
            let mergedEntries = mapped.entries;
            if (existing && existing.entries.length > mapped.entries.length) {
              const seen = new Set(mapped.entries.map(e => e.memberId));
              const tail = existing.entries.filter(e => !seen.has(e.memberId));
              mergedEntries = [...mapped.entries, ...tail];
            }
            const updatedSeason: ContestLeaderboardSeason = {
              ...mapped,
              entries: mergedEntries,
              nextCursorId:
                existing && existing.entries.length > mapped.entries.length
                  ? existing.nextCursorId
                  : mapped.nextCursorId,
              hasNext:
                existing && existing.entries.length > mapped.entries.length
                  ? existing.hasNext
                  : mapped.hasNext,
            };
            if (existing) {
              return prev.map(item =>
                item.seasonId === mapped.seasonId ? updatedSeason : item,
              );
            }
            return [updatedSeason, ...prev];
          });
          enrichLeaderboardMemberProfiles(
            page.items.map(item => item.memberId),
            controller.signal,
          );
        })
        .catch(() => {
          // Preserve existing leaderboard rows on transient polling errors.
        });
    };

    refreshLeaderboard();
    const timer = window.setInterval(() => {

      if (document.visibilityState === "hidden" || guideOpenRef.current) return;
      refreshLeaderboard();
    }, 3_000);

    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeaderboardSeasonId, contentOrigin]);

  const currentLeaderboard =
    leaderboardSeasons.find(season => season.seasonId === selectedLeaderboardSeasonId) ??
    leaderboardSeasons[0] ??
    null;
  const topThreeEntries = currentLeaderboard ? currentLeaderboard.entries.slice(0, 3) : [];
  const visibleEntries = currentLeaderboard
    ? currentLeaderboard.entries.slice(0, visibleRankCount)
    : [];
  const canShowMoreLeaderboard = Boolean(
    currentLeaderboard &&
      (visibleRankCount < currentLeaderboard.entries.length || currentLeaderboard.hasNext),
  );
  const otherPublicRunningContests = publicRunningContests.filter(
    pub => !myOngoingContests.some(my => my.id === pub.id),
  );

  async function handleLoadMoreLeaderboard() {
    if (!currentLeaderboard || loadingMoreLeaderboard) return;
    if (visibleRankCount < currentLeaderboard.entries.length) {
      setVisibleRankCount(prev => prev + 10);
      return;
    }
    if (!currentLeaderboard.hasNext || currentLeaderboard.nextCursorId == null) return;
    setLoadingMoreLeaderboard(true);
    try {
      const nextPage = await fetchPublicContestLeaderboard(currentLeaderboard.seasonId, {
        cursorId: currentLeaderboard.nextCursorId,
        size: 20,
      });
      const mappedNext = mapLeaderboardPageToSeason(nextPage, profileCacheRef.current);
      setLeaderboardSeasons(prev =>
        prev.map(season => {
          if (season.seasonId !== currentLeaderboard.seasonId) return season;
          const seenMemberIds = new Set(season.entries.map(e => e.memberId));
          const appended = mappedNext.entries.filter(e => !seenMemberIds.has(e.memberId));
          return {
            ...season,
            entries: [...season.entries, ...appended],
            nextCursorId: mappedNext.nextCursorId,
            hasNext: mappedNext.hasNext,
          };
        }),
      );
      setVisibleRankCount(prev => prev + 10);
      enrichLeaderboardMemberProfiles(nextPage.items.map(item => item.memberId));
    } catch {
      setFeedbackNotice({
        kind: "error",
        text: "추가 리더보드 순위를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setLoadingMoreLeaderboard(false);
    }
  }

  function handleFocusLeaderboard(seasonId: number) {
    setSelectedLeaderboardSeasonId(seasonId);
    setVisibleRankCount(5);
    leaderboardSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleApplySeason(contest: ContestSeasonItem) {
    if (busySeasonId !== null) return;
    if (!isLoggedIn) {
      setFeedbackNotice({
        kind: "error",
        text: "대회에 참가 신청하려면 먼저 소셜 계정으로 로그인해 주세요.",
      });
      return;
    }

    if (!memberCtx?.session) {
      setFeedbackNotice({
        kind: "error",
        text: "로그인 세션을 확인한 뒤 다시 시도해 주세요.",
      });
      return;
    }

    setBusySeasonId(contest.id);
    try {
      const applicantNickname = memberCtx.snapshot.nickname ?? "";
      await memberCtx.session.authorized(cred =>
        applyForContestSeason(contest.id, applicantNickname, cred.accessToken),
      );
      setAvailableContests(prev => prev.filter(item => item.id !== contest.id));
      setPendingContests(prev => [
        {
          ...contest,
          cardType: "wait",
          accentLabel: "심사중",
          actionLabel: "승인 대기중",
        },
        ...prev,
      ]);
      setActiveCatalogTab("pending");
      setFeedbackNotice({
        kind: "success",
        text: `"${contest.title}" 참가 신청이 접수되었습니다. 관리자 승인 즉시 시즌 전용 ${contest.seedMoney} 대회 지갑이 자동 발급됩니다.`,
      });
      const overview = await memberCtx.session.authorized(
        cred => fetchMyContestOverview(cred.accessToken),
        true,
      );
      if (overview) applyMyOverviewResponse(overview);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "참가 신청 처리에 실패했습니다. 모집 기간 및 계정 상태를 확인해 주세요.";
      setFeedbackNotice({
        kind: "error",
        text: message,
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusySeasonId(null);
    }
  }

  async function confirmCancelApplication(contest: ContestSeasonItem) {
    if (busySeasonId !== null) return;
    if (!isLoggedIn || !memberCtx?.session) {
      setFeedbackNotice({
        kind: "error",
        text: "로그인 세션을 확인한 뒤 다시 시도해 주세요.",
      });
      return;
    }

    setBusySeasonId(contest.id);
    try {
      await memberCtx.session.authorized(cred =>
        cancelContestSeasonApplication(contest.id, cred.accessToken),
      );
      setPendingCancelContest(null);
      setPendingContests(prev => prev.filter(item => item.id !== contest.id));
      setFeedbackNotice({
        kind: "success",
        text: `"${contest.title}" 참가 신청이 취소되었습니다. 모집 마감 전까지 언제든 다시 신청할 수 있습니다.`,
      });
      const overview = await memberCtx.session.authorized(
        cred => fetchMyContestOverview(cred.accessToken),
        true,
      );
      if (overview) applyMyOverviewResponse(overview);
    } catch (error) {
      setPendingCancelContest(null);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "참가 신청 취소에 실패했습니다. 이미 심사 완료되었는지 확인해 주세요.";
      setFeedbackNotice({
        kind: "error",
        text: message,
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusySeasonId(null);
    }
  }

  return (
    <MemberShell
      title="시즌별 선물 모의투자 대회"
      subtitle="시즌마다 독립된 대회 전용 시드머니로 수익률을 겨루는 정규 선물 모의투자 랭킹전"
      variant="wide"
      hideCardHeading
    >
      <div data-contest-hub="" className="mx-auto max-w-7xl space-y-10 pb-12">
        {/* 상단 대회 헤더 */}
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-[#0058FF]">
              <V1IconTrophy className="h-3.5 w-3.5" />
              <span>정규 시즌 선물 모의투자 랭킹전</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
              시즌별 선물 모의투자 대회
            </h1>
            <p className="text-sm font-medium text-gray-500">
              일반 모의투자 지갑과 완전히 분리된 시즌 전용 시드머니로 실전 선물 수익률을 겨루고 공식 리더보드에 이름을 올리세요.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <V1Button
              variant="white"
              size="sm"
              data-contest-action="open-guide"
              onClick={() => setGuideOpen(true)}
              className="gap-1.5"
            >
              <V1IconInfo className="h-4 w-4 text-[#0058FF]" />
              <span>대회 규칙·상금 안내</span>
            </V1Button>
          </div>
        </header>

        {/* 서버 오류 배너 */}
        {overviewError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-xs sm:text-sm font-bold text-[#F6465D]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <V1IconAlert className="h-4 w-4 shrink-0" />
              <span>{overviewError.text}</span>
              {overviewError.requestId && <RequestIdChip requestId={overviewError.requestId} />}
            </div>
            <button
              type="button"
              onClick={() => {
                setOverviewError(null);
                setIsLoadingOverview(true);
                setReloadTick(t => t + 1);
              }}
              className="shrink-0 whitespace-nowrap rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-bold text-[#F6465D] hover:bg-rose-100"
            >
              다시 시도
            </button>
          </div>
        ) : null}

        {/* 상단 알림 피드백 배너 */}
        {feedbackNotice ? (
          <div
            role={feedbackNotice.kind === "error" ? "alert" : "status"}
            className={cn(
              "flex items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-xs sm:text-sm font-bold",
              feedbackNotice.kind === "error"
                ? "border-rose-200 bg-rose-50 text-[#F6465D]"
                : "border-blue-200 bg-blue-50 text-[#0058FF]",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {feedbackNotice.kind === "error" ? (
                <V1IconAlert className="h-4 w-4 shrink-0" />
              ) : (
                <V1IconCheck className="h-4 w-4 shrink-0" />
              )}
              <span>{feedbackNotice.text}</span>
              {feedbackNotice.requestId && <RequestIdChip requestId={feedbackNotice.requestId} />}
            </div>
            <button
              type="button"
              onClick={() => setFeedbackNotice(null)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-bold cursor-pointer",
                feedbackNotice.kind === "error"
                  ? "text-rose-600 hover:bg-rose-100"
                  : "text-gray-500 hover:bg-blue-100",
              )}
            >
              닫기
            </button>
          </div>
        ) : null}

        {isLoadingOverview ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-busy="true" aria-label="대회 시즌 불러오는 중">
            {[0, 1, 2].map(idx => (
              <div key={idx} className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white p-5" />
            ))}
          </div>
        ) : null}

        {/* 비로그인 / 게스트 분기 vs 정식 로그인 회원 분기 */}
        {!isLoggedIn ? (
          <div className="space-y-10">
            <div
              data-contest-banner="login-required"
              className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-6 sm:p-7"
            >
              <div className="space-y-1 text-center sm:text-left">
                <p className="text-base font-black text-amber-900">
                  현재 대회 목록만 열람하고 계십니다. 대회에 참가 신청하고 수익률 랭킹에 도전하려면 로그인이 필요합니다.
                </p>
                <p className="text-xs sm:text-sm font-bold text-amber-800">
                  정식 로그인 회원은 누구나 무료로 시즌별 대회에 참가 신청하고 전용 10,000 USDT 대회 지갑을 발급받을 수 있습니다.
                </p>
              </div>
              <Link
                href="/login"
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-[#0058FF] px-6 text-sm font-bold text-white transition-colors hover:bg-blue-700"
              >
                지금 로그인하기
              </Link>
            </div>

            {/* 공개 대회 3단 섹션 순차 표시 */}
            <section data-public-contest-stage="running" className="space-y-4">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-[#0058FF]" />
                <h2 className="m-0! text-lg font-black leading-tight text-gray-900">진행중인 대회</h2>
              </div>
              {publicRunningContests.length === 0 ? (
                <div className="flex h-28 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
                  <p className="text-xs font-bold text-gray-400">현재 진행 중인 대회가 없습니다.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                  {publicRunningContests.map((contest, idx) => (
                    <ContestListCard
                      key={contest.id}
                      contest={contest}
                      isLoggedIn={false}
                      canEnterTrading={false}
                      onViewLeaderboard={handleFocusLeaderboard}
                      defaultExpanded={idx === 0}
                    />
                  ))}
                </div>
              )}
            </section>

            <section data-public-contest-stage="recruiting" className="space-y-4">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-emerald-600" />
                <h2 className="m-0! text-lg font-black leading-tight text-gray-900">참가 모집중 대회</h2>
              </div>
              {availableContests.length === 0 ? (
                <div className="flex h-28 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
                  <p className="text-xs font-bold text-gray-400">현재 참가 모집 중인 대회가 없습니다.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                  {availableContests.map((contest, idx) => (
                    <ContestListCard
                      key={contest.id}
                      contest={contest}
                      isLoggedIn={false}
                      onApply={handleApplySeason}
                      defaultExpanded={idx === 0}
                    />
                  ))}
                </div>
              )}
            </section>

            <section data-public-contest-stage="finished" className="space-y-4">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-gray-400" />
                <h2 className="m-0! text-lg font-black leading-tight text-gray-900">종료된 대회</h2>
              </div>
              {historyContests.length === 0 ? (
                <div className="flex h-28 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
                  <p className="text-xs font-bold text-gray-400">종료된 대회 이력이 없습니다.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                  {historyContests.map((contest, idx) => (
                    <ContestListCard
                      key={contest.id}
                      contest={contest}
                      isLoggedIn={false}
                      defaultExpanded={idx === 0}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="space-y-10">
            {/* 1. 내 진행 중인 대회 캐러셀 */}
            <ContestOngoingSection
              contests={myOngoingContests}
              onBlockedEnter={message => setFeedbackNotice({ kind: "error", text: message })}
            />

            {otherPublicRunningContests.length > 0 ? (
              <section data-public-contest-stage="running-other" className="space-y-4">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-indigo-500" />
                  <h2 className="m-0! text-base font-black leading-tight text-gray-900">현재 진행 중인 전체 대회</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                  {otherPublicRunningContests.map((contest, idx) => (
                    <ContestListCard
                      key={contest.id}
                      contest={contest}
                      isLoggedIn={true}
                      canEnterTrading={false}
                      onViewLeaderboard={handleFocusLeaderboard}
                      defaultExpanded={idx === 0}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {/* 2. 중단 3탭 (참가 신청 가능 | 참가 심사 중 | 종료 및 반려) */}
            <section data-contest-section="catalog" className="space-y-5">
              <V1Tabs
                tabs={[
                  {
                    label: `참가 신청 가능 (${availableContests.length})`,
                    value: "available",
                    activeColor: "text-emerald-600 border-emerald-600",
                  },
                  {
                    label: `참가 심사 중 (${pendingContests.length})`,
                    value: "pending",
                    activeColor: "text-amber-600 border-amber-600",
                  },
                  {
                    label: `종료 및 반려 (${historyContests.length})`,
                    value: "history",
                    activeColor: "text-gray-900 border-gray-900",
                  },
                ]}
                activeTab={activeCatalogTab}
                onChange={value =>
                  setActiveCatalogTab(value as "available" | "pending" | "history")
                }
                variant="underline"
                className="gap-4 sm:gap-8"
              />

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {activeCatalogTab === "available" ? (
                  availableContests.length > 0 ? (
                    availableContests.map((contest, idx) => (
                      <ContestListCard
                        key={contest.id}
                        contest={contest}
                        onApply={handleApplySeason}
                        busy={busySeasonId === contest.id}
                        defaultExpanded={idx === 0}
                      />
                    ))
                  ) : (
                    <div className="col-span-full flex h-32 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
                      <p className="text-xs font-bold text-gray-400">
                        현재 신청 가능한 대회가 없습니다.
                      </p>
                    </div>
                  )
                ) : activeCatalogTab === "pending" ? (
                  pendingContests.length > 0 ? (
                    pendingContests.map((contest, idx) => (
                      <ContestListCard
                        key={contest.id}
                        contest={contest}
                        onCancel={item => setPendingCancelContest(item)}
                        busy={busySeasonId === contest.id}
                        defaultExpanded={idx === 0}
                      />
                    ))
                  ) : (
                    <div className="col-span-full flex h-32 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
                      <p className="text-xs font-bold text-gray-400">
                        현재 심사 대기 중인 대회가 없습니다.
                      </p>
                    </div>
                  )
                ) : historyContests.length > 0 ? (
                  historyContests.map(contest => (
                    <ContestListCard key={contest.id} contest={contest} defaultExpanded />
                  ))
                ) : (
                  <div className="col-span-full flex h-32 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
                    <p className="text-xs font-bold text-gray-400">
                      종료되거나 반려된 대회 이력이 없습니다.
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* 3. 하단 시즌별 대회 리더보드 & 정산 순위 섹션 */}
        <section
          ref={leaderboardSectionRef}
          data-contest-section="leaderboard"
          className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 scroll-mt-24"
        >
          <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <V1IconMedal className="h-5 w-5 shrink-0 text-[#0058FF]" />
                <h2 className="m-0! text-lg sm:text-xl font-black leading-tight text-gray-900">
                  시즌별 대회 리더보드 & 정산 순위
                </h2>
                {currentLeaderboard ? (
                  <span
                    className={cn(
                      "inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                      currentLeaderboard.statusLabel === "실시간 랭킹"
                        ? "bg-blue-50 text-[#0058FF]"
                        : "bg-emerald-50 text-emerald-700",
                    )}
                  >
                    {currentLeaderboard.statusLabel}
                  </span>
                ) : null}
              </div>
              <p className="text-xs font-medium text-gray-500">
                시즌 진행 기간에는 실시간 평가 수익률을 집계하며, 대회 종료 후에는 마크가격 스냅샷 정산을 거친 대회 기록이 명예의 전당에 영구 보존됩니다.
              </p>
            </div>

            {leaderboardSeasons.length > 0 ? (
              <div className="w-full sm:w-80 shrink-0">
                <select
                  aria-label="리더보드 시즌 선택"
                  value={selectedLeaderboardSeasonId}
                  onChange={event => {
                    setSelectedLeaderboardSeasonId(Number(event.currentTarget.value));
                    setVisibleRankCount(5);
                  }}
                  className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
                >
                  {leaderboardSeasons.map(season => (
                    <option key={season.seasonId} value={season.seasonId}>
                      {season.seasonTitle} · {season.statusLabel}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          {/* TOP 1 ~ 3 메달 카드 3열 그리드 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topThreeEntries.map(entry => {
              const medalStyle =
                entry.rank === 1
                  ? {
                      badge: "bg-amber-50 text-amber-700 border-amber-200",
                      iconColor: "text-amber-500",
                      label: "1위 · 골드 메달",
                    }
                  : entry.rank === 2
                    ? {
                        badge: "bg-slate-100 text-slate-700 border-slate-300",
                        iconColor: "text-slate-500",
                        label: "2위 · 실버 메달",
                      }
                    : {
                        badge: "bg-orange-50 text-orange-800 border-orange-200",
                        iconColor: "text-orange-600",
                        label: "3위 · 브론즈 메달",
                      };

              return (
                <div
                  key={entry.memberId}
                  data-leaderboard-top-card={entry.rank}
                  className="flex flex-col justify-between gap-4 rounded-2xl border border-gray-200 bg-[#F9FAFB] p-5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black",
                        medalStyle.badge,
                      )}
                    >
                      <V1IconMedal className={cn("h-4 w-4", medalStyle.iconColor)} />
                      <span>{medalStyle.label}</span>
                    </span>
                    <span className="text-xs font-bold text-gray-400 tabular-nums">
                      승률 {entry.winRate}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    {entry.withdrawn ? (
                      <div className="flex items-center gap-3 min-w-0">
                        <V1UserAvatar
                          src={entry.profileImgUrl}
                          memberId={entry.memberId}
                          nickname={entry.nickname}
                          size="md"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-base font-black text-gray-500">
                            {entry.nickname}
                          </p>
                          <p className="text-[11px] font-bold text-gray-400">탈퇴한 회원</p>
                        </div>
                      </div>
                    ) : (
                      <Link
                        href={`/members/${entry.memberId}`}
                        className="flex items-center gap-3 min-w-0 group"
                      >
                        <V1UserAvatar
                          src={entry.profileImgUrl}
                          memberId={entry.memberId}
                          nickname={entry.nickname}
                          size="md"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-base font-black text-gray-900 group-hover:text-[#0058FF]">
                            {entry.nickname}
                          </p>
                          <p className="text-[11px] font-bold text-gray-400">
                            프로필 및 대회 이력 보기
                          </p>
                        </div>
                      </Link>
                    )}

                    <div className="text-right shrink-0 whitespace-nowrap">
                      <p
                        className={cn(
                          "text-lg font-black tabular-nums",
                          entry.roi.startsWith("-")
                            ? "text-[#F6465D]"
                            : entry.roi === "0.00%"
                              ? "text-gray-700"
                              : "text-[#0ECB81]",
                        )}
                      >
                        {entry.roi}
                      </p>
                      <p className="text-xs font-bold text-gray-600 tabular-nums">
                        {entry.realizedPnl}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 전체 참가자 순위 테이블 */}
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-bold whitespace-nowrap">순위</th>
                  <th className="px-4 py-3 font-bold whitespace-nowrap">참가자 닉네임</th>
                  <th className="px-4 py-3 font-bold text-right whitespace-nowrap">초기 시드</th>
                  <th className="px-4 py-3 font-bold text-right whitespace-nowrap">평가자산</th>
                  <th className="px-4 py-3 font-bold text-right whitespace-nowrap">실현손익</th>
                  <th className="px-4 py-3 font-bold text-right whitespace-nowrap">수익률 ROI%</th>
                  <th className="px-4 py-3 font-bold text-right whitespace-nowrap">
                    거래횟수 · 승률
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {visibleEntries.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-xs font-bold text-gray-400"
                    >
                      집계된 시즌 리더보드 참가 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  visibleEntries.map(entry => (
                    <tr key={entry.memberId} className="hover:bg-gray-50">
                      <td className="px-4 py-3.5 font-black text-gray-900 tabular-nums whitespace-nowrap">
                        {entry.rank}위
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {entry.withdrawn ? (
                          <span className="inline-flex items-center gap-2.5 font-bold text-gray-500 whitespace-nowrap">
                            <V1UserAvatar
                              src={entry.profileImgUrl}
                              memberId={entry.memberId}
                              nickname={entry.nickname}
                              size="sm"
                            />
                            <span>{entry.nickname}</span>
                          </span>
                        ) : (
                          <Link
                            href={`/members/${entry.memberId}`}
                            className="inline-flex items-center gap-2.5 font-bold text-gray-900 hover:text-[#0058FF] whitespace-nowrap"
                          >
                            <V1UserAvatar
                              src={entry.profileImgUrl}
                              memberId={entry.memberId}
                              nickname={entry.nickname}
                              size="sm"
                            />
                            <span>{entry.nickname}</span>
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-gray-500 tabular-nums whitespace-nowrap">
                        {entry.seedMoney}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-gray-900 tabular-nums whitespace-nowrap">
                        {entry.equity}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3.5 text-right font-bold tabular-nums whitespace-nowrap",
                          entry.realizedPnl.startsWith("-")
                            ? "text-[#F6465D]"
                            : entry.realizedPnl === "0.00 USDT"
                              ? "text-gray-700"
                              : "text-[#0ECB81]",
                        )}
                      >
                        {entry.realizedPnl}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3.5 text-right font-black tabular-nums whitespace-nowrap",
                          entry.roi.startsWith("-")
                            ? "text-[#F6465D]"
                            : entry.roi === "0.00%"
                              ? "text-gray-700"
                              : "text-[#0ECB81]",
                        )}
                      >
                        {entry.roi}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-gray-600 tabular-nums whitespace-nowrap">
                        {entry.tradeCount}회 · {entry.winRate}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {canShowMoreLeaderboard && currentLeaderboard ? (
            <div className="flex justify-center pt-2">
              <V1Button
                variant="white"
                size="sm"
                disabled={loadingMoreLeaderboard}
                onClick={() => void handleLoadMoreLeaderboard()}
              >
                {loadingMoreLeaderboard
                  ? "순위 불러오는 중…"
                  : `순위 더보기 (${Math.min(visibleRankCount, currentLeaderboard.entries.length)}/${currentLeaderboard.participantCount || currentLeaderboard.entries.length})`}
              </V1Button>
            </div>
          ) : null}
        </section>
      </div>

      {/* 대회 규칙·상금 안내 모달 */}
      <DimModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="시즌별 선물 모의투자 대회 규칙 및 정산 안내"
        subtitle="요기망치 정규 시즌 대회 운영 기준"
        footer={
          <div className="flex justify-end">
            <V1Button variant="blue" size="sm" onClick={() => setGuideOpen(false)}>
              확인
            </V1Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs sm:text-sm leading-relaxed text-gray-700">
          <div className="rounded-xl border border-gray-200 bg-[#F9FAFB] p-4 space-y-1.5">
            <h3 className="font-black text-gray-900 flex items-center gap-1.5">
              <V1IconUsers className="h-4 w-4 text-[#0058FF]" />
              <span>1. 참가 자격 및 독립 시즌 지갑 발급</span>
            </h3>
            <p>
              소셜 로그인을 완료한 정식 회원이면 누구나 모집 중인 시즌에 참가 신청할 수 있습니다. 관리자 승인 즉시 일반 모의투자 지갑과 완전히 분리된 시즌 전용 대회 지갑(기본 10,000 USDT)이 발급됩니다.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-[#F9FAFB] p-4 space-y-1.5">
            <h3 className="font-black text-gray-900 flex items-center gap-1.5">
              <V1IconCalendar className="h-4 w-4 text-[#0058FF]" />
              <span>2. 거래 가능 기간 및 실시간 순위 산정</span>
            </h3>
            <p>
              각 시즌은 공지된 대회 시작 일시부터 종료 일시까지만 신규 주문 및 레버리지 변경이 가능합니다. 진행 기간 중에는 실시간 평가 수익률(ROI%)과 실현손익을 기준으로 리더보드가 갱신됩니다.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-[#F9FAFB] p-4 space-y-1.5">
            <h3 className="font-black text-gray-900 flex items-center gap-1.5">
              <V1IconClock className="h-4 w-4 text-[#0058FF]" />
              <span>3. 시즌 종료 시 일괄 정산 및 올림픽 순위 확정</span>
            </h3>
            <p>
              대회 종료 시각이 도래하면 시즌 지갑이 즉시 비활성화되며, 남아 있는 모든 미체결 지정가 주문은 자동 취소 처리되고 오픈 포지션은 종료 시점 마크가격 스냅샷을 기준으로 일괄 정산되어 대회 기록이 명예의 전당에 영구 보존됩니다.
            </p>
          </div>
        </div>
      </DimModal>

      {/* 참가 신청 취소 확인 모달 */}
      <DimModal
        open={pendingCancelContest !== null}
        onClose={() => {
          if (busySeasonId === null) setPendingCancelContest(null);
        }}
        title="대회 참가 신청을 취소할까요?"
        subtitle="모집 마감 전까지 언제든 다시 신청할 수 있습니다."
        maxWidth="420px"
        footer={
          <div className="flex justify-end gap-2">
            <V1Button
              variant="gray"
              size="sm"
              disabled={busySeasonId !== null}
              onClick={() => setPendingCancelContest(null)}
            >
              취소
            </V1Button>
            <V1Button
              variant="red"
              size="sm"
              disabled={busySeasonId !== null}
              onClick={() => {
                if (pendingCancelContest) void confirmCancelApplication(pendingCancelContest);
              }}
            >
              {busySeasonId !== null ? "취소 중…" : "신청 취소 확인"}
            </V1Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">
          {pendingCancelContest
            ? `“${pendingCancelContest.title}” 시즌 참가 신청을 취소하시겠습니까?`
            : ""}
        </p>
      </DimModal>
    </MemberShell>
  );
}
