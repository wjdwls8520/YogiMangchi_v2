"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useOptionalMember } from "../../member/components/member-provider";
import { MarketChartPanel } from "../../trading/components/market-chart-panel";
import { OrderPanel } from "../../trading/components/order-panel";
import { TradingDataProvider, useOptionalGuestSession } from "../../trading/components/trading-data-provider";
import { useTradingSummary } from "../../trading/api/queries";
import {
  cn,
  V1Header,
  V1IconArrowLeft,
  V1IconClock,
  V1IconTrophy,
} from "../../member/components/v1-ui";
import {
  fetchContestSeasonSummary,
  fetchPublicContestSeasons,
  formatContestDateOnly,
  formatContestSignedRoi,
  formatContestUsdt,
  type ContestSeasonSummaryResponse,
  type ContestSeasonView,
} from "../api/contest-client";

interface ContestSeasonTerminalMeta {
  seasonId: number;
  title: string;
  period: string;
  remainingLabel: string;
  walletStatus: "ACTIVE" | "SETTLED";
  seedMoney: string;
  contestEquity: string;
  availableMargin: string;
  seasonRoi: string;
  liveRank: string;
  dotColor: string;
}

const SEASON_TERMINAL_CATALOG: Record<number, ContestSeasonTerminalMeta> = {
  202602: {
    seasonId: 202602,
    title: "2026 정규 시즌 2 선물 수익률 대회",
    period: "2026.11.01 ~ 2026.11.30",
    remainingLabel: "종료까지 20일 14시간 남음",
    walletStatus: "ACTIVE",
    seedMoney: "10,000.00 USDT",
    contestEquity: "13,480.50 USDT",
    availableMargin: "8,920.00 USDT",
    seasonRoi: "+34.81%",
    liveRank: "4위 / 186명",
    dotColor: "#0058FF",
  },
  202603: {
    seasonId: 202603,
    title: "2026 연말 메이저 코인 단기 스프린트",
    period: "2026.11.05 ~ 2026.11.20",
    remainingLabel: "종료까지 10일 09시간 남음",
    walletStatus: "ACTIVE",
    seedMoney: "10,000.00 USDT",
    contestEquity: "11,125.00 USDT",
    availableMargin: "7,400.00 USDT",
    seasonRoi: "+11.25%",
    liveRank: "12위 / 94명",
    dotColor: "#10B981",
  },
  202601: {
    seasonId: 202601,
    title: "2026 정규 시즌 1 선물 수익률 대회",
    period: "2026.10.01 ~ 2026.10.31",
    remainingLabel: "시즌 종료 · 정산 확정 완료",
    walletStatus: "SETTLED",
    seedMoney: "10,000.00 USDT",
    contestEquity: "16,240.00 USDT",
    availableMargin: "0.00 USDT",
    seasonRoi: "+62.40%",
    liveRank: "최종 5위 / 240명",
    dotColor: "#9CA3AF",
  },
};

const SEASON_DOT_PALETTE = ["#0058FF", "#8B5CF6", "#10B981", "#F59E0B", "#EC4899", "#06B6D4"];

function resolveContestTerminalMeta(seasonIdInput: number | string): ContestSeasonTerminalMeta {
  const numericId = Number(seasonIdInput);
  const safeId = Number.isFinite(numericId) && numericId > 0 ? numericId : 202602;
  const matched = SEASON_TERMINAL_CATALOG[safeId];
  if (matched) return matched;
  return {
    seasonId: safeId,
    title: `2026 정규 시즌 #${safeId} 선물 수익률 대회`,
    period: "2026.11.01 ~ 2026.11.30",
    remainingLabel: "시즌 진행 중",
    walletStatus: "ACTIVE",
    seedMoney: "10,000.00 USDT",
    contestEquity: "10,000.00 USDT",
    availableMargin: "10,000.00 USDT",
    seasonRoi: "0.00%",
    liveRank: "집계 중",
    dotColor: SEASON_DOT_PALETTE[safeId % SEASON_DOT_PALETTE.length] ?? "#0058FF",
  };
}

function mapSummaryToTerminalMeta(
  summary: ContestSeasonSummaryResponse,
  dotColor: string,
): ContestSeasonTerminalMeta {
  const { season, participation } = summary;
  const isSettled = Boolean(season.settledAt) || season.displayStatus === "FINISHED";
  return {
    seasonId: season.id,
    title: season.title,
    period: `${formatContestDateOnly(season.contestStartAt)} ~ ${formatContestDateOnly(season.contestEndAt)}`,
    remainingLabel: isSettled ? "시즌 종료 · 정산 확정 완료" : season.statusLabel || "시즌 진행 중",
    walletStatus: isSettled ? "SETTLED" : "ACTIVE",
    seedMoney: formatContestUsdt(participation.seedMoney),
    contestEquity: formatContestUsdt(participation.totalEquity),
    availableMargin: formatContestUsdt(participation.availableBalance),
    seasonRoi: formatContestSignedRoi(participation.roiPct),
    liveRank:
      participation.rank != null
        ? `${isSettled ? "최종 " : ""}${participation.rank}위 / ${participation.totalParticipants}명`
        : "집계 중",
    dotColor,
  };
}

function mapPublicSeasonToTerminalMeta(
  season: ContestSeasonView,
  fallback: ContestSeasonTerminalMeta,
): ContestSeasonTerminalMeta {
  const isSettled = Boolean(season.settledAt) || season.displayStatus === "FINISHED";
  return {
    seasonId: season.id,
    title: season.title,
    period: `${formatContestDateOnly(season.contestStartAt)} ~ ${formatContestDateOnly(season.contestEndAt)}`,
    remainingLabel: isSettled ? "시즌 종료 · 정산 확정 완료" : season.statusLabel || "시즌 진행 중",
    walletStatus: isSettled ? "SETTLED" : "ACTIVE",
    seedMoney: formatContestUsdt(season.seedMoney),
    contestEquity: "—",
    availableMargin: "—",
    seasonRoi: "—",
    liveRank: `${season.participantCount}명 참가 중`,
    dotColor: fallback.dotColor,
  };
}

function ContestLiveWalletSync({
  onWalletUpdate,
}: {
  onWalletUpdate: (wallet: { contestEquity: string; availableMargin: string }) => void;
}) {
  const summary = useTradingSummary();
  const equity = summary.data?.wallet.equity ?? summary.data?.wallet.balance ?? null;
  const available = summary.data?.wallet.availableBalance ?? summary.data?.wallet.balance ?? null;

  useEffect(() => {
    if (equity != null && available != null) {
      onWalletUpdate({
        contestEquity: formatContestUsdt(equity),
        availableMargin: formatContestUsdt(available),
      });
    }
  }, [equity, available, onWalletUpdate]);

  return null;
}

export function ContestTradingSubheader({
  seasonId,
}: {
  seasonId: number | string;
}) {
  const memberCtx = useOptionalMember();
  const guestCtx = useOptionalGuestSession();
  const baseMeta = resolveContestTerminalMeta(seasonId);
  const [liveMeta, setLiveMeta] = useState<ContestSeasonTerminalMeta | null>(null);
  const [liveWallet, setLiveWallet] = useState<{ contestEquity: string; availableMargin: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const fallbackMeta = resolveContestTerminalMeta(seasonId);
    const targetSeasonId = fallbackMeta.seasonId;

    const loadFallbackPublicSeason = () =>
      fetchPublicContestSeasons({ signal: controller.signal })
        .then(res => {
          const matched = res?.seasons?.find(s => s.id === targetSeasonId);
          if (matched) {
            setLiveMeta(mapPublicSeasonToTerminalMeta(matched, fallbackMeta));
          }
        })
        .catch(() => {
          // Keep static fallback metadata
        });

    if (memberCtx?.snapshot.phase === "ready" && memberCtx.session) {
      void memberCtx.session
        .authorized(cred =>
          fetchContestSeasonSummary(targetSeasonId, cred.accessToken, {
            signal: controller.signal,
          }),
        )
        .then(summary => {
          if (summary && summary.season && summary.participation) {
            setLiveMeta(mapSummaryToTerminalMeta(summary, fallbackMeta.dotColor));
          }
        })
        .catch(() => loadFallbackPublicSeason());
    } else {
      void loadFallbackPublicSeason();
    }

    return () => controller.abort();
  }, [seasonId, memberCtx?.session, memberCtx?.snapshot.phase]);

  const rawMeta = liveMeta && liveMeta.seasonId === baseMeta.seasonId ? liveMeta : baseMeta;
  const meta: ContestSeasonTerminalMeta = liveWallet
    ? {
        ...rawMeta,
        contestEquity: liveWallet.contestEquity,
        availableMargin: liveWallet.availableMargin,
      }
    : rawMeta;
  const isActive = meta.walletStatus === "ACTIVE";

  return (
    <div
      data-contest-trading-subheader={meta.seasonId}
      className="flex min-h-[48px] w-full flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#161A1E] px-4 py-1.5 text-xs text-white"
    >
      {guestCtx ? <ContestLiveWalletSync onWalletUpdate={setLiveWallet} /> : null}
      {/* 좌측: 대회 목록 돌아가기 + 시즌 컬러 도트 + 시즌 타이틀 + 대회 지갑 상태 배지 + 남은 시간 */}
      <div className="flex flex-wrap items-center gap-3 min-w-0">
        <Link
          href="/contest"
          className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-white/10 bg-white/5 px-2.5 text-[11px] font-bold text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <V1IconArrowLeft className="h-3.5 w-3.5 shrink-0" />
          <span>대회 목록</span>
        </Link>

        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: meta.dotColor }}
          />
          <strong className="truncate text-xs sm:text-sm font-black tracking-tight text-white">
            {meta.title}
          </strong>
          <span
            className={cn(
              "inline-flex shrink-0 items-center whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-black",
              isActive
                ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                : "border border-gray-500/30 bg-gray-500/15 text-gray-300",
            )}
          >
            {isActive ? "ACTIVE" : "종료·정산완료"}
          </span>
        </div>

        <span className="hidden xl:inline-flex items-center gap-1 text-[11px] font-bold text-gray-400 tabular-nums">
          <V1IconClock className="h-3.5 w-3.5 text-gray-400" />
          <span>
            {meta.period} · {meta.remainingLabel}
          </span>
        </span>
      </div>

      {/* 중앙/우측: 시즌 전용 대회 지갑 실시간 요약 + CONTEST MODE 배지 */}
      <div className="flex flex-wrap items-center gap-4 ml-auto">
        <dl className="hidden md:flex items-center gap-4 text-[11px] tabular-nums whitespace-nowrap">
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <dt className="font-bold text-gray-400 whitespace-nowrap">시즌 시드</dt>
            <dd className="font-black text-gray-200 whitespace-nowrap">{meta.seedMoney}</dd>
          </div>
          <div className="h-3 w-[1px] shrink-0 bg-white/10" />
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <dt className="font-bold text-gray-400 whitespace-nowrap">대회 평가자산</dt>
            <dd className="font-black text-white whitespace-nowrap">{meta.contestEquity}</dd>
          </div>
          <div className="h-3 w-[1px] shrink-0 bg-white/10" />
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <dt className="font-bold text-gray-400 whitespace-nowrap">대회 가용증거금</dt>
            <dd className="font-black text-gray-200 whitespace-nowrap">{meta.availableMargin}</dd>
          </div>
          <div className="h-3 w-[1px] shrink-0 bg-white/10" />
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <dt className="font-bold text-gray-400 whitespace-nowrap">시즌 수익률</dt>
            <dd
              className={cn(
                "font-black whitespace-nowrap",
                meta.seasonRoi.startsWith("-")
                  ? "text-blue-400"
                  : meta.seasonRoi.startsWith("+")
                    ? "text-emerald-400"
                    : "text-gray-300",
              )}
            >
              {meta.seasonRoi}
            </dd>
          </div>
          <div className="h-3 w-[1px] shrink-0 bg-white/10" />
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <dt className="font-bold text-gray-400 whitespace-nowrap">실시간 순위</dt>
            <dd className="font-black text-amber-300 whitespace-nowrap">{meta.liveRank}</dd>
          </div>
        </dl>

        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-blue-400/30 bg-blue-500/15 px-3 text-[11px] font-black text-blue-300">
          <V1IconTrophy className="h-3.5 w-3.5 shrink-0 text-blue-300" />
          <span>CONTEST MODE</span>
        </span>
      </div>
    </div>
  );
}

export function ContestTradingTerminal({
  seasonId,
}: {
  seasonId: number | string;
}) {
  const meta = resolveContestTerminalMeta(seasonId);

  return (
    <TradingDataProvider key={meta.seasonId} contestSeasonId={meta.seasonId}>
      <a
        href="#contest-trading-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-10 focus:bg-terminal-panel focus:px-4 focus:py-3"
      >
        대회 트레이딩 본문으로 바로가기
      </a>
      <V1Header theme="dark" />
      <ContestTradingSubheader seasonId={meta.seasonId} />
      <main id="contest-trading-main" tabIndex={-1} className="trading-workspace">
        <div className="trading-page-intro">
          <h1 className="sr-only">{meta.title} 전용 선물 모의투자</h1>
          <p id="preview-notice">
            일반 모의투자 지갑과 분리된 시즌 전용 대회 지갑으로 주문을 실행합니다. 대회 종료 시각 도래 시 미체결 주문은 소프트 취소되고 오픈 포지션은 마크가격 스냅샷 기준으로 정산됩니다.
          </p>
        </div>
        <MarketChartPanel>
          <OrderPanel />
        </MarketChartPanel>
      </main>
    </TradingDataProvider>
  );
}
