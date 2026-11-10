"use client";

import Link from "next/link";
import { useState } from "react";
import { DimModal } from "../../member/components/dim-modal";
import { useOptionalMember } from "../../member/components/member-provider";
import { MemberShell } from "../../member/components/member-views";
import {
  cn,
  V1Button,
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
  myRank: number;
  participantCount: number;
  isLive: boolean;
  statusLabel: string;
  dotColor: string;
}

export interface ContestLeaderboardEntry {
  rank: number;
  memberId: number;
  nickname: string;
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
}

const INITIAL_MY_ONGOING_CONTESTS: OngoingMyContestItem[] = [
  {
    id: 202602,
    title: "2026 정규 시즌 2 선물 수익률 대회",
    period: "2026.11.01 09:00 ~ 2026.11.30 23:59",
    contestStartAt: "2026-11-01 09:00",
    contestEndAt: "2026-11-30 23:59",
    seedMoney: "10,000.00 USDT",
    currentEquity: "13,480.50 USDT",
    myRoi: "+34.81%",
    myPnl: "+3,480.50 USDT",
    myRank: 4,
    participantCount: 186,
    isLive: true,
    statusLabel: "라이브 진행중",
    dotColor: "#0058FF",
  },
  {
    id: 202603,
    title: "2026 연말 메이저 코인 단기 스프린트",
    period: "2026.11.05 09:00 ~ 2026.11.20 23:59",
    contestStartAt: "2026-11-05 09:00",
    contestEndAt: "2026-11-20 23:59",
    seedMoney: "10,000.00 USDT",
    currentEquity: "11,125.00 USDT",
    myRoi: "+11.25%",
    myPnl: "+1,125.00 USDT",
    myRank: 12,
    participantCount: 94,
    isLive: true,
    statusLabel: "라이브 진행중",
    dotColor: "#10B981",
  },
  {
    id: 202604,
    title: "2026 윈터 파이널 챔피언십 시즌 3",
    period: "2026.12.01 09:00 ~ 2026.12.31 23:59",
    contestStartAt: "2026-12-01 09:00",
    contestEndAt: "2026-12-31 23:59",
    seedMoney: "10,000.00 USDT",
    currentEquity: "10,000.00 USDT",
    myRoi: "0.00%",
    myPnl: "0.00 USDT",
    myRank: 1,
    participantCount: 68,
    isLive: false,
    statusLabel: "시작 대기중",
    dotColor: "#F59E0B",
  },
];

const INITIAL_AVAILABLE_CONTESTS: ContestSeasonItem[] = [
  {
    id: 202605,
    title: "2026 정규 시즌 4 알트코인 변동성 챌린지",
    description:
      "비트코인·이더리움·솔라나·리플 무기한 선물을 대상으로 동일 10,000 USDT 시드머니에서 출발해 시즌 누적 수익률을 겨루는 공식 대회입니다.",
    seedMoney: "10,000 USDT",
    recruitmentStartAt: "2026.11.01 00:00",
    recruitmentEndAt: "2026.11.25 23:59",
    contestStartAt: "2026.11.26 09:00",
    contestEndAt: "2026.12.15 23:59",
    participantCount: 112,
    cardType: "apply",
    accentLabel: "모집중",
    actionLabel: "신청",
    rewardSummary: "1위 명예 골드 배지 · TOP 3 프로필 타이틀 부여",
  },
  {
    id: 202606,
    title: "2026 하이레버리지 실전 리스크 매니지먼트 리그",
    description:
      "손절가 설정과 격리/교차 증거금 규율을 준수하며 최고 실현 손익률을 기록한 트레이더를 선발하는 시즌 대회입니다.",
    seedMoney: "10,000 USDT",
    recruitmentStartAt: "2026.11.03 00:00",
    recruitmentEndAt: "2026.11.28 23:59",
    contestStartAt: "2026.11.29 09:00",
    contestEndAt: "2026.12.20 23:59",
    participantCount: 79,
    cardType: "apply",
    accentLabel: "모집중",
    actionLabel: "신청",
    rewardSummary: "시즌 공식 리더보드 영구 박제 및 차티스트 랭킹 등재",
  },
  {
    id: 202607,
    title: "2027 신년 오프닝 선물 모의투자 그랑프리",
    description:
      "신년 글로벌 거시 지표 발표 주간에 맞춰 오픈되는 정규 그랑프리 시즌으로, 정식 회원 누구나 무료로 참가 신청할 수 있습니다.",
    seedMoney: "10,000 USDT",
    recruitmentStartAt: "2026.11.10 00:00",
    recruitmentEndAt: "2026.12.28 23:59",
    contestStartAt: "2027.01.02 09:00",
    contestEndAt: "2027.01.31 23:59",
    participantCount: 45,
    cardType: "apply",
    accentLabel: "모집중",
    actionLabel: "신청",
    rewardSummary: "시즌 1~3위 공식 메달 배지 및 커뮤니티 상단 랭킹 노출",
  },
];

const INITIAL_PENDING_CONTESTS: ContestSeasonItem[] = [
  {
    id: 202608,
    title: "2026 매크로 위클리 FOMC 특별 토너먼트",
    description:
      "금리 결정 주간의 급격한 변동성 장세에서 안정적인 수익률을 달성하는 단기 집중 토너먼트입니다. 관리자 승인 즉시 시즌 전용 지갑이 생성됩니다.",
    seedMoney: "10,000 USDT",
    recruitmentStartAt: "2026.11.01 00:00",
    recruitmentEndAt: "2026.11.18 23:59",
    contestStartAt: "2026.11.19 09:00",
    contestEndAt: "2026.11.26 23:59",
    participantCount: 64,
    cardType: "wait",
    accentLabel: "심사중",
    actionLabel: "승인 대기중",
  },
];

const INITIAL_HISTORY_CONTESTS: ContestSeasonItem[] = [
  {
    id: 202601,
    title: "2026 정규 시즌 1 선물 수익률 대회",
    description:
      "요기망치 V2 첫 정규 시즌 대회로, 종료 시각 기준 모든 미체결 주문 소프트 취소 및 오픈 포지션 마크가격 스냅샷 정산을 완료하여 최종 순위가 확정되었습니다.",
    seedMoney: "10,000 USDT",
    recruitmentStartAt: "2026.09.20 00:00",
    recruitmentEndAt: "2026.09.30 23:59",
    contestStartAt: "2026.10.01 09:00",
    contestEndAt: "2026.10.31 23:59",
    participantCount: 240,
    cardType: "past",
    accentLabel: "종료",
    actionLabel: "정산 완료",
    finalRank: 5,
    finalRoi: "+62.40%",
    finalPnl: "+6,240.00 USDT",
  },
  {
    id: 202512,
    title: "2026 프리시즌 VIP 초청 스페셜 매치",
    description:
      "사전 초청 기준 및 시즌 운영 정책 검증을 위한 스페셜 매치 시즌입니다.",
    seedMoney: "10,000 USDT",
    recruitmentStartAt: "2026.09.01 00:00",
    recruitmentEndAt: "2026.09.10 23:59",
    contestStartAt: "2026.09.12 09:00",
    contestEndAt: "2026.09.25 23:59",
    participantCount: 50,
    cardType: "reject",
    accentLabel: "반려",
    actionLabel: "반려됨",
    rejectReason: "신청 마감 시각 직전 중복 신청 건으로 확인되어 기본 정규 시즌으로 안내되었습니다.",
  },
];

const PUBLIC_RUNNING_CONTESTS: ContestSeasonItem[] = [
  {
    id: 202602,
    title: "2026 정규 시즌 2 선물 수익률 대회",
    description:
      "현재 실시간으로 186명의 트레이더가 10,000 USDT 전용 시드머니로 수익률 경쟁을 펼치고 있는 메인 정규 시즌입니다.",
    seedMoney: "10,000 USDT",
    recruitmentStartAt: "2026.10.20 00:00",
    recruitmentEndAt: "2026.10.31 23:59",
    contestStartAt: "2026.11.01 09:00",
    contestEndAt: "2026.11.30 23:59",
    participantCount: 186,
    cardType: "live",
    accentLabel: "진행중",
    actionLabel: "진행중인 대회",
    isLive: true,
  },
  {
    id: 202603,
    title: "2026 연말 메이저 코인 단기 스프린트",
    description:
      "비트코인과 이더리움 무기한 선물에 집중하여 단기 추세 추종 실력을 겨루는 스프린트 시즌입니다.",
    seedMoney: "10,000 USDT",
    recruitmentStartAt: "2026.10.25 00:00",
    recruitmentEndAt: "2026.11.04 23:59",
    contestStartAt: "2026.11.05 09:00",
    contestEndAt: "2026.11.20 23:59",
    participantCount: 94,
    cardType: "live",
    accentLabel: "진행중",
    actionLabel: "진행중인 대회",
    isLive: true,
  },
];

const LEADERBOARD_SEASONS: ContestLeaderboardSeason[] = [
  {
    seasonId: 202602,
    seasonTitle: "2026 정규 시즌 2 선물 수익률 대회",
    statusLabel: "실시간 랭킹",
    period: "2026.11.01 ~ 2026.11.30",
    participantCount: 186,
    entries: [
      {
        rank: 1,
        memberId: 11,
        nickname: "알파트레이더",
        seedMoney: "10,000.00 USDT",
        equity: "24,850.00 USDT",
        realizedPnl: "+14,850.00 USDT",
        roi: "+148.50%",
        isPositive: true,
        tradeCount: 42,
        winRate: "76.2%",
      },
      {
        rank: 2,
        memberId: 22,
        nickname: "솔라나고래",
        seedMoney: "10,000.00 USDT",
        equity: "19,320.40 USDT",
        realizedPnl: "+9,320.40 USDT",
        roi: "+93.20%",
        isPositive: true,
        tradeCount: 31,
        winRate: "71.0%",
      },
      {
        rank: 3,
        memberId: 15,
        nickname: "퀀트매니저",
        seedMoney: "10,000.00 USDT",
        equity: "16,740.00 USDT",
        realizedPnl: "+6,740.00 USDT",
        roi: "+67.40%",
        isPositive: true,
        tradeCount: 58,
        winRate: "68.9%",
      },
      {
        rank: 4,
        memberId: 31,
        nickname: "매크로워처",
        seedMoney: "10,000.00 USDT",
        equity: "13,480.50 USDT",
        realizedPnl: "+3,480.50 USDT",
        roi: "+34.81%",
        isPositive: true,
        tradeCount: 19,
        winRate: "63.2%",
      },
      {
        rank: 5,
        memberId: 44,
        nickname: "리스크헌터",
        seedMoney: "10,000.00 USDT",
        equity: "12,190.00 USDT",
        realizedPnl: "+2,190.00 USDT",
        roi: "+21.90%",
        isPositive: true,
        tradeCount: 27,
        winRate: "59.3%",
      },
      {
        rank: 6,
        memberId: 52,
        nickname: "돌파매매왕",
        seedMoney: "10,000.00 USDT",
        equity: "11,040.20 USDT",
        realizedPnl: "+1,040.20 USDT",
        roi: "+10.40%",
        isPositive: true,
        tradeCount: 36,
        winRate: "55.6%",
      },
      {
        rank: 7,
        memberId: 63,
        nickname: "모멘텀시커",
        seedMoney: "10,000.00 USDT",
        equity: "9,420.00 USDT",
        realizedPnl: "-580.00 USDT",
        roi: "-5.80%",
        isPositive: false,
        tradeCount: 24,
        winRate: "45.8%",
      },
    ],
  },
  {
    seasonId: 202601,
    seasonTitle: "2026 정규 시즌 1 선물 수익률 대회",
    statusLabel: "최종 확정 순위",
    period: "2026.10.01 ~ 2026.10.31",
    settledAt: "2026.10.31 23:59 정산 확정",
    participantCount: 240,
    entries: [
      {
        rank: 1,
        memberId: 15,
        nickname: "퀀트매니저",
        seedMoney: "10,000.00 USDT",
        equity: "31,200.00 USDT",
        realizedPnl: "+21,200.00 USDT",
        roi: "+212.00%",
        isPositive: true,
        tradeCount: 64,
        winRate: "78.1%",
      },
      {
        rank: 2,
        memberId: 11,
        nickname: "알파트레이더",
        seedMoney: "10,000.00 USDT",
        equity: "25,400.00 USDT",
        realizedPnl: "+15,400.00 USDT",
        roi: "+154.00%",
        isPositive: true,
        tradeCount: 49,
        winRate: "73.5%",
      },
      {
        rank: 3,
        memberId: 31,
        nickname: "매크로워처",
        seedMoney: "10,000.00 USDT",
        equity: "18,950.00 USDT",
        realizedPnl: "+8,950.00 USDT",
        roi: "+89.50%",
        isPositive: true,
        tradeCount: 38,
        winRate: "68.4%",
      },
      {
        rank: 4,
        memberId: 22,
        nickname: "솔라나고래",
        seedMoney: "10,000.00 USDT",
        equity: "17,120.00 USDT",
        realizedPnl: "+7,120.00 USDT",
        roi: "+71.20%",
        isPositive: true,
        tradeCount: 41,
        winRate: "65.9%",
      },
      {
        rank: 5,
        memberId: 44,
        nickname: "리스크헌터",
        seedMoney: "10,000.00 USDT",
        equity: "16,240.00 USDT",
        realizedPnl: "+6,240.00 USDT",
        roi: "+62.40%",
        isPositive: true,
        tradeCount: 29,
        winRate: "62.1%",
      },
    ],
  },
];

export function ContestListCard({
  contest,
  onApply,
  defaultExpanded = false,
}: {
  contest: ContestSeasonItem;
  onApply?: (contest: ContestSeasonItem) => void;
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
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(prev => !prev)}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsExpanded(prev => !prev);
          }
        }}
        className="flex items-center justify-between gap-3 p-5 cursor-pointer select-none"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold",
              badgeTone,
            )}
          >
            {contest.accentLabel}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h3
              className={cn(
                "text-sm font-black tracking-tight text-gray-900 leading-snug",
                contest.cardType === "reject" && "line-through text-gray-400",
                !isExpanded && "truncate",
              )}
            >
              {contest.title}
            </h3>
            <p className="text-[11px] font-bold text-gray-400 tabular-nums">
              {contest.contestStartAt} ~ {contest.contestEndAt}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {contest.cardType === "apply" && onApply ? (
            <button
              type="button"
              data-contest-action="apply"
              onClick={event => {
                event.stopPropagation();
                onApply(contest);
              }}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 cursor-pointer"
            >
              <span>신청</span>
              <V1IconArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : contest.cardType === "live" ? (
            <Link
              href={`/contest/${contest.id}/trading`}
              onClick={event => event.stopPropagation()}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-xl bg-[#0058FF] px-3.5 text-xs font-bold text-white transition-colors hover:bg-blue-700"
            >
              <span>터미널 보기</span>
              <V1IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span
              className={cn(
                "inline-flex h-8 items-center justify-center rounded-xl px-3 text-xs font-bold",
                contest.cardType === "wait"
                  ? "border border-amber-200 bg-amber-50 text-amber-700"
                  : contest.cardType === "reject"
                    ? "border border-rose-200 bg-rose-50 text-rose-700"
                    : "border border-gray-200 bg-gray-50 text-gray-600",
              )}
            >
              {contest.actionLabel}
            </span>
          )}
          <V1IconChevronDown
            className={cn(
              "h-4 w-4 text-gray-400 transition-transform",
              isExpanded && "rotate-180",
            )}
          />
        </div>
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
                <span className="text-gray-700">실현손익 {contest.finalPnl}</span>
                <span className="rounded-full bg-[#0058FF] px-2.5 py-0.5 text-[11px] font-black text-white">
                  최종 수익률 {contest.finalRoi}
                </span>
              </div>
            </div>
          ) : null}

          {contest.cardType === "reject" && contest.rejectReason ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 space-y-1">
              <p className="text-[11px] font-black text-rose-700">반려 사유</p>
              <p className="font-bold text-rose-900 leading-relaxed">
                {contest.rejectReason}
              </p>
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

  const handlePrev = () => setStartIndex(prev => Math.max(0, prev - 1));
  const handleNext = () =>
    setStartIndex(prev => Math.min(Math.max(0, contests.length - 3), prev + 1));

  return (
    <section data-contest-section="ongoing" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-[#0058FF]" />
          <h2 className="text-base font-black text-gray-900">내 진행 중인 대회</h2>
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-[#0058FF]">
            {contests.length}시즌
          </span>
        </div>

        {contests.length > 3 ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrev}
              disabled={startIndex === 0}
              aria-label="이전 시즌 보기"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <V1IconChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={startIndex >= contests.length - 3}
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
          {contests.slice(startIndex, startIndex + 3).map(contest => (
            <article
              key={contest.id}
              data-ongoing-contest-card={contest.id}
              className="flex flex-col justify-between gap-5 rounded-2xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
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
                          ? "text-red-500"
                          : contest.myRoi.startsWith("-")
                            ? "text-[#0058FF]"
                            : "text-gray-700",
                      )}
                    >
                      {contest.myRoi}
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-[11px] font-bold text-gray-400">현재 순위</dt>
                    <dd className="mt-0.5 text-xs font-black text-gray-900 tabular-nums">
                      {contest.isLive ? `${contest.myRank}위 / ${contest.participantCount}명` : "집계 전"}
                    </dd>
                  </div>
                </dl>
              </div>

              {contest.isLive ? (
                <Link
                  href={`/contest/${contest.id}/trading`}
                  data-contest-enter={contest.id}
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#0058FF] px-4 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                >
                  <span>대회장 입장</span>
                  <V1IconArrowRight className="h-3.5 w-3.5" />
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
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-100 px-4 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-200 cursor-pointer"
                >
                  <span>대회장 입장</span>
                  <V1IconArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function ContestHub() {
  const memberCtx = useOptionalMember();
  const isLoggedIn = memberCtx?.snapshot.phase === "ready";

  const [guideOpen, setGuideOpen] = useState(false);
  const [activeCatalogTab, setActiveCatalogTab] = useState<"available" | "pending" | "history">(
    "available",
  );
  const [availableContests, setAvailableContests] =
    useState<ContestSeasonItem[]>(INITIAL_AVAILABLE_CONTESTS);
  const [pendingContests, setPendingContests] =
    useState<ContestSeasonItem[]>(INITIAL_PENDING_CONTESTS);
  const [historyContests] = useState<ContestSeasonItem[]>(INITIAL_HISTORY_CONTESTS);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  const [selectedLeaderboardSeasonId, setSelectedLeaderboardSeasonId] = useState<number>(
    LEADERBOARD_SEASONS[0]!.seasonId,
  );
  const [visibleRankCount, setVisibleRankCount] = useState<number>(5);

  const currentLeaderboard =
    LEADERBOARD_SEASONS.find(season => season.seasonId === selectedLeaderboardSeasonId) ??
    LEADERBOARD_SEASONS[0]!;
  const topThreeEntries = currentLeaderboard.entries.slice(0, 3);
  const visibleEntries = currentLeaderboard.entries.slice(0, visibleRankCount);

  function handleApplySeason(contest: ContestSeasonItem) {
    if (!isLoggedIn) {
      setFeedbackNotice(
        "대회에 참가 신청하려면 먼저 소셜 계정으로 로그인해 주세요.",
      );
      return;
    }

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
    setFeedbackNotice(
      `"${contest.title}" 참가 신청이 접수되었습니다. 관리자 승인 즉시 시즌 전용 ${contest.seedMoney} 대회 지갑이 자동 발급됩니다.`,
    );
  }

  return (
    <MemberShell
      title="시즌별 선물 모의투자 대회"
      subtitle="시즌마다 독립된 대회 전용 시드머니로 수익률을 겨루는 정규 선물 모의투자 랭킹전"
      variant="wide"
      hideCardHeading
    >
      <div className="mx-auto max-w-7xl space-y-10 pb-12">
        {/* 상단 대회 헤더 */}
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-[#0058FF]">
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

        {/* 상단 알림 피드백 배너 */}
        {feedbackNotice ? (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-xs sm:text-sm font-bold text-[#0058FF]"
          >
            <div className="flex items-center gap-2">
              <V1IconCheck className="h-4 w-4 shrink-0" />
              <span>{feedbackNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackNotice(null)}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-gray-500 hover:bg-blue-100"
            >
              닫기
            </button>
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
                <span className="h-4 w-1 rounded-full bg-[#0058FF]" />
                <h2 className="text-lg font-black text-gray-900">진행중인 대회</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {PUBLIC_RUNNING_CONTESTS.map((contest, idx) => (
                  <ContestListCard
                    key={contest.id}
                    contest={contest}
                    defaultExpanded={idx === 0}
                  />
                ))}
              </div>
            </section>

            <section data-public-contest-stage="recruiting" className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="h-4 w-1 rounded-full bg-emerald-600" />
                <h2 className="text-lg font-black text-gray-900">참가 모집중 대회</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {availableContests.map((contest, idx) => (
                  <ContestListCard
                    key={contest.id}
                    contest={contest}
                    onApply={handleApplySeason}
                    defaultExpanded={idx === 0}
                  />
                ))}
              </div>
            </section>

            <section data-public-contest-stage="finished" className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="h-4 w-1 rounded-full bg-gray-400" />
                <h2 className="text-lg font-black text-gray-900">종료된 대회</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {historyContests.map((contest, idx) => (
                  <ContestListCard
                    key={contest.id}
                    contest={contest}
                    defaultExpanded={idx === 0}
                  />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-10">
            {/* 1. 내 진행 중인 대회 캐러셀 */}
            <ContestOngoingSection
              contests={INITIAL_MY_ONGOING_CONTESTS}
              onBlockedEnter={message => setFeedbackNotice(message)}
            />

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
                    <ContestListCard
                      key={contest.id}
                      contest={contest}
                      defaultExpanded
                    />
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
          data-contest-section="leaderboard"
          className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 sm:p-8"
        >
          <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <V1IconMedal className="h-5 w-5 text-[#0058FF]" />
                <h2 className="text-lg sm:text-xl font-black text-gray-900">
                  시즌별 대회 리더보드 & 정산 순위
                </h2>
                <span
                  className={cn(
                    "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                    currentLeaderboard.statusLabel === "실시간 랭킹"
                      ? "bg-blue-50 text-[#0058FF]"
                      : "bg-emerald-50 text-emerald-700",
                  )}
                >
                  {currentLeaderboard.statusLabel}
                </span>
              </div>
              <p className="text-xs font-medium text-gray-500">
                시즌 진행 기간에는 실시간 평가 수익률을 집계하며, 대회 종료 후에는 마크가격 스냅샷 정산을 거친 최종 올림픽 순위가 영구 박제됩니다.
              </p>
            </div>

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
                {LEADERBOARD_SEASONS.map(season => (
                  <option key={season.seasonId} value={season.seasonId}>
                    {season.seasonTitle} · {season.statusLabel}
                  </option>
                ))}
              </select>
            </div>
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
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black",
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
                    <Link
                      href={`/members/${entry.memberId}`}
                      className="flex items-center gap-3 min-w-0 group"
                    >
                      <V1UserAvatar
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

                    <div className="text-right">
                      <p className="text-lg font-black text-red-500 tabular-nums">
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
                  <th className="px-4 py-3 font-bold">순위</th>
                  <th className="px-4 py-3 font-bold">참가자 닉네임</th>
                  <th className="px-4 py-3 font-bold text-right">초기 시드</th>
                  <th className="px-4 py-3 font-bold text-right">평가자산</th>
                  <th className="px-4 py-3 font-bold text-right">실현손익</th>
                  <th className="px-4 py-3 font-bold text-right">수익률 ROI%</th>
                  <th className="px-4 py-3 font-bold text-right">거래횟수 · 승률</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {visibleEntries.map(entry => (
                  <tr key={entry.memberId} className="hover:bg-gray-50">
                    <td className="px-4 py-3.5 font-black text-gray-900 tabular-nums">
                      {entry.rank}위
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/members/${entry.memberId}`}
                        className="inline-flex items-center gap-2.5 font-bold text-gray-900 hover:text-[#0058FF]"
                      >
                        <V1UserAvatar
                          memberId={entry.memberId}
                          nickname={entry.nickname}
                          size="sm"
                        />
                        <span>{entry.nickname}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-gray-500 tabular-nums">
                      {entry.seedMoney}
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-gray-900 tabular-nums">
                      {entry.equity}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3.5 text-right font-bold tabular-nums",
                        entry.isPositive ? "text-red-500" : "text-[#0058FF]",
                      )}
                    >
                      {entry.realizedPnl}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3.5 text-right font-black tabular-nums",
                        entry.isPositive ? "text-red-500" : "text-[#0058FF]",
                      )}
                    >
                      {entry.roi}
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-gray-600 tabular-nums">
                      {entry.tradeCount}회 · {entry.winRate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visibleRankCount < currentLeaderboard.entries.length ? (
            <div className="flex justify-center pt-2">
              <V1Button
                variant="white"
                size="sm"
                onClick={() => setVisibleRankCount(prev => prev + 5)}
              >
                순위 더보기 ({visibleRankCount}/{currentLeaderboard.entries.length})
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
              대회 종료 시각이 도래하면 시즌 지갑이 즉시 비활성화되며, 남아 있는 모든 미체결 지정가 주문은 소프트 취소 처리되고 오픈 포지션은 종료 시점 마크가격 스냅샷을 기준으로 일괄 정산되어 최종 올림픽 순위(동점자 동일 순위 부여)가 영구 박제됩니다.
            </p>
          </div>
        </div>
      </DimModal>
    </MemberShell>
  );
}
