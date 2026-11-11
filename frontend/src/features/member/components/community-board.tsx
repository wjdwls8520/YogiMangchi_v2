"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { MemberShell } from "./member-views";
import { useMember } from "./member-provider";
import { ContentApiError, contentJson, contentMessage, contentOrigin } from "../api/client";
import { parseProfile } from "../api/contracts";
import {
  COMMUNITY_CATEGORIES,
  SYMBOL_FILTER_TAGS,
  communityCategoryLabel,
  communityCommentsPath,
  communityPostsPath,
  parseCommentLike,
  parseCommunityComment,
  parseCommunityComments,
  parseCommunityLike,
  parseCommunityPost,
  parseCommunityPostPage,
  parseCommunityReport,
  parseLatestPostsCheck,
  parsePublicMemberPortfolio,
  parseReportReasons,
  readCommunityOrPublic,
  type CommunityCategory,
  type CommunityComment,
  type CommunityPost,
  type CommunityPostPage,
  type CommunityReportReason,
  type CommunitySort,
  type SharedPositionSnapshot,
} from "../api/community-news";
import { marketSymbolsJson, tradingJson } from "../../trading/api/client";
import { formatDecimal, parseSummary } from "../../trading/api/account";
import { formatExchangePrice } from "../api/exchange-format";
import { parseSymbols } from "../../trading/market/catalog";
import {
  fetchMyContestSeasons,
  fetchPublicContestLeaderboard,
  fetchPublicContestSeasons,
  formatContestSignedRoi,
  formatContestUsdt,
  groupContestSidebarSeasons,
  resolveTradingContestBaseUrl,
  selectDefaultContestSidebarSeasonId,
  type ContestSidebarTraderProfile,
  type LeaderboardPageResponse,
  type PublicSeasonsOverviewResponse,
} from "../../contest/api/contest-client";
import { DimModal } from "./dim-modal";
import { CommunityImageUploadSlot, type SelectedS3File } from "./s3-upload-slot";
import {
  V1Tabs,
  V1Button,
  V1UserAvatar,
  V1IconPen,
  V1IconChartBar,
  V1IconHeart,
  V1IconComment,
  V1IconCornerDownRight,
  V1IconArrowUp,
  V1IconArrowLeft,
  V1IconCheck,
} from "./v1-ui";

export type { SharedPositionSnapshot };

export const V1_REPORT_REASONS: readonly CommunityReportReason[] = [
  { code: "SPAM", description: "스팸 홍보/도배글입니다." },
  { code: "SEXUAL", description: "음란물입니다." },
  { code: "ILLEGAL", description: "불법정보를 포함하고 있습니다." },
  { code: "YOUTH_HARMFUL", description: "청소년에게 유해한 내용입니다." },
  { code: "ABUSE", description: "욕설/생명경시/혐오/차별적 표현입니다." },
  { code: "PRIVACY", description: "개인정보 노출 게시물입니다." },
  { code: "INAPPROPRIATE", description: "불쾌한 표현이 있습니다." },
  { code: "FRAUD", description: "사기·투자 유도·금전 요구 게시물입니다." },
  { code: "ETC", description: "기타 운영정책 위반 게시물입니다." },
] as const;

const SELECTABLE_CATEGORIES: readonly CommunityCategory[] = [
  "MARKET",
  "ANALYSIS",
  "POSITION",
  "FREE",
];

const SELECTABLE_SYMBOLS = SYMBOL_FILTER_TAGS.filter(
  (s): s is Exclude<(typeof SYMBOL_FILTER_TAGS)[number], ""> => Boolean(s),
);

function formatCommunityTimestamp(value: string): string {
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

function parseScaledBigInt8(value: string | null | undefined): bigint | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const neg = trimmed.startsWith("-");
  const [whole, frac = ""] = trimmed.replace(/^-/, "").split(".");
  const scaled = BigInt(whole) * BigInt(100000000) + BigInt(frac.padEnd(8, "0").slice(0, 8));
  return neg ? -scaled : scaled;
}

function computeRoiPctFromStrings(pnlRaw: string | null | undefined, marginRaw: string): string {
  const pnl = parseScaledBigInt8(pnlRaw);
  const margin = parseScaledBigInt8(marginRaw);
  const zero = BigInt(0);
  if (pnl === null || margin === null || margin <= zero) return "0.00%";
  const neg = pnl < zero;
  const absPnl = neg ? -pnl : pnl;
  const bps = (absPnl * BigInt(10000) + margin / BigInt(2)) / margin;
  const whole = (bps / BigInt(100)).toString();
  const frac = (bps % BigInt(100)).toString().padStart(2, "0");
  if (bps === zero) return "0.00%";
  return `${neg ? "-" : "+"}${whole}.${frac}%`;
}

function formatSnapshotSignedUsdt(raw: string | null | undefined): string {
  if (!raw) return "0.00 USDT";
  const trimmed = raw.trim();
  const formatted = formatDecimal(trimmed.replace(/^\+/, ""));
  if (formatted === "—") return trimmed.endsWith("USDT") ? trimmed : `${trimmed} USDT`;
  if (formatted === "0.00" || formatted === "-0.00") return "0.00 USDT";
  return formatted.startsWith("-") ? `${formatted} USDT` : `+${formatted} USDT`;
}

function formatSnapshotSignedPct(raw: string | null | undefined): string {
  if (!raw) return "0.00%";
  const cleaned = raw.trim().replace(/%$/, "");
  const formatted = formatDecimal(cleaned.replace(/^\+/, ""));
  if (formatted === "—") return raw.endsWith("%") ? raw : `${raw}%`;
  if (formatted === "0.00" || formatted === "-0.00") return "0.00%";
  return formatted.startsWith("-") ? `${formatted}%` : `+${formatted}%`;
}

function formatSnapshotPrice(raw: string | null | undefined, tickSize?: string | null): string {
  if (!raw || raw.trim() === "" || raw.trim() === "-" || raw.trim() === "0") return "-";
  const formatted = formatExchangePrice(raw.trim(), tickSize);
  return formatted === "-" ? "-" : formatted;
}

export const SHAREABLE_POSITIONS: readonly SharedPositionSnapshot[] = [
  {
    id: "POS_BTC_LONG_10X",
    marketLabel: "모의투자 선물",
    symbol: "BTC",
    pair: "BTCUSDT",
    side: "LONG",
    leverage: 10,
    entryPrice: "68,420.00",
    markPrice: "69,680.50",
    liquidationPrice: "61,890.00",
    roePct: "+18.42%",
    pnlUsdt: "+184.20 USDT",
    positive: true,
    showPnlAmount: true,
    verified: true,
  },
  {
    id: "POS_ETH_SHORT_5X",
    marketLabel: "모의투자 선물",
    symbol: "ETH",
    pair: "ETHUSDT",
    side: "SHORT",
    leverage: 5,
    entryPrice: "2,540.00",
    markPrice: "2,485.00",
    liquidationPrice: "3,012.00",
    roePct: "+10.83%",
    pnlUsdt: "+54.15 USDT",
    positive: true,
    showPnlAmount: true,
    verified: true,
  },
  {
    id: "POS_SOL_LONG_20X",
    marketLabel: "시즌 1 대회",
    symbol: "SOL",
    pair: "SOLUSDT",
    side: "LONG",
    leverage: 20,
    entryPrice: "176.20",
    markPrice: "184.50",
    liquidationPrice: "168.10",
    roePct: "+94.21%",
    pnlUsdt: "+471.05 USDT",
    positive: true,
    showPnlAmount: true,
    verified: true,
  },
  {
    id: "POS_XRP_SHORT_10X",
    marketLabel: "모의투자 선물",
    symbol: "XRP",
    pair: "XRPUSDT",
    side: "SHORT",
    leverage: 10,
    entryPrice: "0.5820",
    markPrice: "0.5844",
    liquidationPrice: "0.6380",
    roePct: "-4.15%",
    pnlUsdt: "-20.75 USDT",
    positive: false,
    showPnlAmount: true,
    verified: true,
  },
] as const;

export function resolveDefaultPositionForPost(symbolTag?: string | null): SharedPositionSnapshot {
  if (symbolTag) {
    const matched = SHAREABLE_POSITIONS.find(pos => pos.symbol === symbolTag);
    if (matched) return matched;
  }
  return SHAREABLE_POSITIONS[0];
}

export function SharedPositionCard({
  snapshot,
  showPnlAmount = true,
}: {
  snapshot: SharedPositionSnapshot;
  showPnlAmount?: boolean;
}) {
  const displayPnlAmount =
    snapshot.showPnlAmount !== undefined ? snapshot.showPnlAmount && showPnlAmount : showPnlAmount;
  const isNegative = snapshot.roePct.trim().startsWith("-") || snapshot.pnlUsdt.trim().startsWith("-");
  const hasNonZero = /[1-9]/.test(snapshot.roePct) || /[1-9]/.test(snapshot.pnlUsdt);
  const pnlColorClass = isNegative
    ? "text-[#1763B6]"
    : hasNonZero && snapshot.positive
      ? "text-[#E12343]"
      : "text-gray-600";
  const normalizedEntry = formatSnapshotPrice(snapshot.entryPrice);
  const normalizedMark = formatSnapshotPrice(snapshot.markPrice);
  const normalizedLiq = formatSnapshotPrice(snapshot.liquidationPrice);
  const entryDisplay = normalizedEntry === "-" ? "-" : `${normalizedEntry} USDT`;
  const markDisplay = normalizedMark === "-" ? "-" : `${normalizedMark} USDT`;
  const liqDisplay = normalizedLiq === "-" ? "-" : `${normalizedLiq} USDT`;
  const roeDisplay = formatSnapshotSignedPct(snapshot.roePct);
  const pnlDisplay = formatSnapshotSignedUsdt(snapshot.pnlUsdt.replace(/\s*USDT$/i, ""));
  return (
    <div
      className="mt-3 rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4"
      data-shared-position={snapshot.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 whitespace-nowrap rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-[#0058FF]">
            {snapshot.marketLabel}
          </span>
          <strong className="whitespace-nowrap text-sm font-black text-gray-900">{snapshot.pair} 무기한</strong>
          <span
            className={`shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-black ${
              snapshot.side === "LONG"
                ? "bg-[#2EBD85]/10 text-[#2EBD85]"
                : "bg-[#F6465D]/10 text-[#F6465D]"
            }`}
          >
            {snapshot.side} {snapshot.leverage}x
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-bold text-gray-500">
            <span>원장 스냅샷 검증됨</span>
            <V1IconCheck className="h-3 w-3" />
          </span>
        </div>

        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[11px] font-bold text-gray-400">수익률(ROE)</span>
          <strong className={`text-base font-black ${pnlColorClass}`}>{roeDisplay}</strong>
          {displayPnlAmount && (
            <span className={`text-xs font-bold ${pnlColorClass}`}>({pnlDisplay})</span>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs sm:grid-cols-3">
        <div>
          <span className="block text-[11px] font-bold text-gray-400">진입가</span>
          <strong className="font-bold text-gray-900">{entryDisplay}</strong>
        </div>
        <div>
          <span className="block text-[11px] font-bold text-gray-400">공유 시점 현재가</span>
          <strong className="font-bold text-gray-900">{markDisplay}</strong>
        </div>
        <div>
          <span className="block text-[11px] font-bold text-gray-400">청산예정가</span>
          <strong className="font-bold text-amber-600">{liqDisplay}</strong>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-gray-400">
        <span>실제 자금을 사용하지 않는 모의투자 포지션 공유 스냅샷입니다.</span>
        <Link href="/trading" className="font-bold text-[#0058FF] hover:underline">
          {snapshot.pair} 모의투자 하러가기 →
        </Link>
      </div>
    </div>
  );
}

function AuthorLabel({
  memberId,
  nickname,
  withdrawn,
}: {
  memberId: number | null;
  nickname: string;
  withdrawn: boolean;
}) {
  if (withdrawn || memberId === null) {
    return (
      <span className="member-note" data-withdrawn="true">
        탈퇴한회원
      </span>
    );
  }
  return <Link href={`/members/${memberId}`}>{nickname}</Link>;
}

export function CommunityBoard({
  initialPage,
  initialComments,
  initialV1Tab = "all",
  initialCategory = "",
  highlightPostId,
  initialPendingNewPostsCount = 0,
  initialContestSeasons = null,
  initialContestLeaderboard = null,
  initialContestProfiles,
}: {
  initialPage?: CommunityPostPage;
  initialComments?: Record<number, CommunityComment[]>;
  initialV1Tab?: "all" | "best" | "latest";
  initialCategory?: "" | CommunityCategory;
  highlightPostId?: number;
  initialPendingNewPostsCount?: number;
  initialContestSeasons?: PublicSeasonsOverviewResponse | null;
  initialContestLeaderboard?: LeaderboardPageResponse | null;
  initialContestProfiles?: Record<number, ContestSidebarTraderProfile>;
} = {}) {
  const { origin, session, snapshot } = useMember();
  const queryClient = useQueryClient();

  const [v1Tab, setV1Tab] = useState<"all" | "best" | "latest">(initialV1Tab);
  const [sort, setSort] = useState<CommunitySort>(initialV1Tab === "best" ? "POPULAR" : "LATEST");
  const [category, setCategory] = useState<"" | CommunityCategory>(initialCategory);
  const [symbolTag, setSymbolTag] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [extraPosts, setExtraPosts] = useState<CommunityPost[]>([]);
  const [nextCursorOverride, setNextCursorOverride] = useState<number | null | undefined>(
    undefined,
  );
  const [hasNextOverride, setHasNextOverride] = useState<boolean | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const isDetailView = typeof highlightPostId === "number" && Number.isFinite(highlightPostId);
  const [editingPost, setEditingPost] = useState<CommunityPost | null>(null);
  const [editDeleteFileIds, setEditDeleteFileIds] = useState<number[]>([]);
  const [editNewImages, setEditNewImages] = useState<SelectedS3File[]>([]);
  const [editDetachSharedPosition, setEditDetachSharedPosition] = useState(false);

  const [editingComment, setEditingComment] = useState<CommunityComment | null>(null);
  const [replyParentId, setReplyParentId] = useState<number | null>(null);
  const [replyTargetCommentId, setReplyTargetCommentId] = useState<number | null>(null);
  const [replyTargetMemberId, setReplyTargetMemberId] = useState<number | null>(null);
  const [replyTargetNickname, setReplyTargetNickname] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [extraComments, setExtraComments] = useState<CommunityComment[]>([]);
  const [commentsNextCursorOverride, setCommentsNextCursorOverride] = useState<
    number | null | undefined
  >(undefined);
  const [commentsHasNextOverride, setCommentsHasNextOverride] = useState<boolean | undefined>(
    undefined,
  );
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const commentSentinelRef = useRef<HTMLDivElement>(null);

  const likingPostIdsRef = useRef<Set<number>>(new Set());
  const likingCommentIdsRef = useRef<Set<number>>(new Set());
  const isLoggedIn = snapshot.phase === "ready";

  const tradingBase = resolveTradingContestBaseUrl();
  const [writeModalOpen, setWriteModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    type: "POST" | "REPLY";
    id: number;
    postId?: number;
    title: string;
  } | null>(null);
  const [selectedReasonCode, setSelectedReasonCode] = useState<string>(V1_REPORT_REASONS[0].code);
  const [selectedReportReason, setSelectedReportReason] = useState<string>(
    V1_REPORT_REASONS[0].description,
  );
  const [modalImages, setModalImages] = useState<SelectedS3File[]>([]);
  const [contestSeason, setContestSeason] = useState("");
  const shareUrlHandledRef = useRef(false);

  // 모달 글쓰기 포지션 공유 상태
  const [modalCategory, setModalCategory] = useState<CommunityCategory>("FREE");
  const [modalSymbolTag, setModalSymbolTag] = useState<string>("");
  const [modalPositionId, setModalPositionId] = useState<string>("");
  const [modalShowPnlAmount, setModalShowPnlAmount] = useState<boolean>(true);

  function closeAndResetWriteModal() {
    setWriteModalOpen(false);
    setModalPositionId("");
    setModalCategory("FREE");
    setModalSymbolTag("");
    setModalShowPnlAmount(true);
    setModalImages([]);
  }

  // 로그인 회원의 실제 오픈 포지션 조회 (모의투자 선물 + 진행 중 시즌 대회)
  const shareablePositionsQuery = useQuery({
    queryKey: ["community-shareable-positions", tradingBase, snapshot.memberId, snapshot.generation],
    enabled: isLoggedIn && Boolean(snapshot.memberId),
    staleTime: 5_000,
    queryFn: async ({ signal }) => {
      const results: SharedPositionSnapshot[] = [];
      try {
        const portfolio = parsePublicMemberPortfolio(
          await tradingJson(tradingBase, `portfolios/members/${snapshot.memberId}`, { signal }),
        );
        if (portfolio.accountExists) {
          for (const pos of portfolio.positions) {
            const sym = pos.symbol.toUpperCase().replace(/USDT$/i, "");
            const pair = pos.symbol.toUpperCase().endsWith("USDT")
              ? pos.symbol.toUpperCase()
              : `${sym}USDT`;
            const roePct = formatSnapshotSignedPct(pos.roePct);
            const pnlUsdt = formatSnapshotSignedUsdt(pos.unrealizedPnl);
            results.push({
              id: `MOCK_POS_${pos.id}`,
              marketLabel: "모의투자 선물",
              symbol: sym,
              pair,
              side: pos.side,
              leverage: pos.leverage,
              entryPrice: formatSnapshotPrice(pos.entryPrice),
              markPrice: formatSnapshotPrice(pos.markPrice),
              liquidationPrice: formatSnapshotPrice(pos.liquidationPrice),
              roePct,
              pnlUsdt,
              positive: !roePct.startsWith("-") && !pnlUsdt.startsWith("-"),
              showPnlAmount: true,
              verified: true,
            });
          }
        }
      } catch {
        // Ignore mock portfolio lookup failure so contest positions still load
      }

      try {
        const myContest = await session.authorized(cred =>
          fetchMyContestSeasons(cred.accessToken, { baseUrl: tradingBase, signal }),
        );
        const liveSeasons = myContest.participatingSeasons.filter(
          item => item.displayStatus === "LIVE",
        );
        if (liveSeasons.length > 0) {
          const symbols = parseSymbols(await marketSymbolsJson(tradingBase, signal));
          for (const season of liveSeasons) {
            try {
              const rawSummary = (await session.authorized(cred =>
                tradingJson(
                  tradingBase,
                  `contest/seasons/${season.seasonId}/account/summary`,
                  { token: cred.accessToken, signal },
                ),
              )) as Record<string, unknown>;
              const accId =
                typeof rawSummary.accountId === "number" ? rawSummary.accountId : null;
              if (accId === null) continue;
              const summary = parseSummary(rawSummary, accId);
              for (const pos of summary.positions) {
                const matchedSym = symbols.find(s => s.id === pos.tradingSymbolId);
                const rawSym = matchedSym?.symbol?.toUpperCase().replace(/USDT$/i, "");
                const sym = rawSym || `SYM${pos.tradingSymbolId}`;
                const pair = `${sym}USDT`;
                const roePct = computeRoiPctFromStrings(pos.unrealizedPnl, pos.margin);
                const pnlUsdt = formatSnapshotSignedUsdt(pos.unrealizedPnl);
                results.push({
                  id: `CONTEST_${season.seasonId}_POS_${pos.id}`,
                  marketLabel: season.title.slice(0, 48),
                  symbol: sym,
                  pair,
                  side: pos.side === "SHORT" ? "SHORT" : "LONG",
                  leverage: pos.leverage,
                  entryPrice: formatSnapshotPrice(pos.entryPrice, matchedSym?.priceTickSize),
                  markPrice: formatSnapshotPrice(pos.markPrice, matchedSym?.priceTickSize),
                  liquidationPrice: formatSnapshotPrice(pos.liquidationPrice, matchedSym?.priceTickSize),
                  roePct,
                  pnlUsdt,
                  positive: !roePct.startsWith("-") && !pnlUsdt.startsWith("-"),
                  showPnlAmount: true,
                  verified: true,
                });
              }
            } catch {
              // Skip individual season error
            }
          }
        }
      } catch {
        // Ignore contest lookup failure
      }
      return results;
    },
  });

  const liveShareablePositions = useMemo(() => shareablePositionsQuery.data ?? [], [shareablePositionsQuery.data]);

  // URL ?sharePosition=BTC 파라미터 진입 처리 (Hydration 안전 useEffect)
  useEffect(() => {
    if (typeof window === "undefined" || shareUrlHandledRef.current || !isLoggedIn) return;
    if (!shareablePositionsQuery.isSuccess) return;
    const params = new URLSearchParams(window.location.search);
    const shareSym = params.get("sharePosition")?.trim().toUpperCase();
    if (!shareSym) return;
    shareUrlHandledRef.current = true;
    const matched =
      liveShareablePositions.find(
        pos => pos.symbol === shareSym || pos.pair === shareSym || pos.id === shareSym,
      ) ?? liveShareablePositions[0];
    params.delete("sharePosition");
    const nextSearch = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`,
    );
    const timer = window.setTimeout(() => {
      setModalCategory("POSITION");
      if (matched) {
        setModalPositionId(matched.id);
        setModalSymbolTag(matched.symbol);
      } else if (SELECTABLE_SYMBOLS.includes(shareSym as (typeof SELECTABLE_SYMBOLS)[number])) {
        setModalSymbolTag(shareSym);
      }
      setWriteModalOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isLoggedIn, liveShareablePositions, shareablePositionsQuery.isSuccess]);

  // 우측 사이드바 실시간 대회투자 TOP5 조회 (Redis 리더보드 폴링 연동)
  const sidebarContestSeasonsQuery = useQuery({
    queryKey: ["community-sidebar-contest-seasons", tradingBase],
    initialData: initialContestSeasons ?? undefined,
    staleTime: 5_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => fetchPublicContestSeasons({ baseUrl: tradingBase, signal }),
  });

  const sidebarSeasonGroups = useMemo(
    () => groupContestSidebarSeasons(sidebarContestSeasonsQuery.data),
    [sidebarContestSeasonsQuery.data],
  );
  const sidebarSeasons = sidebarSeasonGroups.all;

  const initialLeaderboardSeasonId = initialContestLeaderboard?.season?.id ?? null;
  const activeSidebarSeasonId = useMemo(() => {
    const num = Number(contestSeason);
    if (contestSeason !== "" && Number.isFinite(num) && sidebarSeasons.some(s => s.id === num)) {
      return num;
    }
    if (
      contestSeason === "" &&
      initialLeaderboardSeasonId !== null &&
      sidebarSeasons.some(s => s.id === initialLeaderboardSeasonId)
    ) {
      return initialLeaderboardSeasonId;
    }
    return selectDefaultContestSidebarSeasonId(sidebarContestSeasonsQuery.data);
  }, [
    contestSeason,
    initialLeaderboardSeasonId,
    sidebarContestSeasonsQuery.data,
    sidebarSeasons,
  ]);

  const activeSidebarSeason = useMemo(
    () => sidebarSeasons.find(s => s.id === activeSidebarSeasonId) ?? null,
    [activeSidebarSeasonId, sidebarSeasons],
  );

  const sidebarLeaderboardQuery = useQuery({
    queryKey: ["community-sidebar-contest-top5", tradingBase, activeSidebarSeasonId],
    enabled: activeSidebarSeasonId !== null,
    initialData:
      activeSidebarSeasonId !== null &&
      initialContestLeaderboard?.season?.id === activeSidebarSeasonId
        ? initialContestLeaderboard
        : undefined,
    placeholderData: prev =>
      prev && prev.season.id === activeSidebarSeasonId ? prev : undefined,
    staleTime: 2_000,
    refetchInterval: activeSidebarSeason?.displayStatus === "FINISHED" ? 30_000 : 3_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) =>
      fetchPublicContestLeaderboard(activeSidebarSeasonId!, {
        baseUrl: tradingBase,
        size: 5,
        signal,
      }),
  });

  const top5MemberIds = useMemo(() => {
    const ids = (sidebarLeaderboardQuery.data?.items ?? [])
      .slice(0, 5)
      .map(item => item.memberId);
    return Array.from(new Set(ids));
  }, [sidebarLeaderboardQuery.data]);

  const top5ProfileQueries = useQueries({
    queries: top5MemberIds.map(memberId => ({
      queryKey: ["contest-sidebar-member-profile", origin, memberId] as const,
      initialData: initialContestProfiles?.[memberId],
      staleTime: 60_000,
      retry: false,
      queryFn: async ({ signal }): Promise<ContestSidebarTraderProfile> => {
        try {
          const parsed = parseProfile(
            await contentJson(origin, `/members/${memberId}`, { signal }),
          );
          return {
            memberId,
            nickname: parsed.nickname,
            profileImgUrl: parsed.profileImgUrl ?? null,
            withdrawn: false,
          };
        } catch (err) {
          if (err instanceof ContentApiError && err.status === 404) {
            return {
              memberId,
              nickname: "탈퇴한회원",
              profileImgUrl: null,
              withdrawn: true,
            };
          }
          throw err;
        }
      },
    })),
  });

  const top5ProfilesByMemberId = useMemo(() => {
    const map = new Map<number, ContestSidebarTraderProfile>();
    if (initialContestProfiles) {
      for (const [key, val] of Object.entries(initialContestProfiles)) {
        map.set(Number(key), val);
      }
    }
    for (const q of top5ProfileQueries) {
      if (q.data) {
        map.set(q.data.memberId, q.data);
      }
    }
    return map;
  }, [initialContestProfiles, top5ProfileQueries]);

  const [sharedPositionsByPostId, setSharedPositionsByPostId] = useState<
    Record<number, { snapshot: SharedPositionSnapshot; showPnlAmount: boolean }>
  >({});

  // 인스타그램 스타일 실시간 '새 게시글 보기' 플로팅 알약 팝업 상태
  const feedTopRef = useRef<HTMLDivElement>(null);
  const [pendingNewPostsCount, setPendingNewPostsCount] = useState<number>(
    initialPendingNewPostsCount,
  );
  const [prependedPosts, setPrependedPosts] = useState<CommunityPost[]>([]);
  const [latestCheckedItems, setLatestCheckedItems] = useState<CommunityPost[]>([]);
  const latestPostIdRef = useRef<number>(0);
  const myCreatedPostIdsRef = useRef<Set<number>>(new Set());

  const path = communityPostsPath({
    category,
    sort,
    symbolTag: symbolTag || undefined,
    keyword,
    cursorId: null,
    size: 10,
  });

  const isDefaultQuery =
    category === "" && sort === "LATEST" && symbolTag === "" && keyword === "";

  const postsQuery = useQuery({
    queryKey: ["community-posts", origin, path, snapshot.generation],
    queryFn: async () =>
      parseCommunityPostPage(await readCommunityOrPublic(origin, session, snapshot, path)),
    initialData: isDefaultQuery ? initialPage : undefined,
  });

  const initialDetailPost =
    isDetailView && initialPage
      ? initialPage.items.find(item => item.id === highlightPostId)
      : undefined;

  const detailPostQuery = useQuery({
    queryKey: ["community-post-detail", origin, highlightPostId, snapshot.generation],
    enabled: isDetailView,
    queryFn: async () =>
      parseCommunityPost(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          `/community/posts/${highlightPostId!}`,
        ),
      ),
    initialData: initialDetailPost,
  });

  const activePostId = isDetailView ? highlightPostId : null;
  const commentsQuery = useQuery({
    queryKey: ["community-comments", origin, activePostId, snapshot.generation],
    enabled: activePostId !== null,
    queryFn: async () =>
      parseCommunityComments(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          communityCommentsPath(activePostId!, null, 20),
        ),
      ),
    initialData:
      activePostId !== null && initialComments?.[activePostId]
        ? {
            items: initialComments[activePostId],
            hasNext: false,
            nextCursorId: null,
          }
        : undefined,
  });

  const reportReasonsQuery = useQuery({
    queryKey: ["community-report-reasons", origin],
    enabled: reportTarget !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      parseReportReasons(await contentJson(origin, "/community/report-reasons")),
  });

  const reportReasons =
    reportReasonsQuery.data && reportReasonsQuery.data.length > 0
      ? reportReasonsQuery.data
      : V1_REPORT_REASONS;

  function requireReadyMember(): boolean {
    if (snapshot.phase !== "ready") {
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert("로그인 이후 사용할 수 있습니다.");
      }
      setFeedback("로그인 이후 사용할 수 있습니다.");
      return false;
    }
    return true;
  }

  const createPostMutation = useMutation({
    mutationFn: async (payload: {
      category: CommunityCategory;
      symbolTag: string | null;
      title: string;
      content: string;
      sharedPosition?: SharedPositionSnapshot | null;
      files?: SelectedS3File[];
    }) => {
      const rawFiles = (payload.files ?? []).filter(
        (item): item is SelectedS3File & { rawFile: File } => Boolean(item.rawFile),
      );
      if (rawFiles.length > 0) {
        const formData = new FormData();
        formData.append("category", payload.category);
        if (payload.symbolTag) formData.append("symbolTag", payload.symbolTag);
        formData.append("title", payload.title);
        formData.append("content", payload.content);
        if (payload.sharedPosition) {
          formData.append("sharedPosition", JSON.stringify(payload.sharedPosition));
        }
        for (const item of rawFiles) {
          formData.append("files", item.rawFile);
        }
        return parseCommunityPost(
          await session.request("/community/posts", { method: "POST", body: formData }),
        );
      }
      return parseCommunityPost(
        await session.request("/community/posts", {
          method: "POST",
          body: {
            category: payload.category,
            symbolTag: payload.symbolTag,
            title: payload.title,
            content: payload.content,
            ...(payload.sharedPosition ? { sharedPosition: payload.sharedPosition } : {}),
          },
        }),
      );
    },
    onSuccess: created => {
      myCreatedPostIdsRef.current.add(created.id);
      setFeedback("게시글이 등록되었습니다.");
      setWriteModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
      void queryClient.invalidateQueries({ queryKey: ["community-post-detail", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const updatePostMutation = useMutation({
    mutationFn: async (payload: {
      postId: number;
      category: CommunityCategory;
      symbolTag: string;
      title: string;
      content: string;
      sharedPosition?: SharedPositionSnapshot | null;
      clearSharedPosition?: boolean;
      deleteFileIds?: number[];
      files?: SelectedS3File[];
    }) => {
      const rawFiles = (payload.files ?? []).filter(
        (item): item is SelectedS3File & { rawFile: File } => Boolean(item.rawFile),
      );
      if (rawFiles.length > 0) {
        const formData = new FormData();
        formData.append("category", payload.category);
        formData.append("symbolTag", payload.symbolTag);
        formData.append("title", payload.title);
        formData.append("content", payload.content);
        if (payload.clearSharedPosition) {
          formData.append("clearSharedPosition", "true");
        } else if (payload.sharedPosition) {
          formData.append("sharedPosition", JSON.stringify(payload.sharedPosition));
        }
        for (const fileId of payload.deleteFileIds ?? []) {
          formData.append("deleteFileIds", String(fileId));
        }
        for (const item of rawFiles) {
          formData.append("files", item.rawFile);
        }
        return parseCommunityPost(
          await session.request(`/community/posts/${payload.postId}`, {
            method: "PATCH",
            body: formData,
          }),
        );
      }
      return parseCommunityPost(
        await session.request(`/community/posts/${payload.postId}`, {
          method: "PATCH",
          body: {
            category: payload.category,
            symbolTag: payload.symbolTag,
            title: payload.title,
            content: payload.content,
            ...(payload.clearSharedPosition
              ? { clearSharedPosition: true }
              : payload.sharedPosition !== undefined
                ? { sharedPosition: payload.sharedPosition }
                : {}),
            ...(payload.deleteFileIds && payload.deleteFileIds.length > 0
              ? { deleteFileIds: payload.deleteFileIds }
              : {}),
          },
        }),
      );
    },
    onSuccess: (_updated, variables) => {
      if (variables.clearSharedPosition) {
        setSharedPositionsByPostId(prev => {
          const next = { ...prev };
          delete next[variables.postId];
          return next;
        });
      }
      setEditingPost(null);
      setEditDeleteFileIds([]);
      setEditNewImages([]);
      setEditDetachSharedPosition(false);
      setFeedback("게시글이 수정되었습니다.");
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
      void queryClient.invalidateQueries({ queryKey: ["community-post-detail", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const deletePostMutation = useMutation({
    mutationFn: async (postId: number) =>
      session.request(`/community/posts/${postId}`, { method: "DELETE" }),
    onSuccess: (_data, postId) => {
      setPrependedPosts(prev => prev.filter(p => p.id !== postId));
      setExtraPosts(prev => prev.filter(p => p.id !== postId));
      setFeedback("게시글이 삭제되었습니다.");
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
      void queryClient.invalidateQueries({ queryKey: ["community-post-detail", origin] });
      if (isDetailView && typeof window !== "undefined") {
        window.location.href = new URL(`/community/${v1Tab}`, window.location.origin).href;
      }
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const likeMutation = useMutation({
    mutationFn: async (post: CommunityPost) => {
      likingPostIdsRef.current.add(post.id);
      return parseCommunityLike(
        await session.request(`/community/posts/${post.id}/likes`, {
          method: post.likedByMe ? "DELETE" : "PUT",
        }),
      );
    },
    onSuccess: result => {
      setLatestCheckedItems(prev =>
        prev.map(p =>
          p.id === result.postId
            ? { ...p, likeCount: result.likeCount, likedByMe: result.likedByMe }
            : p,
        ),
      );
      setPrependedPosts(prev =>
        prev.map(p =>
          p.id === result.postId
            ? { ...p, likeCount: result.likeCount, likedByMe: result.likedByMe }
            : p,
        ),
      );
      setExtraPosts(prev =>
        prev.map(p =>
          p.id === result.postId
            ? { ...p, likeCount: result.likeCount, likedByMe: result.likedByMe }
            : p,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
      void queryClient.invalidateQueries({ queryKey: ["community-post-detail", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
    onSettled: (_data, _error, post) => {
      likingPostIdsRef.current.delete(post.id);
    },
  });

  const commentLikeMutation = useMutation({
    mutationFn: async (payload: { postId: number; comment: CommunityComment }) => {
      likingCommentIdsRef.current.add(payload.comment.id);
      return parseCommentLike(
        await session.request(`/community/comments/${payload.comment.id}/likes`, {
          method: payload.comment.likedByMe ? "DELETE" : "PUT",
        }),
      );
    },
    onSuccess: (result, variables) => {
      setExtraComments(prev =>
        prev.map(c =>
          c.id === result.commentId
            ? { ...c, likeCount: result.likeCount, likedByMe: result.likedByMe }
            : c,
        ),
      );
      void queryClient.invalidateQueries({
        queryKey: ["community-comments", origin, variables.postId],
      });
    },
    onError: error => setFeedback(contentMessage(error)),
    onSettled: (_data, _error, variables) => {
      likingCommentIdsRef.current.delete(variables.comment.id);
    },
  });

  const reportMutation = useMutation({
    mutationFn: async (payload: {
      type: "POST" | "REPLY";
      id: number;
      postId?: number;
      reasonType: string;
      reason: string;
    }) => {
      const endpoint =
        payload.type === "POST"
          ? `/community/posts/${payload.id}/reports`
          : `/community/comments/${payload.id}/reports`;
      return parseCommunityReport(
        await session.request(endpoint, {
          method: "PUT",
          body: { reasonType: payload.reasonType, reason: payload.reason },
        }),
      );
    },
    onSuccess: (_data, variables) => {
      setFeedback(
        `신고가 접수되었습니다 (${variables.type === "POST" ? "게시글" : "댓글"} #${variables.id}: ${variables.reason})`,
      );
      setReportTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
      void queryClient.invalidateQueries({ queryKey: ["community-post-detail", origin] });
      if (variables.postId) {
        void queryClient.invalidateQueries({
          queryKey: ["community-comments", origin, variables.postId],
        });
      } else if (activePostId !== null) {
        void queryClient.invalidateQueries({
          queryKey: ["community-comments", origin, activePostId],
        });
      }
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const cancelReportMutation = useMutation({
    mutationFn: async (payload: { type: "POST" | "REPLY"; id: number; postId?: number }) => {
      const endpoint =
        payload.type === "POST"
          ? `/community/posts/${payload.id}/reports`
          : `/community/comments/${payload.id}/reports`;
      return parseCommunityReport(
        await session.request(endpoint, { method: "DELETE" }),
      );
    },
    onSuccess: (_data, variables) => {
      setFeedback(
        `${variables.type === "POST" ? "게시글" : "댓글"} #${variables.id} 신고가 취소되었습니다.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
      void queryClient.invalidateQueries({ queryKey: ["community-post-detail", origin] });
      if (variables.postId) {
        void queryClient.invalidateQueries({
          queryKey: ["community-comments", origin, variables.postId],
        });
      } else if (activePostId !== null) {
        void queryClient.invalidateQueries({
          queryKey: ["community-comments", origin, activePostId],
        });
      }
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const createCommentMutation = useMutation({
    mutationFn: async (payload: {
      postId: number;
      parentCommentId: number | null;
      targetCommentId?: number | null;
      targetMemberId?: number | null;
      content: string;
    }) =>
      parseCommunityComment(
        await session.request(`/community/posts/${payload.postId}/comments`, {
          method: "POST",
          body: {
            parentCommentId: payload.parentCommentId,
            ...(payload.targetCommentId ? { targetCommentId: payload.targetCommentId } : {}),
            ...(payload.targetMemberId ? { targetMemberId: payload.targetMemberId } : {}),
            content: payload.content,
          },
        }),
      ),
    onSuccess: (_data, variables) => {
      setReplyParentId(null);
      setReplyTargetCommentId(null);
      setReplyTargetMemberId(null);
      setReplyTargetNickname(null);
      setFeedback("댓글이 등록되었습니다.");
      void queryClient.invalidateQueries({
        queryKey: ["community-comments", origin, variables.postId],
      });
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
      void queryClient.invalidateQueries({ queryKey: ["community-post-detail", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const updateCommentMutation = useMutation({
    mutationFn: async (payload: { postId: number; commentId: number; content: string }) =>
      parseCommunityComment(
        await session.request(
          `/community/posts/${payload.postId}/comments/${payload.commentId}`,
          {
            method: "PATCH",
            body: { content: payload.content },
          },
        ),
      ),
    onSuccess: (_data, variables) => {
      setEditingComment(null);
      setFeedback("댓글이 수정되었습니다.");
      void queryClient.invalidateQueries({
        queryKey: ["community-comments", origin, variables.postId],
      });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (payload: { postId: number; commentId: number }) =>
      session.request(`/community/posts/${payload.postId}/comments/${payload.commentId}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, variables) => {
      setFeedback("댓글이 삭제되었습니다.");
      void queryClient.invalidateQueries({
        queryKey: ["community-comments", origin, variables.postId],
      });
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
      void queryClient.invalidateQueries({ queryKey: ["community-post-detail", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  function resetFeedPagination() {
    setExtraPosts([]);
    setNextCursorOverride(undefined);
    setHasNextOverride(undefined);
  }

  function handleV1TabChange(nextValue: string) {
    const nextTab = (nextValue as "all" | "best" | "latest") || "all";
    setV1Tab(nextTab);
    if (nextTab === "best") {
      setSort("POPULAR");
    } else {
      setSort("LATEST");
    }
    resetFeedPagination();
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedPagination();
    setKeyword(searchInput.trim());
  }

  function handleCreatePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requireReadyMember()) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const sharedPositionId = String(data.get("sharedPositionId") ?? "");
    const showPnlAmount = data.get("showPnlAmount") !== null;
    const matchedPosition =
      liveShareablePositions.find(pos => pos.id === sharedPositionId) ?? null;
    const postCategory = (
      matchedPosition
        ? "POSITION"
        : String(data.get("category") ?? "FREE")
    ) as CommunityCategory;
    const rawSymbol = matchedPosition
      ? matchedPosition.symbol
      : String(data.get("symbolTag") ?? "");
    const title = String(data.get("title") ?? "").trim();
    const content = String(data.get("content") ?? "").trim();
    if (!title || !content) return;

    const sharedPositionPayload: SharedPositionSnapshot | null = matchedPosition
      ? {
          ...matchedPosition,
          showPnlAmount,
          verified: true,
        }
      : null;

    createPostMutation.mutate(
      {
        category: postCategory,
        symbolTag: rawSymbol ? rawSymbol : null,
        title,
        content,
        sharedPosition: sharedPositionPayload,
        files: modalImages,
      },
      {
        onSuccess: created => {
          if (matchedPosition) {
            setSharedPositionsByPostId(prev => ({
              ...prev,
              [created.id]: {
                snapshot: matchedPosition,
                showPnlAmount,
              },
            }));
          }
          closeAndResetWriteModal();
          form.reset();
        },
      },
    );
  }

  function handleUpdatePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPost || !requireReadyMember()) return;
    const data = new FormData(event.currentTarget);
    const postCategory = String(data.get("category") ?? editingPost.category) as CommunityCategory;
    const rawSymbol = String(data.get("symbolTag") ?? "").trim();
    const title = String(data.get("title") ?? "").trim();
    const content = String(data.get("content") ?? "").trim();
    if (!title || !content) return;
    updatePostMutation.mutate({
      postId: editingPost.id,
      category: postCategory,
      symbolTag: rawSymbol,
      title,
      content,
      sharedPosition: editDetachSharedPosition ? null : editingPost.sharedPosition,
      clearSharedPosition: editDetachSharedPosition,
      deleteFileIds: editDeleteFileIds,
      files: editNewImages,
    });
  }

  function handleCreateComment(postId: number, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requireReadyMember()) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const content = String(data.get("content") ?? "").trim();
    if (!content) return;
    createCommentMutation.mutate(
      {
        postId,
        parentCommentId: replyParentId,
        targetCommentId: replyTargetCommentId,
        targetMemberId: replyTargetMemberId,
        content,
      },
      { onSuccess: () => form.reset() },
    );
  }

  function handleReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportTarget || !requireReadyMember()) return;
    reportMutation.mutate({
      type: reportTarget.type,
      id: reportTarget.id,
      postId: reportTarget.postId,
      reasonType: selectedReasonCode,
      reason: selectedReportReason,
    });
  }

  const page = postsQuery.data;
  const serverItems = page?.items ?? [];
  const items = (() => {
    const seen = new Set<number>();
    const merged: CommunityPost[] = [];
    for (const item of [...prependedPosts, ...serverItems, ...extraPosts]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  })();

  const hasNext = hasNextOverride ?? page?.hasNext ?? false;
  const nextCursorId =
    nextCursorOverride !== undefined ? nextCursorOverride : (page?.nextCursorId ?? null);

  async function loadMorePosts() {
    if (isDetailView || !hasNext || nextCursorId === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const nextPath = communityPostsPath({
        category,
        sort,
        symbolTag: symbolTag || undefined,
        keyword,
        cursorId: nextCursorId,
        size: 10,
      });
      const nextPage = parseCommunityPostPage(
        await readCommunityOrPublic(origin, session, snapshot, nextPath),
      );
      setExtraPosts(prev => {
        const existingIds = new Set(
          [...prependedPosts, ...serverItems, ...prev].map(post => post.id),
        );
        const fresh = nextPage.items.filter(item => !existingIds.has(item.id));
        return [...prev, ...fresh];
      });
      setNextCursorOverride(nextPage.nextCursorId);
      setHasNextOverride(nextPage.hasNext);
    } catch (error) {
      setFeedback(contentMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || isDetailView || !hasNext || nextCursorId === null) return;
    const node = loadMoreSentinelRef.current;
    if (!node || typeof window.IntersectionObserver !== "function") return;
    const observer = new window.IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          void loadMorePosts();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  });

  const highestPostId = items.reduce((max, item) => (item.id > max ? item.id : max), 0);
  useEffect(() => {
    latestPostIdRef.current = highestPostId;
  }, [highestPostId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let es: EventSource | null = null;
    if (typeof window.EventSource === "function") {
      try {
        es = new window.EventSource(`${contentOrigin(origin)}/api/v1/community/ux/subscribe/feed`);
        const onPostCreated = (event: MessageEvent) => {
          try {
            const payload = JSON.parse(String(event.data ?? "{}")) as {
              postId?: number;
              authorId?: number;
              category?: string;
              symbolTag?: string | null;
              post?: unknown;
            };
            if (payload.postId && myCreatedPostIdsRef.current.has(payload.postId)) return;
            if (category && payload.category && payload.category !== category) return;
            if (symbolTag && payload.symbolTag !== symbolTag) return;
            if (payload.post) {
              try {
                const parsed = parseCommunityPost(payload.post);
                setLatestCheckedItems(prev =>
                  prev.some(item => item.id === parsed.id) ? prev : [parsed, ...prev],
                );
              } catch {
                // Ignore malformed SSE post snapshot
              }
            }
            setPendingNewPostsCount(prev => prev + 1);
          } catch {
            setPendingNewPostsCount(prev => prev + 1);
          }
        };
        es.addEventListener("UX_COMMUNITY_POST_CREATED", onPostCreated as EventListener);
      } catch {
        es = null;
      }
    }

    const timer = window.setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      const sinceId = latestPostIdRef.current;
      if (sinceId <= 0) return;
      try {
        const search = new URLSearchParams({ sincePostId: String(sinceId) });
        if (category) search.set("category", category);
        if (symbolTag) search.set("symbolTag", symbolTag);
        const checked = parseLatestPostsCheck(
          await readCommunityOrPublic(
            origin,
            session,
            snapshot,
            `/community/posts/latest-check?${search.toString()}`,
          ),
        );
        if (checked.newPostCount > 0) {
          setPendingNewPostsCount(checked.newPostCount);
          setLatestCheckedItems(checked.items);
        }
      } catch {
        // Ignore background latest-check errors and keep SSE / manual refresh working.
      }
    }, 30_000);

    return () => {
      if (es) es.close();
      window.clearInterval(timer);
    };
  }, [origin, session, snapshot, category, symbolTag]);

  async function handleLoadNewPosts() {
    if (latestCheckedItems.length > 0) {
      setPrependedPosts(prev => {
        const existingIds = new Set([...prev, ...serverItems, ...extraPosts].map(p => p.id));
        const fresh = latestCheckedItems.filter(item => !existingIds.has(item.id));
        return [...fresh, ...prev];
      });
      setLatestCheckedItems([]);
    } else if (latestPostIdRef.current > 0) {
      try {
        const search = new URLSearchParams({ sincePostId: String(latestPostIdRef.current) });
        if (category) search.set("category", category);
        if (symbolTag) search.set("symbolTag", symbolTag);
        const checked = parseLatestPostsCheck(
          await readCommunityOrPublic(
            origin,
            session,
            snapshot,
            `/community/posts/latest-check?${search.toString()}`,
          ),
        );
        if (checked.items.length > 0) {
          setPrependedPosts(prev => {
            const existingIds = new Set([...prev, ...serverItems, ...extraPosts].map(p => p.id));
            const fresh = checked.items.filter(item => !existingIds.has(item.id));
            return [...fresh, ...prev];
          });
        }
      } catch {
        // Fallback to postsQuery.refetch() below
      }
    }
    setPendingNewPostsCount(0);
    void postsQuery.refetch();
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    feedTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const commentPage = commentsQuery.data;
  const serverComments = commentPage?.items ?? [];
  const comments = (() => {
    const seen = new Set<number>();
    const merged: CommunityComment[] = [];
    for (const item of [...serverComments, ...extraComments]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  })();
  const commentsHasNext = commentsHasNextOverride ?? commentPage?.hasNext ?? false;
  const commentsNextCursorId =
    commentsNextCursorOverride !== undefined
      ? commentsNextCursorOverride
      : (commentPage?.nextCursorId ?? null);

  async function loadMoreComments() {
    if (
      activePostId === null ||
      !commentsHasNext ||
      commentsNextCursorId === null ||
      loadingMoreComments
    ) {
      return;
    }
    setLoadingMoreComments(true);
    try {
      const nextList = parseCommunityComments(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          communityCommentsPath(activePostId, commentsNextCursorId, 20),
        ),
      );
      setExtraComments(prev => {
        const existingIds = new Set([...serverComments, ...prev].map(c => c.id));
        const fresh = nextList.items.filter(item => !existingIds.has(item.id));
        return [...prev, ...fresh];
      });
      setCommentsNextCursorOverride(nextList.nextCursorId);
      setCommentsHasNextOverride(nextList.hasNext);
    } catch (error) {
      setFeedback(contentMessage(error));
    } finally {
      setLoadingMoreComments(false);
    }
  }

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      activePostId === null ||
      !commentsHasNext ||
      commentsNextCursorId === null
    ) {
      return;
    }
    const node = commentSentinelRef.current;
    if (!node || typeof window.IntersectionObserver !== "function") return;
    const observer = new window.IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          void loadMoreComments();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  });

  const rootComments = comments.filter(item => item.parentCommentId === null);
  const repliesByParent = new Map<number, CommunityComment[]>();
  for (const item of comments) {
    if (item.parentCommentId !== null) {
      const list = repliesByParent.get(item.parentCommentId) ?? [];
      list.push(item);
      repliesByParent.set(item.parentCommentId, list);
    }
  }

  const modalSelectedPosition =
    liveShareablePositions.find(pos => pos.id === modalPositionId) ?? null;

  const matchedInItems = isDetailView
    ? items.find(item => item.id === highlightPostId) ?? null
    : null;
  const detailPost = detailPostQuery.data ?? matchedInItems;
  const displayedItems = isDetailView ? (detailPost ? [detailPost] : []) : items;
  const isLoadingPosts = isDetailView
    ? !detailPost && (detailPostQuery.isLoading || postsQuery.isLoading)
    : postsQuery.isLoading;
  const loadError = isDetailView
    ? !detailPost && detailPostQuery.isError
      ? detailPostQuery.error
      : null
    : postsQuery.isError
      ? postsQuery.error
      : null;

  return (
    <MemberShell
      title="커뮤니티"
      subtitle="요기망치 트레이더들과 실시간 포지션 관점과 모의투자 전략을 나누세요."
      variant="wide"
      hideCardHeading
    >
      {/* V1 CommunityContainer 2-Column Layout (max-w-5xl lg:flex lg:items-start lg:gap-14) */}
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
              커뮤니티
            </h2>
            <p className="mt-1 text-sm font-medium text-gray-500">
              전체글, 주간 인기글, 최신글을 확인하고 모의투자 관점을 공유하세요.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <V1Button
              variant={isLoggedIn ? "blue" : "gray"}
              size="sm"
              aria-disabled={!isLoggedIn}
              className={
                !isLoggedIn
                  ? "border-gray-200 bg-gray-200 text-gray-400 cursor-default hover:bg-gray-200 disabled:opacity-100"
                  : ""
              }
              onClick={() => {
                if (!requireReadyMember()) return;
                setWriteModalOpen(true);
              }}
            >
              <V1IconPen className="mr-1.5 h-3.5 w-3.5" />
              <span>글쓰기 모달 열기</span>
            </V1Button>
            <button
              type="button"
              aria-disabled={!isLoggedIn}
              onClick={() => {
                if (!requireReadyMember()) return;
                const defaultPos = liveShareablePositions[0] ?? null;
                setModalCategory("POSITION");
                if (defaultPos) {
                  setModalPositionId(defaultPos.id);
                  setModalSymbolTag(defaultPos.symbol);
                } else {
                  setModalPositionId("");
                }
                setWriteModalOpen(true);
              }}
              className={
                isLoggedIn
                  ? "inline-flex h-9 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-3.5 text-xs font-bold text-[#0058FF] transition-colors hover:bg-blue-100 cursor-pointer"
                  : "inline-flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-200 px-3.5 text-xs font-bold text-gray-400 cursor-default"
              }
            >
              <V1IconChartBar className="mr-1.5 h-3.5 w-3.5" />
              <span>포지션 공유하기</span>
            </button>
            <Link
              href="/trading"
              className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-gray-300 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              모의투자 하러가기 →
            </Link>
          </div>
        </div>

        <div className="lg:flex lg:items-start lg:gap-14">
          {/* 좌측/중앙: CommunityTabs + 필터 + CommunityItem 피드 또는 단건 상세 */}
          <div className="min-w-0 flex-1 space-y-6">
            {isDetailView ? (
              <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 py-3.5">
                <Link
                  href={`/community/${v1Tab}`}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-700 hover:text-[#0058FF]"
                >
                  <V1IconArrowLeft className="h-3.5 w-3.5" />
                  <span>커뮤니티 피드로 돌아가기</span>
                </Link>
              </div>
            ) : (
              /* V1 CommunityTabs (전체글 | 주간 인기글 | 최신글) */
              <div className="rounded-2xl border border-gray-200 bg-white px-4 pt-2 pb-4">
                <V1Tabs
                  tabs={[
                    { label: "전체글", value: "all" },
                    { label: "주간 인기글", value: "best" },
                    { label: "최신글", value: "latest" },
                  ]}
                  activeTab={v1Tab}
                  onChange={handleV1TabChange}
                  className="mb-4"
                />

                {/* 카테고리 · 종목 · 정렬 셀렉트박스 필터 (글쓰기 팝업 스타일과 통일) */}
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-bold text-gray-500">
                        카테고리
                      </span>
                      <select
                        aria-label="카테고리 필터"
                        value={category}
                        onChange={event => {
                          setCategory(event.currentTarget.value as "" | CommunityCategory);
                          resetFeedPagination();
                        }}
                        className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
                      >
                        {COMMUNITY_CATEGORIES.map(item => (
                          <option key={item.key || "ALL_CAT"} value={item.key}>
                            {item.key ? item.label : "전체 카테고리"}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[11px] font-bold text-gray-500">
                        연관 선물 종목
                      </span>
                      <select
                        aria-label="종목 태그 필터"
                        value={symbolTag}
                        onChange={event => {
                          setSymbolTag(event.currentTarget.value);
                          resetFeedPagination();
                        }}
                        className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
                      >
                        {SYMBOL_FILTER_TAGS.map(symbol => (
                          <option key={symbol || "ALL_SYM"} value={symbol}>
                            {symbol ? `#${symbol} (${symbol}USDT)` : "전체 종목"}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[11px] font-bold text-gray-500">
                        정렬 기준
                      </span>
                      <select
                        aria-label="정렬 선택"
                        value={sort}
                        onChange={event => {
                          const nextSort = event.currentTarget.value as "LATEST" | "POPULAR";
                          setSort(nextSort);
                          setV1Tab(nextSort === "POPULAR" ? "best" : "latest");
                          resetFeedPagination();
                        }}
                        className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
                      >
                        <option value="LATEST">최신글</option>
                        <option value="POPULAR">인기글</option>
                      </select>
                    </label>
                  </div>

                  <form className="flex gap-2" onSubmit={handleSearch}>
                    <label className="flex-1">
                      <span className="sr-only">커뮤니티 검색어</span>
                      <input
                        type="search"
                        name="keyword"
                        className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-medium text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
                        value={searchInput}
                        onChange={event => setSearchInput(event.currentTarget.value)}
                        placeholder="제목·본문 키워드 검색 (예: 롱, 손절, ETF)"
                      />
                    </label>
                    <V1Button type="submit" variant="blue" size="sm">
                      검색
                    </V1Button>
                  </form>
                </div>
              </div>
            )}

            {feedback && (
              <div
                className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold text-[#0058FF]"
                role="status"
              >
                {feedback}
              </div>
            )}

            {isLoadingPosts && (
              <div className="card rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500" role="status">
                커뮤니티 게시글을 불러오는 중입니다…
              </div>
            )}

            {loadError && (
              <div className="card rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600" role="alert">
                <p>게시글을 불러오지 못했습니다. ({contentMessage(loadError)})</p>
                <V1Button
                  variant="white"
                  size="sm"
                  className="mt-3"
                  onClick={() =>
                    void (isDetailView ? detailPostQuery.refetch() : postsQuery.refetch())
                  }
                >
                  다시 시도
                </V1Button>
              </div>
            )}

            {displayedItems.length === 0 && !isLoadingPosts && !loadError && (
              <div className="card rounded-2xl border border-gray-200 bg-white py-16 text-center text-sm text-gray-500">
                조건에 맞는 게시글이 없습니다. 첫 번째 관점을 남겨보세요!
              </div>
            )}

            {/* 인스타그램 스타일 실시간 '새 게시글 보기' 플로팅 토스트 팝업 (피드 전용, 레이아웃 자리 미차지) */}
            <div ref={feedTopRef} className="scroll-mt-24" />
            {!isDetailView && pendingNewPostsCount > 0 && (
              <div
                className="pointer-events-none fixed left-1/2 top-20 z-40 -translate-x-1/2"
                role="status"
                aria-live="polite"
              >
                <button
                  type="button"
                  onClick={() => void handleLoadNewPosts()}
                  className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-blue-400 bg-[#0058FF] px-4 py-2 text-xs font-bold text-white shadow-lg transition-all hover:bg-blue-700"
                >
                  <V1IconArrowUp className="h-3.5 w-3.5" />
                  <span>새 게시글 보기</span>
                  <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-extrabold">
                    {pendingNewPostsCount}
                  </span>
                </button>
              </div>
            )}

            {/* V1 CommunityItem 카드 스트림 */}
            <div className="space-y-4">
              {displayedItems.map(post => {
                const isOpen = isDetailView && activePostId === post.id;
                const isEditing = editingPost?.id === post.id;

                return (
                  <article
                    key={post.id}
                    className="card rounded-2xl border border-gray-200 bg-white p-4 transition-colors sm:p-6"
                  >
                    {/* 상단: 작성자 프로필 + 시간 + 우측 더보기/수정·삭제 액션 */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <V1UserAvatar
                          src={post.authorProfileImgUrl}
                          memberId={post.memberId}
                          nickname={post.authorNickname}
                          withdrawn={post.authorWithdrawn}
                          size="md"
                        />
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-900">
                            <AuthorLabel
                              memberId={post.memberId}
                              nickname={post.authorNickname}
                              withdrawn={post.authorWithdrawn}
                            />
                            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                              {communityCategoryLabel(post.category)}
                            </span>
                            {post.symbolTag && (
                              <Link
                                href="/trading"
                                className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-[#0058FF]"
                              >
                                #{post.symbolTag}
                              </Link>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-gray-400">{formatCommunityTimestamp(post.createdAt)}</p>
                        </div>
                      </div>

                      {/* V1 ActionMenu (본인: 수정/삭제, 타인: 신고 / 신고 취소) */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {post.mine ? (
                          <>
                            <button
                              type="button"
                              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50"
                              onClick={() => {
                                setEditingPost(isEditing ? null : post);
                                setEditDeleteFileIds([]);
                                setEditNewImages([]);
                                setEditDetachSharedPosition(false);
                              }}
                            >
                              {isEditing ? "수정 취소" : "게시글 수정"}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-100"
                              onClick={() => {
                                if (requireReadyMember()) deletePostMutation.mutate(post.id);
                              }}
                              disabled={deletePostMutation.isPending}
                            >
                              게시글 삭제
                            </button>
                          </>
                        ) : post.reportedByMe ? (
                          <button
                            type="button"
                            className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-100"
                            onClick={() => {
                              if (requireReadyMember()) {
                                cancelReportMutation.mutate({ type: "POST", id: post.id });
                              }
                            }}
                            disabled={cancelReportMutation.isPending}
                          >
                            신고 취소
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-disabled={!isLoggedIn}
                            className={
                              isLoggedIn
                                ? "rounded-lg px-2.5 py-1 text-xs font-bold text-gray-400 hover:bg-gray-100 hover:text-red-500 cursor-pointer"
                                : "rounded-lg bg-gray-200 px-2.5 py-1 text-xs font-bold text-gray-400 cursor-default"
                            }
                            onClick={() => {
                              if (!requireReadyMember()) return;
                              setReportTarget({
                                type: "POST",
                                id: post.id,
                                title: post.title,
                              });
                            }}
                          >
                            신고
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 중단: 제목 + 본문 또는 수정 폼 */}
                    {isEditing ? (
                      <form className="mt-4 space-y-3 rounded-xl bg-gray-50 p-4" onSubmit={handleUpdatePost}>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-gray-700">카테고리</span>
                            <select
                              name="category"
                              defaultValue={post.category}
                              className="h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-xs font-bold"
                            >
                              {SELECTABLE_CATEGORIES.map(item => (
                                <option key={item} value={item}>
                                  {communityCategoryLabel(item)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-gray-700">종목 태그</span>
                            <select
                              name="symbolTag"
                              defaultValue={post.symbolTag ?? ""}
                              className="h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-xs font-bold"
                            >
                              <option value="">선택 안 함</option>
                              {SELECTABLE_SYMBOLS.map(symbol => (
                                <option key={symbol} value={symbol}>
                                  {symbol}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-gray-700">제목</span>
                          <input
                            name="title"
                            className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:bg-white focus:border-[#0058FF] focus:outline-none"
                            defaultValue={post.title}
                            required
                            maxLength={120}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-gray-700">본문</span>
                          <textarea
                            name="content"
                            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-900 focus:bg-white focus:border-[#0058FF] focus:outline-none"
                            defaultValue={post.content}
                            required
                            maxLength={4000}
                            rows={3}
                          />
                        </label>
                        {post.files && post.files.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="block text-xs font-bold text-gray-700">
                              기존 첨부 이미지 ({post.files.length}장)
                            </span>
                            <ul className="flex flex-wrap gap-2">
                              {post.files.map(file => {
                                const markedForDelete = editDeleteFileIds.includes(file.id);
                                return (
                                  <li
                                    key={file.id}
                                    className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
                                  >
                                    <span className={markedForDelete ? "line-through text-gray-400" : "text-gray-700"}>
                                      {file.originalName}
                                    </span>
                                    <button
                                      type="button"
                                      className="font-bold text-red-500 hover:underline"
                                      onClick={() =>
                                        setEditDeleteFileIds(prev =>
                                          prev.includes(file.id)
                                            ? prev.filter(id => id !== file.id)
                                            : [...prev, file.id],
                                        )
                                      }
                                    >
                                      {markedForDelete ? "삭제 취소" : "삭제 선택"}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                        {post.sharedPosition && (
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700">
                            <input
                              type="checkbox"
                              checked={editDetachSharedPosition}
                              onChange={e => setEditDetachSharedPosition(e.currentTarget.checked)}
                            />
                            <span>첨부된 포지션 스냅샷 제거</span>
                          </label>
                        )}
                        <CommunityImageUploadSlot
                          files={editNewImages}
                          onChange={setEditNewImages}
                          maxFiles={Math.max(
                            0,
                            4 - ((post.files?.length ?? 0) - editDeleteFileIds.length),
                          )}
                        />
                        <div className="flex items-center gap-2">
                          <V1Button type="submit" variant="blue" size="sm" disabled={updatePostMutation.isPending}>
                            수정 저장
                          </V1Button>
                          <V1Button
                            type="button"
                            variant="gray"
                            size="sm"
                            onClick={() => {
                              setEditingPost(null);
                              setEditDeleteFileIds([]);
                              setEditNewImages([]);
                              setEditDetachSharedPosition(false);
                            }}
                          >
                            취소
                          </V1Button>
                        </div>
                      </form>
                    ) : (
                      <div className="mt-3">
                        {isDetailView ? (
                          <div>
                            <h3 className="text-xl font-bold text-gray-900">
                              {post.title}
                            </h3>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                              {post.content}
                            </p>
                          </div>
                        ) : (
                          <Link href={`/community/${v1Tab}/${post.id}`} className="group block">
                            <h3 className="text-lg font-bold text-gray-900 group-hover:text-[#0058FF]">
                              {post.title}
                            </h3>
                            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                              {post.content}
                            </p>
                          </Link>
                        )}
                        {(() => {
                          if (post.sharedPosition) {
                            return (
                              <SharedPositionCard
                                snapshot={post.sharedPosition}
                                showPnlAmount={post.sharedPosition.showPnlAmount ?? true}
                              />
                            );
                          }
                          const customShared = sharedPositionsByPostId[post.id];
                          if (customShared) {
                            return (
                              <SharedPositionCard
                                snapshot={customShared.snapshot}
                                showPnlAmount={customShared.showPnlAmount}
                              />
                            );
                          }
                          return null;
                        })()}
                        {post.files && post.files.length > 0 && (
                          <ul
                            className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"
                            aria-label="게시글 첨부 이미지"
                            data-post-files={post.id}
                          >
                            {post.files.map(file => (
                              <li
                                key={file.id}
                                className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={file.url}
                                  alt={file.originalName}
                                  className="h-40 w-full object-cover"
                                />
                                <div className="truncate px-2.5 py-1.5 text-[11px] font-medium text-gray-500">
                                  {file.originalName}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* 하단: V1 액션 바 (LikeButton + BubbleButton + 더보기) */}
                    <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          aria-disabled={!isLoggedIn}
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                            !isLoggedIn
                              ? "bg-gray-200 text-gray-400 cursor-default"
                              : post.likedByMe
                                ? "bg-red-50 text-red-500 cursor-pointer"
                                : "bg-gray-50 text-gray-600 hover:bg-gray-100 cursor-pointer"
                          }`}
                          aria-pressed={post.likedByMe}
                          onClick={() => {
                            if (!requireReadyMember()) return;
                            if (likingPostIdsRef.current.has(post.id)) return;
                            likeMutation.mutate(post);
                          }}
                        >
                          <V1IconHeart className="h-3.5 w-3.5" />
                          <span>좋아요 {post.likeCount}</span>
                        </button>

                        {isDetailView ? (
                          <span className="inline-flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-bold text-[#0058FF]">
                            <V1IconComment className="h-3.5 w-3.5" />
                            <span>댓글 {post.commentCount}</span>
                          </span>
                        ) : (
                          <Link
                            href={`/community/${v1Tab}/${post.id}`}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100"
                          >
                            <V1IconComment className="h-3.5 w-3.5" />
                            <span>댓글 {post.commentCount}</span>
                          </Link>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {isDetailView ? (
                          <Link
                            href={`/community/${v1Tab}`}
                            className="text-xs font-bold text-gray-400 hover:text-gray-700"
                          >
                            목록으로
                          </Link>
                        ) : (
                          <Link
                            href={`/community/${v1Tab}/${post.id}`}
                            className="text-xs font-bold text-gray-400 hover:text-gray-700"
                          >
                            더보기 →
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* V1 CommentContainer & CommentForm (상세페이지 전용) */}
                    {isOpen && (
                      <section
                        className="mt-4 space-y-4 border-t border-gray-100 pt-4"
                        aria-label="댓글 및 대댓글"
                      >
                        <ul className="space-y-3">
                          {rootComments.map(comment => {
                            const replies = repliesByParent.get(comment.id) ?? [];
                            const isDeletedParent = Boolean(comment.deleted);
                            const isReplyingRoot =
                              replyParentId === comment.id && replyTargetCommentId === null;
                            return (
                              <li
                                key={comment.id}
                                id={`comment-${comment.id}`}
                                className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3.5 text-xs scroll-mt-24"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-1.5">
                                  <div className="flex items-center gap-2 font-bold text-gray-900">
                                    <AuthorLabel
                                      memberId={comment.memberId}
                                      nickname={comment.authorNickname}
                                      withdrawn={comment.authorWithdrawn}
                                    />
                                    <span className="font-normal text-gray-400">{formatCommunityTimestamp(comment.createdAt)}</span>
                                  </div>
                                  {!isDeletedParent && (
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        aria-disabled={!isLoggedIn}
                                        aria-pressed={Boolean(comment.likedByMe)}
                                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                                          !isLoggedIn
                                            ? "bg-gray-200 text-gray-400 cursor-default"
                                            : comment.likedByMe
                                              ? "bg-red-50 text-red-500 cursor-pointer"
                                              : "text-gray-500 hover:bg-gray-100 cursor-pointer"
                                        }`}
                                        onClick={() => {
                                          if (!requireReadyMember()) return;
                                          if (likingCommentIdsRef.current.has(comment.id)) return;
                                          commentLikeMutation.mutate({
                                            postId: post.id,
                                            comment,
                                          });
                                        }}
                                      >
                                        <V1IconHeart className="mr-1 inline h-3 w-3" />
                                        <span>{comment.likeCount ?? 0}</span>
                                      </button>
                                      {isLoggedIn && (
                                        <button
                                          type="button"
                                          className="font-bold text-[#0058FF] hover:underline cursor-pointer"
                                          onClick={() => {
                                            if (!requireReadyMember()) return;
                                            if (isReplyingRoot) {
                                              setReplyParentId(null);
                                              setReplyTargetCommentId(null);
                                              setReplyTargetMemberId(null);
                                              setReplyTargetNickname(null);
                                            } else {
                                              setReplyParentId(comment.id);
                                              setReplyTargetCommentId(null);
                                              setReplyTargetMemberId(null);
                                              setReplyTargetNickname(comment.authorNickname);
                                            }
                                          }}
                                        >
                                          {isReplyingRoot ? "답글 취소" : "답글 달기"}
                                        </button>
                                      )}
                                      {comment.mine ? (
                                        <>
                                          <button
                                            type="button"
                                            className="font-bold text-gray-600 hover:underline"
                                            onClick={() =>
                                              setEditingComment(
                                                editingComment?.id === comment.id ? null : comment,
                                              )
                                            }
                                          >
                                            댓글 수정
                                          </button>
                                          <button
                                            type="button"
                                            className="font-bold text-red-500 hover:underline"
                                            onClick={() => {
                                              if (requireReadyMember()) {
                                                deleteCommentMutation.mutate({
                                                  postId: post.id,
                                                  commentId: comment.id,
                                                });
                                              }
                                            }}
                                          >
                                            댓글 삭제
                                          </button>
                                        </>
                                      ) : comment.reportedByMe ? (
                                        <button
                                          type="button"
                                          className="font-bold text-red-500 hover:underline"
                                          onClick={() => {
                                            if (requireReadyMember()) {
                                              cancelReportMutation.mutate({
                                                type: "REPLY",
                                                id: comment.id,
                                                postId: post.id,
                                              });
                                            }
                                          }}
                                        >
                                          신고 취소
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          aria-disabled={!isLoggedIn}
                                          className={
                                            isLoggedIn
                                              ? "text-gray-400 hover:text-red-500 cursor-pointer"
                                              : "rounded bg-gray-200 px-1.5 py-0.5 text-gray-400 cursor-default"
                                          }
                                          onClick={() => {
                                            if (!requireReadyMember()) return;
                                            setReportTarget({
                                              type: "REPLY",
                                              id: comment.id,
                                              postId: post.id,
                                              title: comment.content.slice(0, 30),
                                            });
                                          }}
                                        >
                                          신고
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {isDeletedParent ? (
                                  <p
                                    className="mt-1.5 text-sm italic text-gray-400"
                                    data-deleted-comment="true"
                                  >
                                    삭제된 댓글입니다.
                                  </p>
                                ) : editingComment?.id === comment.id ? (
                                  <form
                                    className="mt-2 flex gap-2"
                                    onSubmit={event => {
                                      event.preventDefault();
                                      if (!requireReadyMember()) return;
                                      const data = new FormData(event.currentTarget);
                                      const content = String(data.get("content") ?? "").trim();
                                      if (!content) return;
                                      updateCommentMutation.mutate({
                                        postId: post.id,
                                        commentId: comment.id,
                                        content,
                                      });
                                    }}
                                  >
                                    <input
                                      name="content"
                                      className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-900 focus:bg-white focus:border-[#0058FF] focus:outline-none"
                                      defaultValue={comment.content}
                                      required
                                      maxLength={1000}
                                    />
                                    <V1Button type="submit" variant="blue" size="xs">
                                      댓글 저장
                                    </V1Button>
                                  </form>
                                ) : (
                                  <p className="mt-1.5 text-sm text-gray-800">{comment.content}</p>
                                )}

                                {replies.length > 0 && (
                                  <ul className="mt-2.5 space-y-2 border-l-2 border-gray-200 pl-3">
                                    {replies.map(reply => {
                                      const isReplyingChild =
                                        replyParentId === comment.id &&
                                        replyTargetCommentId === reply.id;
                                      return (
                                        <li
                                          key={reply.id}
                                          id={`comment-${reply.id}`}
                                          className="text-xs text-gray-700 scroll-mt-24"
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span>
                                              <V1IconCornerDownRight className="mr-1 inline h-3.5 w-3.5 text-gray-400" />
                                              <AuthorLabel
                                                memberId={reply.memberId}
                                                nickname={reply.authorNickname}
                                                withdrawn={reply.authorWithdrawn}
                                              />
                                              :{" "}
                                              {reply.targetNickname && (
                                                <span
                                                  className="mr-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold text-[#0058FF] cursor-pointer"
                                                  data-mention={reply.targetNickname}
                                                  onClick={() => {
                                                    const anchorId = `comment-${reply.targetCommentId ?? reply.parentCommentId ?? comment.id}`;
                                                    if (typeof document !== "undefined") {
                                                      document
                                                        .getElementById(anchorId)
                                                        ?.scrollIntoView({
                                                          behavior: "smooth",
                                                          block: "center",
                                                        });
                                                    }
                                                  }}
                                                >
                                                  @{reply.targetNickname}
                                                </span>
                                              )}
                                              {reply.content}
                                            </span>
                                            {!reply.deleted && (
                                              <div className="flex items-center gap-1.5">
                                                <button
                                                  type="button"
                                                  aria-disabled={!isLoggedIn}
                                                  aria-pressed={Boolean(reply.likedByMe)}
                                                  className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                                                    !isLoggedIn
                                                      ? "bg-gray-200 text-gray-400 cursor-default"
                                                      : reply.likedByMe
                                                        ? "bg-red-50 text-red-500 cursor-pointer"
                                                        : "text-gray-500 hover:bg-gray-100 cursor-pointer"
                                                  }`}
                                                  onClick={() => {
                                                    if (!requireReadyMember()) return;
                                                    if (likingCommentIdsRef.current.has(reply.id)) return;
                                                    commentLikeMutation.mutate({
                                                      postId: post.id,
                                                      comment: reply,
                                                    });
                                                  }}
                                                >
                                                  <V1IconHeart className="mr-1 inline h-3 w-3" />
                                                  <span>{reply.likeCount ?? 0}</span>
                                                </button>
                                                {isLoggedIn && (
                                                  <button
                                                    type="button"
                                                    className="font-bold text-[#0058FF] hover:underline cursor-pointer"
                                                    onClick={() => {
                                                      if (!requireReadyMember()) return;
                                                      if (isReplyingChild) {
                                                        setReplyParentId(null);
                                                        setReplyTargetCommentId(null);
                                                        setReplyTargetMemberId(null);
                                                        setReplyTargetNickname(null);
                                                      } else {
                                                        setReplyParentId(comment.id);
                                                        setReplyTargetCommentId(reply.id);
                                                        setReplyTargetMemberId(reply.memberId);
                                                        setReplyTargetNickname(reply.authorNickname);
                                                      }
                                                    }}
                                                  >
                                                    {isReplyingChild ? "답글 취소" : "답글 달기"}
                                                  </button>
                                                )}
                                                {reply.mine ? (
                                                  <>
                                                    <button
                                                      type="button"
                                                      className="font-bold text-gray-600 hover:underline"
                                                      onClick={() =>
                                                        setEditingComment(
                                                          editingComment?.id === reply.id
                                                            ? null
                                                            : reply,
                                                        )
                                                      }
                                                    >
                                                      댓글 수정
                                                    </button>
                                                    <button
                                                      type="button"
                                                      className="font-bold text-red-500 hover:underline"
                                                      onClick={() => {
                                                        if (requireReadyMember()) {
                                                          deleteCommentMutation.mutate({
                                                            postId: post.id,
                                                            commentId: reply.id,
                                                          });
                                                        }
                                                      }}
                                                    >
                                                      삭제
                                                    </button>
                                                  </>
                                                ) : reply.reportedByMe ? (
                                                  <button
                                                    type="button"
                                                    className="font-bold text-red-500 hover:underline"
                                                    onClick={() => {
                                                      if (requireReadyMember()) {
                                                        cancelReportMutation.mutate({
                                                          type: "REPLY",
                                                          id: reply.id,
                                                          postId: post.id,
                                                        });
                                                      }
                                                    }}
                                                  >
                                                    신고 취소
                                                  </button>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    aria-disabled={!isLoggedIn}
                                                    className={
                                                      isLoggedIn
                                                        ? "text-gray-400 hover:text-red-500 cursor-pointer"
                                                        : "rounded bg-gray-200 px-1.5 py-0.5 text-gray-400 cursor-default"
                                                    }
                                                    onClick={() => {
                                                      if (!requireReadyMember()) return;
                                                      setReportTarget({
                                                        type: "REPLY",
                                                        id: reply.id,
                                                        postId: post.id,
                                                        title: reply.content.slice(0, 30),
                                                      });
                                                    }}
                                                  >
                                                    신고
                                                  </button>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                          {editingComment?.id === reply.id && (
                                            <form
                                              className="mt-2 flex gap-2"
                                              onSubmit={event => {
                                                event.preventDefault();
                                                if (!requireReadyMember()) return;
                                                const data = new FormData(event.currentTarget);
                                                const content = String(
                                                  data.get("content") ?? "",
                                                ).trim();
                                                if (!content) return;
                                                updateCommentMutation.mutate({
                                                  postId: post.id,
                                                  commentId: reply.id,
                                                  content,
                                                });
                                              }}
                                            >
                                              <input
                                                name="content"
                                                className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-900 focus:bg-white focus:border-[#0058FF] focus:outline-none"
                                                defaultValue={reply.content}
                                                required
                                                maxLength={1000}
                                              />
                                              <V1Button type="submit" variant="blue" size="xs">
                                                댓글 저장
                                              </V1Button>
                                            </form>
                                          )}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </li>
                            );
                          })}
                        </ul>

                        {/* 댓글 커서 기반 무한스크롤 센티넬 & 더보기 버튼 */}
                        <div
                          ref={commentSentinelRef}
                          data-infinite-scroll="community-comments-sentinel"
                          className="flex flex-col items-center justify-center gap-2"
                        >
                          {loadingMoreComments && (
                            <p role="status" className="text-xs font-bold text-gray-500">
                              다음 댓글을 불러오는 중…
                            </p>
                          )}
                          {commentsHasNext && commentsNextCursorId !== null && (
                            <V1Button
                              variant="white"
                              size="xs"
                              disabled={loadingMoreComments}
                              onClick={() => void loadMoreComments()}
                            >
                              {loadingMoreComments ? "불러오는 중…" : "이전 댓글 더보기"}
                            </V1Button>
                          )}
                        </div>

                        {isLoggedIn ? (
                          <div className="space-y-2">
                            {replyParentId !== null && (
                              <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-[#0058FF]">
                                <span>
                                  {replyTargetCommentId !== null && replyTargetNickname
                                    ? `@${replyTargetNickname} 님에게 멘션 답글 작성 중`
                                    : `${replyTargetNickname ?? "작성자"} 님의 댓글에 답글 작성 중`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReplyParentId(null);
                                    setReplyTargetCommentId(null);
                                    setReplyTargetMemberId(null);
                                    setReplyTargetNickname(null);
                                  }}
                                  className="text-gray-500 hover:text-gray-800 cursor-pointer"
                                >
                                  답글 취소 ×
                                </button>
                              </div>
                            )}
                            <form
                              className="flex gap-2"
                              onSubmit={event => handleCreateComment(post.id, event)}
                            >
                              <label className="flex-1">
                                <span className="sr-only">
                                  {replyParentId ? `댓글 #${replyParentId}에 대한 답글` : "새 댓글"}
                                </span>
                                <input
                                  name="content"
                                  className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-xs text-gray-900 placeholder-gray-400 focus:bg-white focus:border-[#0058FF] focus:outline-none"
                                  required
                                  maxLength={1000}
                                  placeholder={
                                    replyParentId
                                      ? replyTargetNickname
                                        ? `@${replyTargetNickname} 님에게 답글 내용을 입력해 주세요.`
                                        : "답글 내용을 입력해 주세요."
                                      : "댓글을 남겨보세요 (최대 500~1000자)"
                                  }
                                />
                              </label>
                              <V1Button
                                type="submit"
                                variant="blue"
                                size="sm"
                                disabled={createCommentMutation.isPending}
                              >
                                {replyParentId ? "답글 등록" : "댓글 등록"}
                              </V1Button>
                            </form>
                          </div>
                        ) : (
                          <div
                            data-comment-auth-notice="true"
                            className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 text-center text-xs font-bold text-gray-500"
                          >
                            댓글 작성은 로그인 이후 가능합니다.
                          </div>
                        )}
                      </section>
                    )}
                  </article>
                );
              })}
            </div>

            {/* 10개 단위 커서 기반 무한스크롤 센티넬 & 보조 더보기 버튼 (피드 전용) */}
            {!isDetailView && (
              <div
                ref={loadMoreSentinelRef}
                data-infinite-scroll="community-sentinel"
                className="flex flex-col items-center justify-center gap-2 pt-2"
              >
                {loadingMore && (
                  <p role="status" className="text-xs font-bold text-gray-500">
                    다음 게시글 10개를 불러오는 중…
                  </p>
                )}
                {hasNext && nextCursorId !== null && (
                  <V1Button
                    variant="white"
                    size="sm"
                    disabled={loadingMore}
                    onClick={() => void loadMorePosts()}
                  >
                    {loadingMore ? "다음 게시글 10개를 불러오는 중…" : "이전 게시글 더보기"}
                  </V1Button>
                )}
              </div>
            )}
          </div>

          {/* 우측 사이드바: 실시간 대회투자 TOP5 */}
          <aside className="mt-10 w-full shrink-0 space-y-6 lg:mt-0 lg:w-72">
            <div
              className="card rounded-2xl border border-gray-200 bg-white p-5"
              data-contest-top5-card="true"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="shrink-0 whitespace-nowrap text-lg font-bold text-gray-900">
                  대회투자 TOP5
                </h2>
                {activeSidebarSeason?.displayStatus === "LIVE" ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-[#0058FF]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#0058FF] animate-pulse" />
                    실시간 LIVE
                  </span>
                ) : activeSidebarSeason?.displayStatus === "FINISHED" ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                    정산 완료
                  </span>
                ) : activeSidebarSeason?.displayStatus === "RECRUITING" ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                    모집 중
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-500">
                    실시간 랭킹
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs font-medium text-gray-400">
                시즌별 대회 지갑 수익률 상위 트레이더 랭킹입니다.
              </p>

              <div className="mt-3">
                <select
                  aria-label="대회 시즌 선택"
                  value={activeSidebarSeasonId !== null ? String(activeSidebarSeasonId) : ""}
                  disabled={!sidebarContestSeasonsQuery.data || sidebarSeasons.length === 0}
                  onChange={e => setContestSeason(e.target.value)}
                  className="h-9 w-full truncate rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs font-bold text-gray-800 transition-colors hover:border-gray-300 focus:border-[#0058FF] focus:bg-white focus:outline-none disabled:opacity-70"
                >
                  {sidebarContestSeasonsQuery.data ? (
                    sidebarSeasons.length > 0 ? (
                      <>
                        {sidebarSeasonGroups.running.length > 0 && (
                          <optgroup label="진행 중 (LIVE)">
                            {sidebarSeasonGroups.running.map(s => (
                              <option key={s.id} value={String(s.id)}>
                                {s.title}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {sidebarSeasonGroups.finished.length > 0 && (
                          <optgroup label="종료 · 정산 완료">
                            {sidebarSeasonGroups.finished.map(s => (
                              <option key={s.id} value={String(s.id)}>
                                {s.title}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {sidebarSeasonGroups.recruitingOnly.length > 0 && (
                          <optgroup label="참가 모집 중">
                            {sidebarSeasonGroups.recruitingOnly.map(s => (
                              <option key={s.id} value={String(s.id)}>
                                {s.title}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    ) : (
                      <option value="">등록된 대회 시즌 없음</option>
                    )
                  ) : sidebarContestSeasonsQuery.isError ? (
                    <option value="">시즌 목록 조회 실패</option>
                  ) : (
                    <option value="">대회 시즌 불러오는 중...</option>
                  )}
                </select>
              </div>

              <div className="mt-3.5">
                {(() => {
                  const isInitialSeasonsLoading =
                    !sidebarContestSeasonsQuery.data && sidebarContestSeasonsQuery.isPending;
                  const isLeaderboardLoading =
                    activeSidebarSeasonId !== null &&
                    !sidebarLeaderboardQuery.data &&
                    sidebarLeaderboardQuery.isPending;

                  if (isInitialSeasonsLoading || isLeaderboardLoading) {
                    return (
                      <div
                        className="space-y-2.5"
                        data-contest-top5-state="loading"
                        aria-live="polite"
                      >
                        <span className="sr-only">실시간 대회 랭킹을 불러오는 중입니다.</span>
                        {[1, 2, 3, 4, 5].map(rank => (
                          <div
                            key={rank}
                            className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 bg-[#F9FAFB] px-3 py-2.5"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-black text-gray-500">
                                {rank}
                              </span>
                              <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-gray-200" />
                              <div className="h-3.5 w-16 animate-pulse rounded bg-gray-200" />
                            </div>
                            <div className="h-3.5 w-12 animate-pulse rounded bg-gray-200" />
                          </div>
                        ))}
                      </div>
                    );
                  }

                  const hasQueryError =
                    (!sidebarContestSeasonsQuery.data && sidebarContestSeasonsQuery.isError) ||
                    (activeSidebarSeasonId !== null &&
                      !sidebarLeaderboardQuery.data &&
                      sidebarLeaderboardQuery.isError);

                  if (hasQueryError) {
                    return (
                      <div
                        className="rounded-xl border border-gray-100 bg-[#F9FAFB] px-3 py-5 text-center"
                        data-contest-top5-state="error"
                      >
                        <p className="text-xs font-bold text-gray-500">
                          실시간 대회 랭킹을 불러오지 못했습니다.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            void sidebarContestSeasonsQuery.refetch();
                            if (activeSidebarSeasonId !== null) {
                              void sidebarLeaderboardQuery.refetch();
                            }
                          }}
                          className="mt-2.5 inline-flex h-8 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          다시 불러오기
                        </button>
                      </div>
                    );
                  }

                  const rawItems = (sidebarLeaderboardQuery.data?.items ?? []).slice(0, 5);
                  if (rawItems.length === 0) {
                    return (
                      <div
                        className="rounded-xl border border-gray-100 bg-[#F9FAFB] px-3 py-6 text-center text-xs font-bold text-gray-400"
                        data-contest-top5-state="empty"
                      >
                        {activeSidebarSeason?.displayStatus === "RECRUITING"
                          ? "대회 시작 후 실시간 수익률 랭킹이 집계됩니다."
                          : "집계된 대회 랭킹 데이터가 없습니다."}
                      </div>
                    );
                  }

                  return (
                    <ul className="space-y-2.5" data-contest-top5-state="ready">
                      {rawItems.map(entry => {
                        const profile = top5ProfilesByMemberId.get(entry.memberId);
                        const withdrawn = profile?.withdrawn ?? false;
                        const displayNickname = withdrawn
                          ? "탈퇴한회원"
                          : profile?.nickname || entry.nickname;
                        const roi = formatContestSignedRoi(entry.roiPct);
                        const equityLabel = formatContestUsdt(entry.totalEquity);
                        const isNeg = roi.trim().startsWith("-");
                        const isZero = !/[1-9]/.test(roi);
                        const roiColor = isNeg
                          ? "text-blue-600"
                          : isZero
                            ? "text-gray-600"
                            : "text-red-500";
                        const rankBadgeClass =
                          entry.rank === 1
                            ? "bg-[#0058FF] text-white"
                            : entry.rank === 2
                              ? "bg-slate-800 text-white"
                              : entry.rank === 3
                                ? "bg-amber-600 text-white"
                                : "bg-gray-200 text-gray-700";

                        return (
                          <li
                            key={`${entry.rank}-${entry.memberId}`}
                            className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 bg-[#F9FAFB] px-3 py-2.5"
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${rankBadgeClass}`}
                              >
                                {entry.rank}
                              </span>
                              <V1UserAvatar
                                src={profile?.profileImgUrl}
                                memberId={entry.memberId}
                                nickname={displayNickname}
                                withdrawn={withdrawn}
                                size="sm"
                              />
                              <div className="min-w-0">
                                {withdrawn ? (
                                  <span
                                    className="block truncate text-xs font-bold text-gray-400"
                                    data-withdrawn="true"
                                  >
                                    탈퇴한회원
                                  </span>
                                ) : (
                                  <Link
                                    href={`/members/${entry.memberId}`}
                                    className="block truncate text-xs font-bold text-gray-900 transition-colors hover:text-[#0058FF]"
                                  >
                                    {displayNickname}
                                  </Link>
                                )}
                                <span className="block truncate text-[11px] font-medium tabular-nums text-gray-400">
                                  {equityLabel}
                                </span>
                              </div>
                            </div>
                            <span
                              className={`shrink-0 whitespace-nowrap text-xs font-black tabular-nums ${roiColor}`}
                            >
                              {roi}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
              </div>

              <Link
                href="/contest"
                className="mt-4 flex h-10 w-full items-center justify-center rounded-xl bg-gray-100 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-200"
              >
                대회 참여하기 →
              </Link>
            </div>
          </aside>
        </div>
      </div>

      {/* V1 우측 하단 플로팅 글쓰기 버튼 (FloatMenu.tsx 100% 카피) */}
      <div className="fixed bottom-6 right-6 z-30">
        <button
          type="button"
          aria-disabled={!isLoggedIn}
          onClick={() => {
            if (!requireReadyMember()) return;
            setWriteModalOpen(true);
          }}
          aria-label="글쓰기 모달 열기"
          className={
            isLoggedIn
              ? "flex items-center justify-center rounded-full bg-[#0058FF] p-5 text-white transition-colors hover:bg-blue-700 cursor-pointer"
              : "flex items-center justify-center rounded-full bg-gray-200 p-5 text-gray-400 cursor-default"
          }
        >
          <V1IconPen className="h-6 w-6" />
        </button>
      </div>

      {/* V1 WriteModal (글쓰기 모달) */}
      <DimModal
        open={writeModalOpen}
        onClose={closeAndResetWriteModal}
        title="글쓰기"
        subtitle="타인을 비방하거나 불쾌감을 주는 글은 제재될 수 있습니다."
      >
        <form data-form-source="modal" className="space-y-4" onSubmit={handleCreatePost}>
          {(createPostMutation.isError || (feedback && snapshot.phase !== "ready")) && feedback && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-600"
            >
              {feedback}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              name="category"
              value={modalCategory}
              onChange={event =>
                setModalCategory(event.currentTarget.value as CommunityCategory)
              }
              className="h-10 rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
            >
              {SELECTABLE_CATEGORIES.map(item => (
                <option key={item} value={item}>
                  {communityCategoryLabel(item)}
                </option>
              ))}
            </select>
            <select
              name="symbolTag"
              value={modalSymbolTag}
              onChange={event => setModalSymbolTag(event.currentTarget.value)}
              className="h-10 rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
            >
              <option value="">종목 선택 안 함</option>
              {SELECTABLE_SYMBOLS.map(symbol => (
                <option key={symbol} value={symbol}>
                  {symbol}USDT
                </option>
              ))}
            </select>
            <select
              name="sharedPositionId"
              aria-label="모달 포지션 공유 선택"
              value={modalPositionId}
              onChange={event => {
                const nextId = event.currentTarget.value;
                setModalPositionId(nextId);
                const matched = liveShareablePositions.find(pos => pos.id === nextId);
                if (matched) {
                  setModalCategory("POSITION");
                  setModalSymbolTag(matched.symbol);
                }
              }}
              className="h-10 rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:outline-none"
            >
              <option value="">
                {shareablePositionsQuery.isLoading
                  ? "보유 포지션 조회 중…"
                  : liveShareablePositions.length === 0
                    ? "보유 오픈 포지션 없음"
                    : "포지션 첨부 안 함"}
              </option>
              {liveShareablePositions.map(pos => (
                <option key={pos.id} value={pos.id}>
                  [{pos.marketLabel}] {pos.pair} {pos.leverage}x {pos.side} ({pos.roePct})
                </option>
              ))}
            </select>
          </div>
          {modalCategory === "POSITION" &&
            !shareablePositionsQuery.isLoading &&
            liveShareablePositions.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3.5 py-2.5 text-xs font-semibold text-gray-700">
                <span>
                  현재 보유 중인 오픈 포지션이 없습니다. 텍스트·차트만 작성하거나 모의투자에서 포지션을 오픈해 보세요.
                </span>
                <Link
                  href="/trading"
                  onClick={closeAndResetWriteModal}
                  className="shrink-0 whitespace-nowrap font-bold text-[#0058FF] hover:underline"
                >
                  모의투자 하러가기 →
                </Link>
              </div>
            )}
          {modalSelectedPosition && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-[11px] font-bold text-gray-600">
                  공유할 실시간 포지션 스냅샷 미리보기
                </span>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-gray-600">
                  <input
                    type="checkbox"
                    name="showPnlAmount"
                    checked={modalShowPnlAmount}
                    onChange={event => setModalShowPnlAmount(event.currentTarget.checked)}
                  />
                  <span>평가손익 금액(USDT) 함께 공개</span>
                </label>
              </div>
              <SharedPositionCard
                snapshot={modalSelectedPosition}
                showPnlAmount={modalShowPnlAmount}
              />
            </div>
          )}
          <input
            name="title"
            required
            maxLength={120}
            placeholder="제목을 입력해주세요"
            className="h-11 w-full rounded-xl border border-gray-300 bg-white px-4 text-sm font-bold text-gray-900 focus:bg-white focus:border-[#0058FF] focus:outline-none"
          />
          <textarea
            name="content"
            required
            maxLength={4000}
            rows={5}
            placeholder="자유롭게 이야기를 나눠보세요. (타인을 비방하거나 불쾌감을 주는 글은 제재될 수 있습니다.)"
            className="w-full rounded-xl border border-gray-300 bg-white p-4 text-sm text-gray-900 focus:bg-white focus:border-[#0058FF] focus:outline-none"
          />
          <CommunityImageUploadSlot
            files={modalImages}
            onChange={setModalImages}
          />
          <div className="flex justify-end gap-2 pt-2">
            <V1Button variant="gray" size="sm" onClick={closeAndResetWriteModal}>
              취소
            </V1Button>
            <V1Button type="submit" variant="blue" size="sm" disabled={createPostMutation.isPending}>
              등록하기
            </V1Button>
          </div>
        </form>
      </DimModal>

      {/* V1 ReportModal (신고 모달) */}
      <DimModal
        open={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        title={reportTarget?.type === "REPLY" ? "댓글 신고하기" : "게시글 신고하기"}
        subtitle="신고 사유를 선택해 주세요. 허위 신고 시 활동이 제한될 수 있습니다."
      >
        <form className="space-y-3" onSubmit={handleReportSubmit}>
          <div className="space-y-2">
            {reportReasons.map(reason => (
              <label
                key={reason.code}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-xs font-bold ${
                  selectedReasonCode === reason.code
                    ? "border-[#0058FF] bg-blue-50 text-[#0058FF]"
                    : "border-gray-200 bg-white text-gray-700"
                }`}
              >
                <input
                  type="radio"
                  name="reportReason"
                  value={reason.code}
                  checked={selectedReasonCode === reason.code}
                  onChange={() => {
                    setSelectedReasonCode(reason.code);
                    setSelectedReportReason(reason.description);
                  }}
                />
                <span>{reason.description}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <V1Button variant="gray" size="sm" onClick={() => setReportTarget(null)}>
              취소
            </V1Button>
            <V1Button type="submit" variant="red" size="sm" disabled={reportMutation.isPending}>
              {reportMutation.isPending ? "접수 중…" : "신고 접수"}
            </V1Button>
          </div>
        </form>
      </DimModal>
    </MemberShell>
  );
}
