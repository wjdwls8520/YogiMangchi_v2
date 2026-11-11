"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MemberShell } from "./member-views";
import { useMember } from "./member-provider";
import { DimModal } from "./dim-modal";
import { TradingDataProvider } from "../../trading/components/trading-data-provider";
import { MemberSimulation } from "../../trading/components/member-simulation";
import { marketSymbolsJson, tradingJson } from "../../trading/api/client";
import { parseSymbols, type TradingSymbol } from "../../trading/market/catalog";
import {
  fetchMyContestSeasons,
  fetchPublicMemberContestSeasons,
  formatContestDateOnly,
  formatContestSignedRoi,
  formatContestSignedUsdt,
  formatContestUsdt,
  formatContestWinRate,
  resolveTradingContestBaseUrl,
} from "../../contest/api/contest-client";
import { contentJson } from "../api/client";
import { parseFollowPage, parseFollowSummary } from "../api/contracts";
import {
  communityCategoryLabel,
  parseCommunityPostPage,
  parseCommunityReport,
  parseMemberCommunityCommentPage,
  parseMemberCommunityReportPage,
  parsePublicMemberPortfolio,
  readCommunityOrPublic,
  type CommunityCategory,
  type CommunityPost,
  type MemberCommunityCommentItem,
  type MemberCommunityReportItem,
} from "../api/community-news";
import {
  formatExchangeCompactPct,
  formatExchangeFeeUsdt,
  formatExchangePct,
  formatExchangePrice,
  formatExchangeQuantity,
  formatExchangeSeedUsdt,
  formatExchangeSignedPct,
  formatExchangeSignedUsdt,
  formatExchangeUsdt,
} from "../api/exchange-format";
import {
  V1AssetSummaryCard,
  V1Button,
  V1FolderTabs,
  V1ProfileSidebar,
  V1SegmentTabs,
  V1Tabs,
  V1UserAvatar,
  V1IconHeart,
} from "./v1-ui";

type ProfileResponse = {
  memberId?: number;
  nickname?: string;
  profileMessage?: string | null;
  profileImgUrl?: string | null;
  profileImageUrl?: string | null;
};

type FollowMemberItem = {
  memberId: number;
  nickname: string;
  profileMsg: string;
  profileImgUrl?: string | null;
  following: boolean;
  followsMe: boolean;
};

export type MyPageMainTab = "mock-assets" | "contest-assets" | "portfolio" | "community";
type LedgerDetailTab = "holdings" | "pnl" | "orders" | "trades" | "open";
type ContestSubTab = "live" | "finished";

const ZERO_QUANTITY_NOTICE_TEXT =
  "보유수량 또는 포지션 수량이 0인 항목은 과거 거래 이력과 평균매수가/진입가 확인을 위해 표시됩니다. 현재 보유 중인 수량이 없어 평가금액, 평가손익, 수익률은 0으로 표시될 수 있습니다.";

const POSITION_COLORS = ["#0058FF", "#9CB34E", "#1D7CA7", "#F59E0B", "#8B5CF6"] as const;

const SYMBOL_NAME_KR: Record<string, string> = {
  BTCUSDT: "비트코인 무기한",
  ETHUSDT: "이더리움 무기한",
  XRPUSDT: "리플 무기한",
  BNBUSDT: "바이낸스코인 무기한",
  SOLUSDT: "솔라나 무기한",
  ADAUSDT: "에이다 무기한",
  LINKUSDT: "체인링크 무기한",
  AVAXUSDT: "아발란체 무기한",
  SUIUSDT: "수이 무기한",
  DOGEUSDT: "도지코인 무기한",
  PEPEUSDT: "페페 무기한",
  SHIBUSDT: "시바이누 무기한",
};

const DECIMAL_SCALE = 8;
const ZERO_BI = BigInt(0);
const TWO_BI = BigInt(2);
const HUNDRED_BI = BigInt(100);
const NEG_ONE_BI = BigInt(-1);
const ONE_BI = BigInt(1);

function pow10BigInt(exp: number): bigint {
  return BigInt(`1${"0".repeat(Math.max(0, exp))}`);
}

const DECIMAL_FACTOR = pow10BigInt(DECIMAL_SCALE);

function parseScaledBigInt(raw: string): bigint | null {
  const cleaned = raw.replace(/,/g, "").trim();
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;
  const sign = match[1] === "-" ? NEG_ONE_BI : ONE_BI;
  const whole = BigInt(match[2]);
  const fracPadded = (match[3] ?? "").slice(0, DECIMAL_SCALE).padEnd(DECIMAL_SCALE, "0");
  const frac = BigInt(fracPadded || "0");
  return sign * (whole * DECIMAL_FACTOR + frac);
}

function formatScaledBigInt(value: bigint, decimals = 2): string {
  const negative = value < ZERO_BI;
  const abs = negative ? -value : value;
  const dropDigits = DECIMAL_SCALE - decimals;
  const divisor = pow10BigInt(dropDigits);
  const half = divisor / TWO_BI;
  const rounded = (abs + half) / divisor;
  const outFactor = pow10BigInt(decimals);
  const whole = rounded / outFactor;
  const frac = (rounded % outFactor).toString().padStart(decimals, "0");
  const wholeFormatted = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const signPrefix = negative && rounded > ZERO_BI ? "-" : "";
  return decimals > 0 ? `${signPrefix}${wholeFormatted}.${frac}` : `${signPrefix}${wholeFormatted}`;
}

function multiplyDecimalStrings(a: string, b: string, decimals = 2): string {
  const left = parseScaledBigInt(a);
  const right = parseScaledBigInt(b);
  if (left === null || right === null) return "0.00";
  const product = (left * right) / DECIMAL_FACTOR;
  return formatScaledBigInt(product, decimals);
}

function computeRoePctString(netPnl: string, initialMargin: string): string {
  const pnlVal = parseScaledBigInt(netPnl);
  const marginVal = parseScaledBigInt(initialMargin);
  if (pnlVal === null || marginVal === null || marginVal <= ZERO_BI) return "0.00";
  const pctScaled = (pnlVal * HUNDRED_BI * DECIMAL_FACTOR) / marginVal;
  return formatScaledBigInt(pctScaled, 2);
}

function pnlColorText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-")) return "text-blue-600";
  if (!/[1-9]/.test(trimmed)) return "text-gray-600";
  return "text-red-500";
}

function formatKstDateTimeShort(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const kst = new Date(parsed + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function toKstDateOnly(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value.slice(0, 10);
  const kst = new Date(parsed + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function symbolNameKr(symbol: string): string {
  return SYMBOL_NAME_KR[symbol.toUpperCase()] ?? `${symbol} 무기한`;
}

function resolveRowSymbol(
  row: Record<string, unknown>,
  symbolById: ReadonlyMap<number, TradingSymbol>,
): { base: string; pair: string; nameKr: string; fullNameKr: string; tickSize?: string } {
  const symId = typeof row.tradingSymbolId === "number" ? row.tradingSymbolId : undefined;
  const found = symId !== undefined ? symbolById.get(symId) : undefined;
  if (found) {
    const base = found.symbol.toUpperCase().replace(/USDT$/i, "");
    const quote = (found.quoteAsset || "USDT").toUpperCase();
    const pair = `${base}${quote}`;
    const fullNameKr = SYMBOL_NAME_KR[pair] ?? `${found.name} 무기한`;
    const nameKr = found.name || fullNameKr.replace(" 무기한", "");
    return { base, pair, nameKr, fullNameKr, tickSize: found.priceTickSize };
  }
  const rawSym =
    typeof row.symbol === "string" && row.symbol.trim()
      ? row.symbol.trim().toUpperCase()
      : "BTCUSDT";
  const pair = rawSym.endsWith("USDT") ? rawSym : `${rawSym}USDT`;
  const base = pair.replace(/USDT$/i, "");
  const fullNameKr = symbolNameKr(pair);
  return { base, pair, nameKr: fullNameKr.replace(" 무기한", ""), fullNameKr };
}

function formatActionSideLabel(sideRaw: string, actionRaw: string): {
  isBuy: boolean;
  label: string;
} {
  const isLong = sideRaw === "LONG" || sideRaw === "BUY";
  if (actionRaw === "LIQUIDATE") {
    return { isBuy: !isLong, label: isLong ? "롱 강제청산" : "숏 강제청산" };
  }
  if (actionRaw === "CLOSE") {
    return { isBuy: !isLong, label: isLong ? "롱 종료" : "숏 종료" };
  }
  return { isBuy: isLong, label: isLong ? "롱 진입" : "숏 진입" };
}

function formatSignedUsdt(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-")) return formatExchangeSignedUsdt(trimmed);
  if (trimmed.startsWith("+")) return formatExchangeSignedUsdt(trimmed);
  if (!/[1-9]/.test(trimmed)) return "0.00 USDT";
  return formatExchangeSignedUsdt(trimmed);
}

function formatSignedPct(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-") || trimmed.startsWith("+")) {
    return formatExchangeSignedPct(trimmed);
  }
  if (!/[1-9]/.test(trimmed)) return "0.00%";
  return formatExchangeSignedPct(trimmed);
}

function isNonNegativeDecimal(raw: string): boolean {
  return !raw.trim().startsWith("-");
}

export function MemberMyProfilePage({
  initialMainTab,
}: {
  initialMainTab?: MyPageMainTab;
} = {}) {
  const { origin, snapshot: member, session } = useMember();
  const queryClient = useQueryClient();
  const isOwnAndLoggedIn = member.phase === "ready";
  const targetMemberId = isOwnAndLoggedIn ? (member.memberId ?? 0) : 0;
  const tradingBase = resolveTradingContestBaseUrl();

  const [selectedTab, setSelectedTab] = useState<MyPageMainTab | null>(initialMainTab ?? null);
  const [detailTab, setDetailTab] = useState<LedgerDetailTab>("holdings");
  const [contestSubTab, setContestSubTab] = useState<ContestSubTab>("live");
  const [portfolioTab, setPortfolioTab] = useState<"mock" | "contest">("mock");
  const [communityTab, setCommunityTab] = useState<
    "posts" | "replies" | "likedPosts" | "likedReplies" | "reports"
  >("posts");
  const [followModalType, setFollowModalType] = useState<"followers" | "followings" | null>(null);
  const [followOverrides, setFollowOverrides] = useState<Record<number, boolean>>({});

  // 5대 원장 검색 필터 상태
  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterSide, setFilterSide] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  const communitySentinelRef = useRef<HTMLDivElement>(null);

  // 권한별 탭 목록 및 활성 탭 결정
  // 로그인 본인: 4개 탭 (내 모의투자 자산 | 시즌별 대회 자산 | 포트폴리오 | 커뮤니티활동)
  // 비로그인 또는 타 유저: 2개 탭 (포트폴리오 | 커뮤니티활동)
  const visibleMainTabs = isOwnAndLoggedIn
    ? [
        { label: "내 모의투자 자산", value: "mock-assets" },
        { label: "시즌별 대회 자산", value: "contest-assets" },
        { label: "포트폴리오", value: "portfolio" },
        { label: "커뮤니티활동", value: "community" },
      ]
    : [
        { label: "포트폴리오", value: "portfolio" },
        { label: "커뮤니티활동", value: "community" },
      ];

  const defaultTab: MyPageMainTab = isOwnAndLoggedIn ? "mock-assets" : "portfolio";
  const activeMainTab: MyPageMainTab =
    selectedTab && visibleMainTabs.some(t => t.value === selectedTab)
      ? selectedTab
      : defaultTab;

  const profileQuery = useQuery({
    queryKey: ["member", "profile", member.memberId, member.generation],
    enabled: isOwnAndLoggedIn,
    queryFn: () => session.request("/members/me") as Promise<ProfileResponse>,
  });

  const followSummaryQuery = useQuery({
    queryKey: ["member", "follow-summary", targetMemberId, member.generation],
    enabled: isOwnAndLoggedIn && targetMemberId > 0,
    queryFn: async ({ signal }) =>
      parseFollowSummary(
        await session.request(`/members/${targetMemberId}/follows`, { signal }),
        targetMemberId,
      ),
  });

  const symbolsQuery = useQuery({
    queryKey: ["trading", "symbols", tradingBase],
    enabled: isOwnAndLoggedIn,
    staleTime: 60_000,
    queryFn: async ({ signal }) => parseSymbols(await marketSymbolsJson(tradingBase, signal)),
  });

  const symbolById = useMemo(() => {
    const map = new Map<number, TradingSymbol>();
    for (const sym of symbolsQuery.data ?? []) {
      map.set(sym.id, sym);
    }
    return map;
  }, [symbolsQuery.data]);

  const exactFilterSymbolId = useMemo(() => {
    const keyword = filterSymbol.trim().toUpperCase().replace(/USDT$/i, "");
    if (!keyword || !symbolsQuery.data) return undefined;
    const exact = symbolsQuery.data.find(
      item => item.symbol.toUpperCase().replace(/USDT$/i, "") === keyword,
    );
    return exact?.id;
  }, [filterSymbol, symbolsQuery.data]);

  // [T-1] 공개 포트폴리오 API 조회
  const publicPortfolioQuery = useQuery({
    queryKey: ["member", "public-portfolio", targetMemberId, tradingBase, member.generation],
    enabled: targetMemberId > 0,
    queryFn: async ({ signal }) =>
      parsePublicMemberPortfolio(
        await tradingJson(tradingBase, `portfolios/members/${targetMemberId}`, { signal }),
      ),
  });

  // 시즌별 대회 참가 자산 및 정산 이력 API 조회
  const memberContestSeasonsQuery = useQuery({
    queryKey: [
      "member",
      "contest-seasons",
      targetMemberId,
      isOwnAndLoggedIn,
      tradingBase,
      member.generation,
    ],
    enabled: targetMemberId > 0,
    queryFn: async ({ signal }) =>
      isOwnAndLoggedIn
        ? session.authorized(cred =>
            fetchMyContestSeasons(cred.accessToken, { baseUrl: tradingBase, signal }),
          )
        : fetchPublicMemberContestSeasons(targetMemberId, { baseUrl: tradingBase, signal }),
  });

  // 본인 로그인 시 5대 원장 실시간 API 조회 (계좌 미개설 409 시 불필요 재시도 방지)
  const ownerOrdersQuery = useQuery({
    queryKey: [
      "member",
      "trading-orders",
      member.memberId,
      member.generation,
      exactFilterSymbolId ?? null,
      filterSide,
      filterStatus,
    ],
    enabled: isOwnAndLoggedIn && activeMainTab === "mock-assets" && detailTab === "orders",
    retry: false,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (exactFilterSymbolId !== undefined) {
        params.set("tradingSymbolId", String(exactFilterSymbolId));
      }
      if (filterSide === "BUY") params.set("side", "LONG");
      else if (filterSide === "SELL") params.set("side", "SHORT");
      if (filterStatus === "COMPLETED") params.set("status", "FILLED");
      else if (
        filterStatus === "PENDING" ||
        filterStatus === "CANCELED" ||
        filterStatus === "REJECTED"
      ) {
        params.set("status", filterStatus);
      }
      return session.authorized(cred =>
        tradingJson(tradingBase, `account/orders?${params.toString()}`, {
          token: cred.accessToken,
          signal,
        }),
      ) as Promise<Array<Record<string, unknown>>>;
    },
  });

  const ownerFillsQuery = useQuery({
    queryKey: ["member", "trading-fills", member.memberId, member.generation],
    enabled: isOwnAndLoggedIn && activeMainTab === "mock-assets" && detailTab === "trades",
    retry: false,
    queryFn: async ({ signal }) =>
      session.authorized(cred =>
        tradingJson(tradingBase, "account/fills?limit=50", { token: cred.accessToken, signal }),
      ) as Promise<Array<Record<string, unknown>>>,
  });

  const ownerClosedPositionsQuery = useQuery({
    queryKey: ["member", "trading-closed-positions", member.memberId, member.generation],
    enabled: isOwnAndLoggedIn && activeMainTab === "mock-assets" && detailTab === "pnl",
    retry: false,
    queryFn: async ({ signal }) =>
      session.authorized(cred =>
        tradingJson(tradingBase, "account/positions/history?limit=50", {
          token: cred.accessToken,
          signal,
        }),
      ) as Promise<Record<string, unknown>>,
  });

  const ownerPendingOrdersQuery = useQuery({
    queryKey: ["member", "trading-pending-orders", member.memberId, member.generation],
    enabled: isOwnAndLoggedIn && activeMainTab === "mock-assets",
    retry: false,
    queryFn: async ({ signal }) =>
      session.authorized(cred =>
        tradingJson(tradingBase, "account/orders/pending", { token: cred.accessToken, signal }),
      ) as Promise<Array<Record<string, unknown>>>,
  });

  // 팔로워/팔로잉 모달 실데이터 커서 페이지네이션 조회 (백엔드 최대 size=10 준수)
  const followModalInfinite = useInfiniteQuery({
    queryKey: ["member", "follow-modal", targetMemberId, followModalType, member.generation],
    enabled: followModalType !== null && targetMemberId > 0,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      const path = `/members/${targetMemberId}/${followModalType}?${search.toString()}`;
      const raw = isOwnAndLoggedIn
        ? await session.request(path, { signal })
        : await contentJson(origin, path, { signal });
      return parseFollowPage(raw);
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  // [C-6] 커뮤니티활동 커서 기반 무한스크롤 (커뮤니티 탭 진입 시에만 요청)
  const communityPostsInfinite = useInfiniteQuery({
    queryKey: ["member", "community-posts", targetMemberId, member.generation],
    enabled: targetMemberId > 0 && activeMainTab === "community" && communityTab === "posts",
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      const basePath = isOwnAndLoggedIn
        ? `/members/me/community/posts?${search.toString()}`
        : `/members/${targetMemberId}/community/posts?${search.toString()}`;
      return parseCommunityPostPage(
        await readCommunityOrPublic(origin, session, member, basePath, signal),
      );
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const communityCommentsInfinite = useInfiniteQuery({
    queryKey: ["member", "community-comments", targetMemberId, member.generation],
    enabled: targetMemberId > 0 && activeMainTab === "community" && communityTab === "replies",
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      const basePath = isOwnAndLoggedIn
        ? `/members/me/community/comments?${search.toString()}`
        : `/members/${targetMemberId}/community/comments?${search.toString()}`;
      return parseMemberCommunityCommentPage(
        await readCommunityOrPublic(origin, session, member, basePath, signal),
      );
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const communityLikedPostsInfinite = useInfiniteQuery({
    queryKey: ["member", "community-liked-posts", targetMemberId, member.generation],
    enabled: targetMemberId > 0 && activeMainTab === "community" && communityTab === "likedPosts",
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      const basePath = isOwnAndLoggedIn
        ? `/members/me/community/liked-posts?${search.toString()}`
        : `/members/${targetMemberId}/community/liked-posts?${search.toString()}`;
      return parseCommunityPostPage(
        await readCommunityOrPublic(origin, session, member, basePath, signal),
      );
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const communityLikedCommentsInfinite = useInfiniteQuery({
    queryKey: ["member", "community-liked-comments", targetMemberId, member.generation],
    enabled:
      targetMemberId > 0 && activeMainTab === "community" && communityTab === "likedReplies",
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      const basePath = isOwnAndLoggedIn
        ? `/members/me/community/liked-comments?${search.toString()}`
        : `/members/${targetMemberId}/community/liked-comments?${search.toString()}`;
      return parseMemberCommunityCommentPage(
        await readCommunityOrPublic(origin, session, member, basePath, signal),
      );
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const communityReportsInfinite = useInfiniteQuery({
    queryKey: ["member", "community-reports", member.memberId, member.generation],
    enabled: isOwnAndLoggedIn && activeMainTab === "community" && communityTab === "reports",
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      return parseMemberCommunityReportPage(
        await session.request(`/members/me/community/reports?${search.toString()}`, { signal }),
      );
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const cancelReportMutation = useMutation({
    mutationFn: async (item: { targetType: "POST" | "COMMENT"; targetId: number; id: number }) => {
      const endpoint =
        item.targetType === "POST"
          ? `/community/posts/${item.targetId}/reports`
          : `/community/comments/${item.targetId}/reports`;
      return parseCommunityReport(await session.request(endpoint, { method: "DELETE" }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["member", "community-reports", member.memberId],
      });
    },
  });

  const nickname = profileQuery.data?.nickname ?? member.nickname ?? "게스트";
  const profileMsg = isOwnAndLoggedIn
    ? (profileQuery.data?.profileMessage || "등록된 상태메시지가 없습니다.")
    : "로그인하면 내 모의투자 원장과 대회 자산, 커뮤니티 활동을 관리할 수 있습니다.";
  const followerCount = followSummaryQuery.data?.followerCount ?? 0;
  const followingCount = followSummaryQuery.data?.followingCount ?? 0;

  // 커뮤니티활동 무한스크롤 IntersectionObserver 연동
  const activeInfinite =
    communityTab === "posts"
      ? communityPostsInfinite
      : communityTab === "replies"
        ? communityCommentsInfinite
        : communityTab === "likedPosts"
          ? communityLikedPostsInfinite
          : communityTab === "likedReplies"
            ? communityLikedCommentsInfinite
            : communityReportsInfinite;

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      activeMainTab !== "community" ||
      !activeInfinite.hasNextPage ||
      activeInfinite.isFetchingNextPage
    ) {
      return;
    }
    const node = communitySentinelRef.current;
    if (!node || typeof window.IntersectionObserver !== "function") return;
    const observer = new window.IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          void activeInfinite.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  });

  const livePortfolio =
    publicPortfolioQuery.data && publicPortfolioQuery.data.accountExists
      ? publicPortfolioQuery.data
      : null;

  const liveContestParticipations =
    memberContestSeasonsQuery.data?.participatingSeasons ??
    (memberContestSeasonsQuery.data?.activeSeason
      ? [memberContestSeasonsQuery.data.activeSeason]
      : []);

  const finishedContestSeasonsDisplay = (memberContestSeasonsQuery.data?.pastSeasons ?? []).map(
    item => ({
      seasonId: String(item.seasonId),
      seasonTitle: item.title,
      period: `${formatContestDateOnly(item.contestStartAt)} ~ ${formatContestDateOnly(item.contestEndAt)}`,
      seedMoney: formatContestUsdt(item.seedMoney),
      finalEquity: formatContestUsdt(item.totalEquity),
      finalRoi: formatContestSignedRoi(item.roiPct),
      finalRank: `${item.rank ?? "-"}위 / ${item.totalParticipants}명`,
      winRate: item.winRate !== undefined ? formatContestWinRate(item.winRate) : "-",
      status: item.statusLabel || "정산완료",
    }),
  );

  const displayPositions = useMemo(
    () =>
      livePortfolio
        ? livePortfolio.positions.map((pos, idx) => ({
            id: pos.id,
            symbol: pos.symbol,
            nameKr: symbolNameKr(pos.symbol),
            side: pos.side,
            leverage: pos.leverage,
            quantity: formatExchangeQuantity(pos.quantity, pos.symbol.replace(/USDT$/i, "")),
            entryPrice: formatExchangePrice(pos.entryPrice),
            markPrice: formatExchangePrice(pos.markPrice),
            liqPrice: pos.liquidationPrice ? formatExchangePrice(pos.liquidationPrice) : "-",
            margin: formatExchangeUsdt(pos.margin),
            pnl: formatSignedUsdt(pos.unrealizedPnl),
            roe: formatSignedPct(pos.roePct),
            isPositive: isNonNegativeDecimal(pos.unrealizedPnl),
            marginRatio: Math.max(0, Math.min(100, Number(pos.marginRatioPct) || 0)),
            marginRatioLabel: formatExchangePct(pos.marginRatioPct, 2),
            color: POSITION_COLORS[idx % POSITION_COLORS.length],
          }))
        : [],
    [livePortfolio],
  );

  const donutSegments = useMemo(() => {
    const activePositions = displayPositions.filter(pos => pos.marginRatio > 0);
    return activePositions.reduce<Array<{ key: string; color: string; pct: number; offset: number }>>(
      (acc, pos) => {
        const currentOffset = acc.reduce((sum, item) => sum + item.pct, 0);
        const pct = Math.min(pos.marginRatio, Math.max(0, 100 - currentOffset));
        return [
          ...acc,
          {
            key: `${pos.id}-${pos.side}`,
            color: pos.color,
            pct,
            offset: currentOffset,
          },
        ];
      },
      [],
    );
  }, [displayPositions]);

  const usedMarginRatioDisplay = livePortfolio
    ? formatExchangePct(livePortfolio.allocation.usedMarginRatioPct, 2)
    : "0.0%";
  const availableCashRatioDisplay = livePortfolio
    ? formatExchangePct(livePortfolio.allocation.availableCashRatioPct, 2)
    : "100.0%";
  const longRatioDisplay = livePortfolio ? formatExchangeCompactPct(livePortfolio.allocation.longRatioPct).replace(/%$/, "") : "0";
  const shortRatioDisplay = livePortfolio ? formatExchangeCompactPct(livePortfolio.allocation.shortRatioPct).replace(/%$/, "") : "0";
  const longMarginDisplay = livePortfolio
    ? formatExchangeUsdt(livePortfolio.allocation.longMarginUsdt)
    : "0.00 USDT";
  const shortMarginDisplay = livePortfolio
    ? formatExchangeUsdt(livePortfolio.allocation.shortMarginUsdt)
    : "0.00 USDT";
  const longCountDisplay = livePortfolio ? livePortfolio.allocation.longPositionCount : 0;
  const shortCountDisplay = livePortfolio ? livePortfolio.allocation.shortPositionCount : 0;
  const usedMarginTotalDisplay = livePortfolio
    ? formatExchangeUsdt(livePortfolio.wallet.usedMargin)
    : "0.00 USDT";
  const availableBalanceDisplay = livePortfolio
    ? formatExchangeUsdt(livePortfolio.wallet.availableBalance)
    : "0.00 USDT";
  const winRateDisplay = livePortfolio
    ? `${formatExchangePct(livePortfolio.closedTradeSummary.winRatePct, 2)} (${livePortfolio.closedTradeSummary.winCount}승 ${livePortfolio.closedTradeSummary.lossCount}패)`
    : "0.0% (0승 0패)";
  const avgLeverageDisplay =
    displayPositions.length > 0
      ? `${(
          displayPositions.reduce((sum, item) => sum + item.leverage, 0) / displayPositions.length
        ).toFixed(1)}x`
      : "—";

  const assetSummary = livePortfolio
    ? {
        title: "모의투자 선물 지갑",
        totalAsset: formatExchangeUsdt(livePortfolio.wallet.totalEquity),
        cashBalance: formatExchangeUsdt(livePortfolio.wallet.availableBalance),
        totalBuyAmount: formatExchangeUsdt(livePortfolio.wallet.usedMargin),
        totalCoinValue: formatExchangeUsdt(livePortfolio.wallet.balance),
        totalProfit: formatSignedUsdt(livePortfolio.wallet.totalPnl),
        totalRoi: formatSignedPct(livePortfolio.wallet.totalRoiPct),
        isPositive:
          !livePortfolio.wallet.totalPnl.trim().startsWith("-") &&
          /[1-9]/.test(livePortfolio.wallet.totalPnl),
        isNegative: livePortfolio.wallet.totalPnl.trim().startsWith("-"),
        unit: "USDT",
      }
    : {
        title: "모의투자 선물 지갑",
        totalAsset: "0.00 USDT",
        cashBalance: "0.00 USDT",
        totalBuyAmount: "0.00 USDT",
        totalCoinValue: "0.00 USDT",
        totalProfit: "0.00 USDT",
        totalRoi: "0.00%",
        isPositive: false,
        isNegative: false,
        unit: "USDT",
      };

  // 원장 주문 내역 바인딩 (tradingSymbolId + fill 서브객체 정확 매핑)
  const liveOrders = useMemo(() => {
    if (!ownerOrdersQuery.data) return [];
    return ownerOrdersQuery.data.map((row, idx) => {
      const sym = resolveRowSymbol(row, symbolById);
      const sideRaw = String(row.side ?? "LONG");
      const actionRaw = String(row.action ?? "OPEN");
      const { isBuy, label: sideLabel } = formatActionSideLabel(sideRaw, actionRaw);
      const typeRaw = String(row.type ?? "MARKET");
      const statusRaw = String(row.status ?? "FILLED");
      const normalizedStatus =
        statusRaw === "FILLED"
          ? "COMPLETED"
          : statusRaw === "CANCELLED"
            ? "CANCELED"
            : statusRaw;
      const fillObj =
        row.fill && typeof row.fill === "object" ? (row.fill as Record<string, unknown>) : null;
      const rawCreatedAt = String(row.createdAt ?? row.orderedAt ?? "");
      const filledQtyRaw =
        fillObj?.quantity ??
        row.filledQuantity ??
        (normalizedStatus === "COMPLETED" ? row.quantity : "0");
      const avgPriceRaw = fillObj?.price ?? row.executionPrice ?? row.averageFillPrice;
      return {
        id:
          typeof row.orderId === "number"
            ? row.orderId
            : typeof row.id === "number"
              ? row.id
              : idx + 1,
        rawCreatedAt,
        orderedAt: formatKstDateTimeShort(rawCreatedAt),
        symbol: sym.pair,
        nameKr: sym.nameKr,
        filterSideKey: sideRaw === "LONG" || sideRaw === "BUY" ? "BUY" : "SELL",
        side: isBuy ? "BUY" : "SELL",
        sideLabel,
        orderType: typeRaw,
        orderStatus: normalizedStatus,
        reason: typeof row.reason === "string" ? row.reason : null,
        orderPrice:
          typeRaw === "MARKET" ? "시장가" : `${formatExchangePrice(String(row.limitPrice ?? row.price ?? "0"), sym.tickSize)} USDT`,
        orderQuantity: formatExchangeQuantity(String(row.quantity ?? "0"), sym.base),
        filledQuantity: formatExchangeQuantity(String(filledQtyRaw ?? "0"), sym.base),
        avgFilledPrice: avgPriceRaw ? `${formatExchangePrice(String(avgPriceRaw), sym.tickSize)} USDT` : "-",
      };
    });
  }, [ownerOrdersQuery.data, symbolById]);

  const filteredOrders = useMemo(() => {
    return liveOrders.filter(item => {
      if (filterSymbol.trim()) {
        const kw = filterSymbol.trim().toUpperCase();
        if (!item.symbol.includes(kw) && !item.nameKr.toUpperCase().includes(kw)) return false;
      }
      if (filterSide && item.filterSideKey !== filterSide) return false;
      if (filterStatus && item.orderStatus !== filterStatus) return false;
      if (filterStartDate && item.rawCreatedAt) {
        if (toKstDateOnly(item.rawCreatedAt) < filterStartDate) return false;
      }
      if (filterEndDate && item.rawCreatedAt) {
        if (toKstDateOnly(item.rawCreatedAt) > filterEndDate) return false;
      }
      return true;
    });
  }, [liveOrders, filterSymbol, filterSide, filterStatus, filterStartDate, filterEndDate]);

  const openOrders = useMemo(() => {
    if (!ownerPendingOrdersQuery.data) return [];
    return ownerPendingOrdersQuery.data.map((row, idx) => {
      const sym = resolveRowSymbol(row, symbolById);
      const sideRaw = String(row.side ?? "LONG");
      const actionRaw = String(row.action ?? "OPEN");
      const { isBuy, label: sideLabel } = formatActionSideLabel(sideRaw, actionRaw);
      const rawCreatedAt = String(row.createdAt ?? "");
      return {
        id:
          typeof row.orderId === "number"
            ? row.orderId
            : typeof row.id === "number"
              ? row.id
              : idx + 1,
        orderedAt: formatKstDateTimeShort(rawCreatedAt),
        symbol: sym.pair,
        nameKr: sym.nameKr,
        side: isBuy ? "BUY" : "SELL",
        sideLabel,
        orderType: String(row.type ?? "LIMIT"),
        orderStatus: "PENDING",
        orderPrice: `${formatExchangePrice(String(row.limitPrice ?? row.price ?? "0"), sym.tickSize)} USDT`,
        orderQuantity: formatExchangeQuantity(String(row.quantity ?? "0"), sym.base),
        filledQuantity: `0 ${sym.base}`,
        avgFilledPrice: "-",
      };
    });
  }, [ownerPendingOrdersQuery.data, symbolById]);

  const closedPnlRows = useMemo(() => {
    const rawItems =
      ownerClosedPositionsQuery.data && Array.isArray(ownerClosedPositionsQuery.data.items)
        ? (ownerClosedPositionsQuery.data.items as Array<Record<string, unknown>>)
        : null;
    if (!rawItems) return [];
    return rawItems.map((row, idx) => {
      const sym = resolveRowSymbol(row, symbolById);
      const netPnl = String(row.netRealizedPnl ?? row.netPnl ?? row.realizedPnl ?? "0");
      const roeRaw =
        typeof row.roePct === "string"
          ? row.roePct
          : computeRoePctString(netPnl, String(row.initialMargin ?? "0"));
      const qtyRaw = String(row.initialQuantity ?? row.closedQuantity ?? row.quantity ?? "0");
      const statusRaw = String(row.status ?? "CLOSED");
      return {
        id: typeof row.positionId === "number" ? row.positionId : idx + 1,
        closedAt: formatKstDateTimeShort(String(row.closedAt ?? "")),
        symbol: sym.pair,
        nameKr: sym.fullNameKr,
        side: String(row.side ?? "LONG"),
        status: statusRaw,
        leverage: typeof row.leverage === "number" ? row.leverage : 1,
        entryPrice: formatExchangePrice(String(row.entryPrice ?? "0"), sym.tickSize),
        exitPrice: formatExchangePrice(String(row.exitPrice ?? row.closePrice ?? "0"), sym.tickSize),
        quantity: formatExchangeQuantity(qtyRaw, sym.base),
        realizedPnl: formatSignedUsdt(netPnl),
        roe: formatSignedPct(roeRaw),
        isPositive: isNonNegativeDecimal(netPnl),
      };
    });
  }, [ownerClosedPositionsQuery.data, symbolById]);

  const tradeRows = useMemo(() => {
    if (!ownerFillsQuery.data) return [];
    return ownerFillsQuery.data.map((row, idx) => {
      const sym = resolveRowSymbol(row, symbolById);
      const sideRaw = String(row.side ?? "LONG");
      const actionRaw = String(row.action ?? "OPEN");
      const { isBuy, label: sideLabel } = formatActionSideLabel(sideRaw, actionRaw);
      const priceRaw = String(row.price ?? row.executionPrice ?? "0");
      const qtyRaw = String(row.quantity ?? "0");
      const notionalStr =
        typeof row.notional === "string"
          ? row.notional
          : multiplyDecimalStrings(priceRaw, qtyRaw, 2);
      const pnlRaw = String(row.realizedPnl ?? "0");
      return {
        id: typeof row.fillId === "number" ? row.fillId : idx + 1,
        executedAt: formatKstDateTimeShort(String(row.executedAt ?? "")),
        symbol: sym.pair,
        nameKr: sym.nameKr,
        side: isBuy ? "BUY" : "SELL",
        sideLabel,
        price: `${formatExchangePrice(priceRaw, sym.tickSize)} USDT`,
        quantity: formatExchangeQuantity(qtyRaw, sym.base),
        totalAmount: formatExchangeUsdt(notionalStr),
        fee: formatExchangeFeeUsdt(String(row.fee ?? "0")),
        realizedProfit: formatSignedUsdt(pnlRaw),
      };
    });
  }, [ownerFillsQuery.data, symbolById]);

  const modalFollowList: FollowMemberItem[] = useMemo(() => {
    if (!followModalInfinite.data) return [];
    return followModalInfinite.data.pages
      .flatMap(page => page.content)
      .map(entry => {
        const defaultFollowing = entry.followedByMe ?? (followModalType === "followings");
        return {
          memberId: entry.memberId,
          nickname: entry.nickname,
          profileMsg: entry.profileMessage || "등록된 소개가 없습니다.",
          profileImgUrl: entry.profileImgUrl,
          following: followOverrides[entry.memberId] ?? defaultFollowing,
          followsMe: followModalType === "followers",
        };
      });
  }, [followModalInfinite.data, followModalType, followOverrides]);

  function toggleFollowInModal(person: FollowMemberItem) {
    if (!isOwnAndLoggedIn) return;
    const currentlyFollowing = person.following;
    setFollowOverrides(prev => ({ ...prev, [person.memberId]: !currentlyFollowing }));
    const nextMethod = currentlyFollowing ? "DELETE" : "PUT";
    void session
      .request(`/members/${person.memberId}/follows`, { method: nextMethod })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["member", "follow-modal"] });
        void queryClient.invalidateQueries({ queryKey: ["member", "follow-summary"] });
        void queryClient.invalidateQueries({ queryKey: ["member", "profile"] });
      })
      .catch(() => {
        setFollowOverrides(prev => ({ ...prev, [person.memberId]: currentlyFollowing }));
      });
  }

  const liveMyPosts: CommunityPost[] = communityPostsInfinite.data
    ? communityPostsInfinite.data.pages.flatMap(p => p.items)
    : [];
  const liveMyComments: MemberCommunityCommentItem[] = communityCommentsInfinite.data
    ? communityCommentsInfinite.data.pages.flatMap(p => p.items)
    : [];
  const liveLikedPosts: CommunityPost[] = communityLikedPostsInfinite.data
    ? communityLikedPostsInfinite.data.pages.flatMap(p => p.items)
    : [];
  const liveLikedComments: MemberCommunityCommentItem[] = communityLikedCommentsInfinite.data
    ? communityLikedCommentsInfinite.data.pages.flatMap(p => p.items)
    : [];
  const liveReports: MemberCommunityReportItem[] = communityReportsInfinite.data
    ? communityReportsInfinite.data.pages.flatMap(p => p.items)
    : [];

  return (
    <MemberShell
      title="마이페이지"
      subtitle="내 모의투자 자산, 시즌별 대회 자산, 포트폴리오 및 커뮤니티 활동을 통합 관리합니다."
      variant="wide"
      hideCardHeading
    >
      <div className="mx-auto max-w-[1280px]">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* 좌측 컬럼 (lg:col-span-4): ProfileSidebar + AssetSummaryCard + 회원탈퇴 */}
          <div className="min-w-0 space-y-6 lg:col-span-4">
            <V1ProfileSidebar
              profile={{
                memberId: targetMemberId || undefined,
                nickname,
                profileMsg,
                profileImgUrl:
                  profileQuery.data?.profileImgUrl ?? profileQuery.data?.profileImageUrl,
                role: member.role === "ADMIN" ? "ADMIN" : "USER",
                followerCount: isOwnAndLoggedIn ? followerCount : 0,
                followingCount: isOwnAndLoggedIn ? followingCount : 0,
              }}
              onClickFollowers={() => {
                if (isOwnAndLoggedIn) setFollowModalType("followers");
              }}
              onClickFollowings={() => {
                if (isOwnAndLoggedIn) setFollowModalType("followings");
              }}
              actionArea={
                isOwnAndLoggedIn ? (
                  <div className="space-y-2">
                    <Link
                      href="/me/settings"
                      className="flex h-10 w-full items-center justify-center whitespace-nowrap rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      회원정보 수정
                    </Link>
                    <button
                      type="button"
                      onClick={() => void session.logout()}
                      className="flex h-9 w-full items-center justify-center whitespace-nowrap rounded-xl bg-gray-100 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-200"
                    >
                      로그아웃
                    </button>
                  </div>
                ) : null
              }
            />

            <V1AssetSummaryCard
              summary={assetSummary}
              footerSlot={
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">
                    {livePortfolio && livePortfolio.roundNumber > 0
                      ? `${livePortfolio.roundNumber}회차 시드머니: ${formatExchangeSeedUsdt(livePortfolio.initialSeed)}`
                      : "시드머니: 10,000 USDT"}
                  </span>
                  <Link href="/trading" className="font-bold text-blue-400 hover:underline">
                    모의투자 하러가기 →
                  </Link>
                </div>
              }
            />

            {isOwnAndLoggedIn && (
              <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 py-3.5 text-xs">
                <span className="font-medium text-gray-500">계정 관리 및 약관 동의 철회</span>
                <Link
                  href="/me/settings#withdrawal"
                  className="font-bold text-gray-400 hover:text-red-500"
                >
                  회원 탈퇴 안내 →
                </Link>
              </div>
            )}
          </div>

          {/* 우측 컬럼 (lg:col-span-8): 권한별 4대 메인 탭 / 2대 메인 탭 */}
          <div className="min-w-0 space-y-6 lg:col-span-8">
            <div data-mypage-bookmark-nav="true">
              <V1Tabs
                tabs={visibleMainTabs}
                activeTab={activeMainTab}
                onChange={val => setSelectedTab(val as MyPageMainTab)}
                variant="bookmark"
              />
            </div>

            {/* [탭 1] 내 모의투자 자산 (로그인 본인 전용) */}
            {isOwnAndLoggedIn && activeMainTab === "mock-assets" && (
              <div className="space-y-6" data-mypage-panel="mock-assets">
                {/* 상단: 자산 구성 도넛 차트 + 롱/숏 포지션 비율 + 회차 관리 */}
                <div className="card rounded-2xl border border-gray-200 bg-white p-6 space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-black text-gray-900">
                        내 모의투자 자산 및 증거금 구성
                      </h3>
                      <p className="mt-0.5 text-xs text-gray-500">
                        가상 USDT 기반 선물 모의투자 원장 및 실시간 증거금 비중을 확인합니다.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {/* 도넛 차트 */}
                    <div className="rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                      <h4 className="mb-4 text-sm font-black text-gray-900">
                        포지션 증거금 비중 (%)
                      </h4>
                      <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                        <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
                          <svg viewBox="0 0 36 36" className="h-36 w-36 -rotate-90">
                            <circle
                              cx="18"
                              cy="18"
                              r="14"
                              fill="none"
                              stroke="#E5E7EB"
                              strokeWidth="4.5"
                            />
                            {donutSegments.map(seg => (
                              <circle
                                key={seg.key}
                                cx="18"
                                cy="18"
                                r="14"
                                pathLength={100}
                                fill="none"
                                stroke={seg.color}
                                strokeWidth="4.5"
                                strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
                                strokeDashoffset={-seg.offset}
                              />
                            ))}
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                            <span className="text-[10px] font-bold text-gray-400">증거금 비중</span>
                            <strong className="text-base font-black text-gray-900">
                              {usedMarginRatioDisplay}
                            </strong>
                          </div>
                        </div>
                        <ul className="w-full flex-1 space-y-2 text-xs">
                          {displayPositions.map(pos => (
                            <li
                              key={`${pos.id}-${pos.side}`}
                              className="flex items-center justify-between"
                            >
                              <span className="flex items-center gap-2 font-bold text-gray-700">
                                <span
                                  className="inline-block h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: pos.color }}
                                />
                                {pos.symbol} ({pos.side})
                              </span>
                              <span className="font-black text-gray-900 tabular-nums">{pos.marginRatioLabel}</span>
                            </li>
                          ))}
                          <li className="flex items-center justify-between border-t border-gray-200 pt-1.5">
                            <span className="flex items-center gap-2 font-bold text-gray-500">
                              <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-300" />
                              가용 USDT
                            </span>
                            <span className="font-black text-gray-600">
                              {availableCashRatioDisplay}
                            </span>
                          </li>
                        </ul>
                      </div>
                    </div>

                    {/* 롱 / 숏 비율 바 */}
                    <div className="flex flex-col justify-between rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                      <div>
                        <h4 className="mb-1 text-sm font-black text-gray-900">롱 / 숏 포지션 비율</h4>
                        <p className="text-xs text-gray-500">
                          오픈된 선물 포지션의 매수(Long) / 매도(Short) 증거금 밸런스입니다.
                        </p>
                      </div>
                      <div className="my-4 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] sm:text-xs font-black">
                          <span className="text-red-500">
                            LONG {longRatioDisplay}% ({longMarginDisplay})
                          </span>
                          <span className="text-blue-600">
                            SHORT {shortRatioDisplay}% ({shortMarginDisplay})
                          </span>
                        </div>
                        <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full bg-red-500"
                            style={{ width: `${longRatioDisplay}%` }}
                          />
                          <div
                            className="h-full bg-blue-600"
                            style={{ width: `${shortRatioDisplay}%` }}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 border-t border-gray-200 pt-3 text-xs tabular-nums">
                        <div>
                          <span className="text-gray-400">사용 증거금 합계</span>
                          <p className="font-black text-gray-900">{usedMarginTotalDisplay}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-gray-400">가용 증거금</span>
                          <p className="font-black text-[#0058FF]">{availableBalanceDisplay}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 회차 재시작 (MemberSimulation) 연동 */}
                  {member.consentStatus === "accepted" && (
                    <div className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4">
                      <TradingDataProvider>
                        <MemberSimulation />
                      </TradingDataProvider>
                    </div>
                  )}
                </div>

                {/* 하단: 5대 원장 상세 FolderTabs (포지션 현황 | 손익현황 | 주문내역 | 거래내역 | 미체결내역) */}
                <V1FolderTabs
                  tabs={[
                    { id: "holdings", label: "포지션 현황" },
                    { id: "pnl", label: "손익현황" },
                    { id: "orders", label: "주문내역" },
                    { id: "trades", label: "거래내역" },
                    { id: "open", label: `미체결내역 (${openOrders.length})` },
                  ]}
                  activeId={detailTab}
                  onChange={id => setDetailTab(id as LedgerDetailTab)}
                >
                  {detailTab === "holdings" && (
                    <div className="space-y-4">
                      <div className="overflow-x-auto rounded-2xl border border-gray-200">
                        <table className="w-full min-w-[680px] text-left text-xs">
                          <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                            <tr>
                              <th className="px-4 py-3.5">종목 / 배율</th>
                              <th className="px-4 py-3.5">포지션</th>
                              <th className="px-4 py-3.5 text-right">포지션 수량</th>
                              <th className="px-4 py-3.5 text-right">진입가격</th>
                              <th className="px-4 py-3.5 text-right">마크가격</th>
                              <th className="px-4 py-3.5 text-right">청산예상가</th>
                              <th className="px-4 py-3.5 text-right">투입 증거금</th>
                              <th className="px-4 py-3.5 text-right">평가손익 (ROE)</th>
                              <th className="px-4 py-3.5 text-right">공유</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {displayPositions.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={9}
                                  className="px-4 py-10 text-center text-xs font-bold text-gray-400"
                                >
                                  {publicPortfolioQuery.isLoading
                                    ? "포지션 현황을 불러오는 중입니다…"
                                    : "현재 보유 중인 선물 포지션이 없습니다."}
                                </td>
                              </tr>
                            ) : (
                              displayPositions.map(pos => (
                                <tr key={`${pos.id}-${pos.side}`} className="hover:bg-gray-50">
                                  <td className="px-4 py-3.5 font-black text-gray-900">
                                    <div>{pos.nameKr}</div>
                                    <div className="text-[11px] font-bold text-gray-400">
                                      {pos.symbol} · 격리 {pos.leverage}x
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5">
                                    <span
                                      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-black ${
                                        pos.side === "LONG"
                                          ? "bg-red-50 text-red-500"
                                          : "bg-blue-50 text-blue-600"
                                      }`}
                                    >
                                      {pos.side}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-bold text-gray-800">
                                    {pos.quantity}
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-medium text-gray-600">
                                    ${pos.entryPrice}
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-bold text-gray-900">
                                    ${pos.markPrice}
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-semibold text-amber-600">
                                    {pos.liqPrice === "-" ? "-" : `$${pos.liqPrice}`}
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-bold text-gray-700">
                                    {pos.margin}
                                  </td>
                                  <td
                                    className={`px-4 py-3.5 text-right font-black ${pnlColorText(pos.pnl)}`}
                                  >
                                    <div>{pos.pnl}</div>
                                    <div className="text-[11px]">{pos.roe}</div>
                                  </td>
                                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                    <Link
                                      href={`/community/all?sharePosition=MOCK_POS_${pos.id}`}
                                      className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-bold text-[#0058FF] transition-colors hover:bg-blue-100"
                                    >
                                      포지션 공유
                                    </Link>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs font-semibold leading-relaxed text-blue-700">
                        {ZERO_QUANTITY_NOTICE_TEXT}
                      </div>
                    </div>
                  )}

                  {detailTab === "pnl" && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4">
                          <span className="text-xs font-bold text-gray-400">누적 실현손익</span>
                          <p
                            className={`mt-1 text-xl font-black ${pnlColorText(
                              livePortfolio
                                ? formatSignedUsdt(livePortfolio.wallet.realizedPnl)
                                : "0.00 USDT",
                            )}`}
                          >
                            {livePortfolio
                              ? formatSignedUsdt(livePortfolio.wallet.realizedPnl)
                              : "0.00 USDT"}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4">
                          <span className="text-xs font-bold text-gray-400">미실현 평가손익</span>
                          <p
                            className={`mt-1 text-xl font-black ${pnlColorText(
                              livePortfolio
                                ? formatSignedUsdt(livePortfolio.wallet.unrealizedPnl)
                                : "0.00 USDT",
                            )}`}
                          >
                            {livePortfolio
                              ? formatSignedUsdt(livePortfolio.wallet.unrealizedPnl)
                              : "0.00 USDT"}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4">
                          <span className="text-xs font-bold text-gray-400">청산/종료 승률</span>
                          <p className="mt-1 text-xl font-black text-[#0058FF]">
                            {winRateDisplay}
                          </p>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-2xl border border-gray-200">
                        <table className="w-full min-w-[680px] text-left text-xs">
                          <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                            <tr>
                              <th className="px-4 py-3.5">종료 시각</th>
                              <th className="px-4 py-3.5">종목 / 배율</th>
                              <th className="px-4 py-3.5">포지션</th>
                              <th className="px-4 py-3.5 text-right">진입가격</th>
                              <th className="px-4 py-3.5 text-right">종료가격</th>
                              <th className="px-4 py-3.5 text-right">청산수량</th>
                              <th className="px-4 py-3.5 text-right">순실현손익 (ROE)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {closedPnlRows.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={7}
                                  className="px-4 py-10 text-center text-xs font-bold text-gray-400"
                                >
                                  {ownerClosedPositionsQuery.isLoading
                                    ? "손익현황을 불러오는 중입니다…"
                                    : "종료된 포지션 손익 이력이 없습니다."}
                                </td>
                              </tr>
                            ) : (
                              closedPnlRows.map(row => (
                                <tr key={row.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-3.5 text-gray-500">{row.closedAt}</td>
                                  <td className="px-4 py-3.5 font-bold text-gray-900">
                                    {row.nameKr} ({row.symbol} · {row.leverage}x)
                                  </td>
                                  <td className="px-4 py-3.5">
                                    <span
                                      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-black ${
                                        row.side === "LONG"
                                          ? "bg-red-50 text-red-500"
                                          : "bg-blue-50 text-blue-600"
                                      }`}
                                    >
                                      {row.side}
                                      {row.status === "LIQUIDATED" ? " · 강제청산" : ""}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3.5 text-right">${row.entryPrice}</td>
                                  <td className="px-4 py-3.5 text-right font-bold">
                                    ${row.exitPrice}
                                  </td>
                                  <td className="px-4 py-3.5 text-right">{row.quantity}</td>
                                  <td
                                    className={`px-4 py-3.5 text-right font-black ${pnlColorText(
                                      row.realizedPnl,
                                    )}`}
                                  >
                                    {row.realizedPnl} ({row.roe})
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {detailTab === "orders" && (
                    <div className="space-y-4">
                      {/* 기간·심볼·매수/매도·상태 검색 필터 바 */}
                      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-100 bg-[#F9FAFB] p-3">
                        <input
                          type="text"
                          value={filterSymbol}
                          onChange={e => setFilterSymbol(e.target.value)}
                          placeholder="종목코드 검색 (예: BTC)"
                          className="h-9 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold"
                        />
                        <select
                          aria-label="주문 구분 필터"
                          value={filterSide}
                          onChange={e => setFilterSide(e.target.value)}
                          className="h-9 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold"
                        >
                          <option value="">구분 전체</option>
                          <option value="BUY">롱 (LONG)</option>
                          <option value="SELL">숏 (SHORT)</option>
                        </select>
                        <select
                          aria-label="주문 상태 필터"
                          value={filterStatus}
                          onChange={e => setFilterStatus(e.target.value)}
                          className="h-9 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold"
                        >
                          <option value="">상태 전체</option>
                          <option value="PENDING">대기중</option>
                          <option value="COMPLETED">체결완료</option>
                          <option value="CANCELED">취소</option>
                          <option value="REJECTED">주문거절</option>
                        </select>
                        <input
                          type="date"
                          aria-label="조회 시작일"
                          value={filterStartDate}
                          onChange={e => setFilterStartDate(e.target.value)}
                          className="h-9 rounded-xl border border-gray-300 bg-white px-2.5 text-xs font-bold"
                        />
                        <input
                          type="date"
                          aria-label="조회 종료일"
                          value={filterEndDate}
                          onChange={e => setFilterEndDate(e.target.value)}
                          className="h-9 rounded-xl border border-gray-300 bg-white px-2.5 text-xs font-bold"
                        />
                        <V1Button
                          variant="gray"
                          size="xs"
                          onClick={() => {
                            setFilterSymbol("");
                            setFilterSide("");
                            setFilterStatus("");
                            setFilterStartDate("");
                            setFilterEndDate("");
                          }}
                        >
                          필터 초기화
                        </V1Button>
                      </div>

                      <div className="overflow-x-auto rounded-2xl border border-gray-200">
                        <table className="w-full min-w-[680px] text-left text-xs">
                          <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                            <tr>
                              <th className="px-4 py-3.5">주문시각</th>
                              <th className="px-4 py-3.5">종목</th>
                              <th className="px-4 py-3.5">구분</th>
                              <th className="px-4 py-3.5">유형</th>
                              <th className="px-4 py-3.5 text-right">주문가격</th>
                              <th className="px-4 py-3.5 text-right">주문수량</th>
                              <th className="px-4 py-3.5 text-right">체결수량 / 체결가</th>
                              <th className="px-4 py-3.5 text-right">상태</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {filteredOrders.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={8}
                                  className="px-4 py-10 text-center text-xs font-bold text-gray-400"
                                >
                                  {ownerOrdersQuery.isLoading
                                    ? "주문내역을 불러오는 중입니다…"
                                    : "조회된 주문 내역이 없습니다."}
                                </td>
                              </tr>
                            ) : (
                              filteredOrders.map(order => (
                                <tr key={order.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-3.5 text-gray-500">{order.orderedAt}</td>
                                  <td className="px-4 py-3.5 font-bold text-gray-900">
                                    {order.nameKr} ({order.symbol})
                                  </td>
                                  <td
                                    className={`px-4 py-3.5 font-bold ${
                                      order.side === "BUY" ? "text-red-500" : "text-blue-600"
                                    }`}
                                  >
                                    {order.sideLabel}
                                  </td>
                                  <td className="px-4 py-3.5 text-gray-600">
                                    {order.orderType === "MARKET" ? "시장가" : "지정가"}
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-medium">
                                    {order.orderPrice}
                                  </td>
                                  <td className="px-4 py-3.5 text-right">{order.orderQuantity}</td>
                                  <td className="px-4 py-3.5 text-right font-bold">
                                    <div>{order.filledQuantity}</div>
                                    {order.avgFilledPrice !== "-" && (
                                      <div className="text-[11px] font-medium text-gray-400">
                                        {order.avgFilledPrice}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-bold text-gray-700">
                                    {order.orderStatus === "COMPLETED"
                                      ? "체결완료"
                                      : order.orderStatus === "CANCELED"
                                        ? "취소"
                                        : order.orderStatus === "REJECTED"
                                          ? "주문거절"
                                          : "대기중"}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {detailTab === "trades" && (
                    <div className="overflow-x-auto rounded-2xl border border-gray-200">
                      <table className="w-full min-w-[680px] text-left text-xs">
                        <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                          <tr>
                            <th className="px-4 py-3.5">체결시각</th>
                            <th className="px-4 py-3.5">종목</th>
                            <th className="px-4 py-3.5">구분</th>
                            <th className="px-4 py-3.5 text-right">체결가격</th>
                            <th className="px-4 py-3.5 text-right">체결수량</th>
                            <th className="px-4 py-3.5 text-right">체결금액</th>
                            <th className="px-4 py-3.5 text-right">수수료</th>
                            <th className="px-4 py-3.5 text-right">실현손익</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {tradeRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={8}
                                className="px-4 py-10 text-center text-xs font-bold text-gray-400"
                              >
                                {ownerFillsQuery.isLoading
                                  ? "거래내역을 불러오는 중입니다…"
                                  : "체결된 거래 내역이 없습니다."}
                              </td>
                            </tr>
                          ) : (
                            tradeRows.map(trade => (
                              <tr key={trade.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3.5 text-gray-500">{trade.executedAt}</td>
                                <td className="px-4 py-3.5 font-bold text-gray-900">
                                  {trade.nameKr} ({trade.symbol})
                                </td>
                                <td
                                  className={`px-4 py-3.5 font-bold ${
                                    trade.side === "BUY" ? "text-red-500" : "text-blue-600"
                                  }`}
                                >
                                  {trade.sideLabel}
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold">{trade.price}</td>
                                <td className="px-4 py-3.5 text-right">{trade.quantity}</td>
                                <td className="px-4 py-3.5 text-right">{trade.totalAmount}</td>
                                <td className="px-4 py-3.5 text-right text-gray-500">
                                  {trade.fee}
                                </td>
                                <td
                                  className={`px-4 py-3.5 text-right font-black ${pnlColorText(
                                    trade.realizedProfit,
                                  )}`}
                                >
                                  {trade.realizedProfit}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {detailTab === "open" && (
                    <div className="overflow-x-auto rounded-2xl border border-gray-200">
                      <table className="w-full min-w-[640px] text-left text-xs">
                        <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                          <tr>
                            <th className="px-4 py-3.5">주문시각</th>
                            <th className="px-4 py-3.5">종목</th>
                            <th className="px-4 py-3.5">구분</th>
                            <th className="px-4 py-3.5 text-right">지정가격</th>
                            <th className="px-4 py-3.5 text-right">미체결수량</th>
                            <th className="px-4 py-3.5 text-right">관리</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {openOrders.length === 0 ? (
                            <tr>
                              <td
                                colSpan={6}
                                className="px-4 py-10 text-center text-xs font-bold text-gray-400"
                              >
                                {ownerPendingOrdersQuery.isLoading
                                  ? "미체결 주문을 확인하는 중입니다…"
                                  : "현재 대기 중인 미체결 주문이 없습니다."}
                              </td>
                            </tr>
                          ) : (
                            openOrders.map(order => (
                              <tr key={order.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3.5 text-gray-500">{order.orderedAt}</td>
                                <td className="px-4 py-3.5 font-bold text-gray-900">
                                  {order.nameKr} ({order.symbol})
                                </td>
                                <td
                                  className={`px-4 py-3.5 font-bold ${
                                    order.side === "BUY" ? "text-red-500" : "text-blue-600"
                                  }`}
                                >
                                  {order.sideLabel}
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold">
                                  {order.orderPrice}
                                </td>
                                <td className="px-4 py-3.5 text-right">{order.orderQuantity}</td>
                                <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                  <Link
                                    href="/trading"
                                    className="inline-flex shrink-0 whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-100"
                                  >
                                    모의투자에서 취소
                                  </Link>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </V1FolderTabs>
              </div>
            )}

            {/* [탭 2] 시즌별 대회 자산 (로그인 본인 전용: 진행 시즌 실시간 대회 자산 + 종료된 시즌 대회 자산) */}
            {isOwnAndLoggedIn && activeMainTab === "contest-assets" && (
              <div className="space-y-6" data-mypage-panel="contest-assets">
                <div className="card rounded-2xl border border-gray-200 bg-white p-6 space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black text-gray-900">시즌별 대회 자산 현황</h3>
                      <p className="mt-0.5 text-xs text-gray-500">
                        내 시즌별 대회 실시간 자산과 종료된 시즌의 확정 대회 자산을 모두 조회합니다.
                      </p>
                    </div>
                    <V1SegmentTabs
                      tabs={[
                        { label: "진행 시즌 실시간 대회 자산", value: "live" },
                        { label: "종료된 시즌 대회 자산", value: "finished" },
                      ]}
                      activeTab={contestSubTab}
                      onChange={val => setContestSubTab(val as ContestSubTab)}
                      fullWidth={false}
                      size="sm"
                    />
                  </div>

                  {contestSubTab === "live" ? (
                    liveContestParticipations.length > 0 ? (
                      <div className="space-y-4">
                        {liveContestParticipations.map(item => {
                          const pnlStr = formatContestSignedUsdt(item.totalPnl);
                          const roiStr = formatContestSignedRoi(item.roiPct);
                          return (
                            <section
                              key={item.seasonId}
                              className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-5 space-y-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#0058FF]">
                                    {item.displayStatus === "LIVE" ? "LIVE" : item.statusLabel} ·{" "}
                                    {item.title}
                                  </span>
                                  <h4 className="text-sm font-black text-gray-900">
                                    내 시즌별 대회 실시간 자산
                                  </h4>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-gray-500">
                                    실시간 순위:{" "}
                                    <strong className="text-[#0058FF]">
                                      {item.rank ? `${item.rank}위` : "-"}
                                    </strong>{" "}
                                    / {item.totalParticipants}명
                                  </span>
                                  {item.displayStatus === "LIVE" && (
                                    <Link
                                      href={`/contest/${item.seasonId}/trading`}
                                      className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-[#0058FF] px-3 text-xs font-bold text-white hover:bg-blue-700"
                                    >
                                      대회 참여하기 →
                                    </Link>
                                  )}
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                                <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                                  <span className="text-[11px] font-bold text-gray-400">
                                    실시간 대회 평가자산
                                  </span>
                                  <p className="mt-1 text-base font-black text-gray-900">
                                    {formatContestUsdt(item.totalEquity)}
                                  </p>
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                                  <span className="text-[11px] font-bold text-gray-400">
                                    대회 가용 증거금
                                  </span>
                                  <p className="mt-1 text-base font-black text-gray-900">
                                    {formatContestUsdt(item.availableBalance)}
                                  </p>
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                                  <span className="text-[11px] font-bold text-gray-400">
                                    실시간 대회 수익금
                                  </span>
                                  <p className={`mt-1 text-base font-black ${pnlColorText(pnlStr)}`}>
                                    {pnlStr}
                                  </p>
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                                  <span className="text-[11px] font-bold text-gray-400">
                                    실시간 대회 수익률(ROI)
                                  </span>
                                  <p className={`mt-1 text-base font-black ${pnlColorText(roiStr)}`}>
                                    {roiStr}
                                  </p>
                                </div>
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-8 text-center space-y-3">
                        <p className="text-sm font-bold text-gray-600">
                          {memberContestSeasonsQuery.isLoading
                            ? "대회 참가 정보를 불러오는 중입니다…"
                            : "현재 참가 중인 진행 시즌 대회가 없습니다."}
                        </p>
                        <Link
                          href="/contest"
                          className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-xl bg-[#0058FF] px-4 text-xs font-bold text-white hover:bg-blue-700"
                        >
                          대회 참여하기 →
                        </Link>
                      </div>
                    )
                  ) : (
                    <section className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-black text-gray-900">
                          종료된 시즌의 대회 자산 및 정산 이력
                        </h4>
                        <span className="text-xs font-medium text-gray-400">
                          총 {finishedContestSeasonsDisplay.length}개 시즌 참가 완료
                        </span>
                      </div>

                      {finishedContestSeasonsDisplay.length === 0 ? (
                        <div className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-8 text-center text-xs font-bold text-gray-400">
                          {memberContestSeasonsQuery.isLoading
                            ? "정산 이력을 확인하는 중입니다…"
                            : "종료된 대회 참가 이력이 없습니다."}
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-2xl border border-gray-200">
                          <table className="w-full min-w-[680px] text-left text-xs">
                            <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                              <tr>
                                <th className="px-4 py-3.5">시즌명 / 기간</th>
                                <th className="px-4 py-3.5 text-right">초기 시드</th>
                                <th className="px-4 py-3.5 text-right">최종 확정 자산</th>
                                <th className="px-4 py-3.5 text-right">최종 수익률</th>
                                <th className="px-4 py-3.5 text-right">최종 순위</th>
                                <th className="px-4 py-3.5 text-right">승률 / 상태</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                              {finishedContestSeasonsDisplay.map(season => (
                                <tr key={season.seasonId} className="hover:bg-gray-50">
                                  <td className="px-4 py-3.5">
                                    <div className="font-black text-gray-900">
                                      {season.seasonTitle}
                                    </div>
                                    <div className="text-[11px] text-gray-400">{season.period}</div>
                                  </td>
                                  <td className="px-4 py-3.5 text-right text-gray-600">
                                    {season.seedMoney}
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-black text-gray-900">
                                    {season.finalEquity}
                                  </td>
                                  <td
                                    className={`px-4 py-3.5 text-right font-black ${pnlColorText(
                                      season.finalRoi,
                                    )}`}
                                  >
                                    {season.finalRoi}
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-bold text-[#0058FF]">
                                    {season.finalRank}
                                  </td>
                                  <td className="px-4 py-3.5 text-right">
                                    <div className="font-bold text-gray-800">{season.winRate}</div>
                                    <span className="text-[11px] font-bold text-gray-400">
                                      {season.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              </div>
            )}

            {/* [탭 3] 포트폴리오 (전체 공개: 본인 + 비로그인 + 타 유저 모두 열람 가능) */}
            {activeMainTab === "portfolio" && (
              <V1FolderTabs
                tabs={[
                  { id: "mock", label: "모의투자 (선물)" },
                  { id: "contest", label: "시즌 대회" },
                ]}
                activeId={portfolioTab}
                onChange={id => setPortfolioTab(id as "mock" | "contest")}
              >
                {portfolioTab === "mock" ? (
                  <div className="space-y-8" data-mypage-panel="portfolio">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      {/* 도넛 차트 영역 */}
                      <div className="rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                        <h3 className="mb-4 text-sm font-black text-gray-900">
                          포지션 증거금 비중 (%)
                        </h3>
                        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                          <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
                            <svg viewBox="0 0 36 36" className="h-36 w-36 -rotate-90">
                              <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke="#E5E7EB"
                                strokeWidth="4.5"
                              />
                              {donutSegments.map(seg => (
                                <circle
                                  key={seg.key}
                                  cx="18"
                                  cy="18"
                                  r="14"
                                  pathLength={100}
                                  fill="none"
                                  stroke={seg.color}
                                  strokeWidth="4.5"
                                  strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
                                  strokeDashoffset={-seg.offset}
                                />
                              ))}
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                              <span className="text-[10px] font-bold text-gray-400">사용 비중</span>
                              <strong className="text-base font-black text-gray-900">
                                {usedMarginRatioDisplay}
                              </strong>
                            </div>
                          </div>

                          <ul className="w-full flex-1 space-y-2 text-xs">
                            {displayPositions.map(pos => (
                              <li
                                key={`${pos.id}-${pos.side}`}
                                className="flex items-center justify-between"
                              >
                                <span className="flex items-center gap-2 font-bold text-gray-700">
                                  <span
                                    className="inline-block h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: pos.color }}
                                  />
                                  {pos.symbol} ({pos.side})
                                </span>
                                <span className="font-black text-gray-900 tabular-nums">{pos.marginRatioLabel}</span>
                              </li>
                            ))}
                            <li className="flex items-center justify-between border-t border-gray-200 pt-1.5">
                              <span className="flex items-center gap-2 font-bold text-gray-500">
                                <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-300" />
                                가용 USDT
                              </span>
                              <span className="font-black text-gray-600">
                                {availableCashRatioDisplay}
                              </span>
                            </li>
                          </ul>
                        </div>
                      </div>

                      {/* 롱 / 숏 포지션 비율 바 */}
                      <div className="flex flex-col justify-between rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                        <div>
                          <h3 className="mb-2 text-sm font-black text-gray-900">
                            롱 / 숏 포지션 비율
                          </h3>
                          <p className="text-xs text-gray-500">
                            현재 오픈된 선물 포지션의 매수(Long) / 매도(Short) 증거금 비율입니다.
                          </p>
                        </div>

                        <div className="my-4 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] sm:text-xs font-black">
                            <span className="text-red-500">
                              LONG {longRatioDisplay}% ({longCountDisplay}종목)
                            </span>
                            <span className="text-blue-600">
                              SHORT {shortRatioDisplay}% ({shortCountDisplay}종목)
                            </span>
                          </div>
                          <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-gray-200">
                            <div
                              className="h-full bg-red-500"
                              style={{ width: `${longRatioDisplay}%` }}
                            />
                            <div
                              className="h-full bg-blue-600"
                              style={{ width: `${shortRatioDisplay}%` }}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 border-t border-gray-200 pt-3 text-xs tabular-nums">
                          <div>
                            <span className="text-gray-400">평균 레버리지</span>
                            <p className="font-black text-gray-900">{avgLeverageDisplay}</p>
                          </div>
                          <div className="text-right">
                            <span className="text-gray-400">누적 승률</span>
                            <p className="font-black text-[#0058FF]">{winRateDisplay}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 보유 선물 포지션 요약 리스트 */}
                    <div>
                      <h3 className="mb-3 text-base font-black text-gray-900">
                        보유 선물 포지션 요약 ({displayPositions.length})
                      </h3>
                      <div className="overflow-x-auto rounded-2xl border border-gray-200">
                        <table className="w-full min-w-[640px] text-left text-xs">
                          <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                            <tr>
                              <th className="px-4 py-3">종목 / 배율</th>
                              <th className="px-4 py-3">포지션</th>
                              <th className="px-4 py-3 text-right">보유수량</th>
                              <th className="px-4 py-3 text-right">진입가격</th>
                              <th className="px-4 py-3 text-right">마크가격</th>
                              <th className="px-4 py-3 text-right">평가손익 (ROE)</th>
                              <th className="px-4 py-3 text-right">공유</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {displayPositions.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={7}
                                  className="px-4 py-10 text-center text-xs font-bold text-gray-400"
                                >
                                  {!isOwnAndLoggedIn
                                    ? "로그인하면 내 모의투자 포지션 포트폴리오를 확인할 수 있습니다."
                                    : publicPortfolioQuery.isLoading
                                      ? "포트폴리오를 불러오는 중입니다…"
                                      : "현재 보유 중인 선물 포지션이 없습니다."}
                                </td>
                              </tr>
                            ) : (
                              displayPositions.map(pos => (
                                <tr key={`${pos.id}-${pos.side}`} className="hover:bg-gray-50">
                                  <td className="px-4 py-3.5 font-black text-gray-900">
                                    {pos.nameKr} ({pos.symbol} · {pos.leverage}x)
                                  </td>
                                  <td className="px-4 py-3.5">
                                    <span
                                      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-black ${
                                        pos.side === "LONG"
                                          ? "bg-red-50 text-red-500"
                                          : "bg-blue-50 text-blue-600"
                                      }`}
                                    >
                                      {pos.side}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-bold text-gray-800">
                                    {pos.quantity}
                                  </td>
                                  <td className="px-4 py-3.5 text-right text-gray-600">
                                    ${pos.entryPrice}
                                  </td>
                                  <td className="px-4 py-3.5 text-right font-bold text-gray-900">
                                    ${pos.markPrice}
                                  </td>
                                  <td
                                    className={`px-4 py-3.5 text-right font-black ${pnlColorText(pos.pnl)}`}
                                  >
                                    {pos.pnl} ({pos.roe})
                                  </td>
                                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                    <Link
                                      href={`/community/all?sharePosition=MOCK_POS_${pos.id}`}
                                      className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-bold text-[#0058FF] transition-colors hover:bg-blue-100"
                                    >
                                      포지션 공유
                                    </Link>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {livePortfolio && livePortfolio.symbolPerformances.length > 0 && (
                      <div>
                        <h3 className="mb-3 text-base font-black text-gray-900">
                          종목별 누적 실현손익 성과
                        </h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {livePortfolio.symbolPerformances.map(perf => {
                            const netStr = formatSignedUsdt(perf.economicPnl);
                            return (
                              <div
                                key={perf.symbol}
                                className="rounded-xl border border-gray-200 bg-[#F9FAFB] p-3.5 text-xs"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-black text-gray-900">{perf.symbol}</span>
                                  <span className="text-[11px] font-bold text-gray-400">
                                    체결 {perf.fillCount}회 · 비중 {formatExchangePct(perf.turnoverSharePercent, 2)}
                                  </span>
                                </div>
                                <p className={`mt-1.5 text-sm font-black ${pnlColorText(netStr)}`}>
                                  {netStr}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <h3 className="text-base font-black text-gray-900">시즌별 대회 참가 성적 요약</h3>
                    {finishedContestSeasonsDisplay.length === 0 &&
                    liveContestParticipations.length === 0 ? (
                      <div className="py-10 text-center text-xs font-bold text-gray-400">
                        {!isOwnAndLoggedIn
                          ? "로그인하면 참여한 모의투자 대회 시즌 기록을 확인할 수 있습니다."
                          : memberContestSeasonsQuery.isLoading
                            ? "대회 시즌 기록을 불러오는 중입니다…"
                            : "참여한 모의투자 대회 시즌 기록이 없습니다."}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {liveContestParticipations.map(liveItem => {
                          const roiStr = formatContestSignedRoi(liveItem.roiPct);
                          return (
                            <div
                              key={`live-${liveItem.seasonId}`}
                              className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5"
                            >
                              <span className="text-xs font-bold text-[#0058FF]">
                                LIVE · {liveItem.title}
                              </span>
                              <p className={`mt-2 text-2xl font-black ${pnlColorText(roiStr)}`}>
                                {roiStr}
                              </p>
                              <p className="mt-1 text-xs font-bold text-gray-600">
                                실시간 순위 {liveItem.rank ?? "-"}위 / {liveItem.totalParticipants}명
                              </p>
                            </div>
                          );
                        })}
                        {finishedContestSeasonsDisplay.map(season => (
                          <div
                            key={season.seasonId}
                            className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-5"
                          >
                            <span className="text-xs font-bold text-[#0058FF]">
                              {season.seasonTitle}
                            </span>
                            <p
                              className={`mt-2 text-2xl font-black ${pnlColorText(
                                season.finalRoi,
                              )}`}
                            >
                              {season.finalRoi}
                            </p>
                            <p className="mt-1 text-xs font-bold text-gray-600">
                              최종 순위 {season.finalRank} · 승률 {season.winRate}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </V1FolderTabs>
            )}

            {/* [탭 4] 커뮤니티활동 (공개 4개 서브탭: 게시글, 댓글, 좋아요, 좋아요 댓글 + 본인 전용 5번째: 신고내역) */}
            {activeMainTab === "community" && (
              <V1FolderTabs
                tabs={
                  isOwnAndLoggedIn
                    ? [
                        { id: "posts", label: "게시글" },
                        { id: "replies", label: "댓글" },
                        { id: "likedPosts", label: "좋아요" },
                        { id: "likedReplies", label: "좋아요 댓글" },
                        { id: "reports", label: "신고내역" },
                      ]
                    : [
                        { id: "posts", label: "게시글" },
                        { id: "replies", label: "댓글" },
                        { id: "likedPosts", label: "좋아요" },
                        { id: "likedReplies", label: "좋아요 댓글" },
                      ]
                }
                activeId={communityTab}
                onChange={id =>
                  setCommunityTab(
                    id as "posts" | "replies" | "likedPosts" | "likedReplies" | "reports",
                  )
                }
              >
                {communityTab === "posts" && (
                  <div className="space-y-3">
                    {liveMyPosts.length === 0 ? (
                      <div className="py-10 text-center text-xs font-bold text-gray-400">
                        {!isOwnAndLoggedIn
                          ? "로그인하면 작성한 커뮤니티 게시글을 확인할 수 있습니다."
                          : communityPostsInfinite.isLoading
                            ? "작성한 게시글을 불러오는 중입니다…"
                            : "작성한 커뮤니티 게시글이 없습니다."}
                      </div>
                    ) : (
                      liveMyPosts.map(post => (
                        <article key={post.id} className="rounded-xl border border-gray-200 p-4">
                          <div className="flex items-center justify-between text-xs text-gray-400">
                            <span className="font-bold text-[#0058FF]">
                              {communityCategoryLabel(post.category as CommunityCategory)}
                              {post.symbolTag ? ` · #${post.symbolTag}` : ""}
                            </span>
                            <span>{formatKstDateTimeShort(post.createdAt)}</span>
                          </div>
                          <Link
                            href={`/community/all/${post.id}`}
                            className="mt-1 block text-sm font-black text-gray-900 hover:text-[#0058FF]"
                          >
                            {post.title}
                          </Link>
                          <p className="mt-1 line-clamp-2 text-xs text-gray-600">{post.content}</p>
                        </article>
                      ))
                    )}
                  </div>
                )}

                {communityTab === "replies" && (
                  <div className="space-y-3">
                    {liveMyComments.length === 0 ? (
                      <div className="py-10 text-center text-xs font-bold text-gray-400">
                        {!isOwnAndLoggedIn
                          ? "로그인하면 작성한 댓글 내역을 확인할 수 있습니다."
                          : communityCommentsInfinite.isLoading
                            ? "작성한 댓글을 불러오는 중입니다…"
                            : "작성한 댓글 내역이 없습니다."}
                      </div>
                    ) : (
                      liveMyComments.map(comment => (
                        <div
                          key={comment.id}
                          className="rounded-xl border border-gray-200 p-4 text-xs"
                        >
                          <Link
                            href={`/community/all/${comment.postId}`}
                            className="font-bold text-gray-900 hover:text-[#0058FF]"
                          >
                            “{comment.content}”
                          </Link>
                          <p className="mt-1 text-gray-400">원문: {comment.postTitle}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {communityTab === "likedPosts" && (
                  <div className="space-y-3">
                    {liveLikedPosts.length === 0 ? (
                      <div className="py-10 text-center text-xs font-bold text-gray-400">
                        {!isOwnAndLoggedIn
                          ? "로그인하면 좋아요한 게시글을 확인할 수 있습니다."
                          : communityLikedPostsInfinite.isLoading
                            ? "좋아요한 게시글을 불러오는 중입니다…"
                            : "좋아요한 게시글 내역이 없습니다."}
                      </div>
                    ) : (
                      liveLikedPosts.map(post => (
                        <div
                          key={post.id}
                          className="rounded-xl border border-gray-200 p-4 text-xs"
                        >
                          <span className="inline-flex items-center gap-1 font-bold text-gray-700">
                            <V1IconHeart className="h-3.5 w-3.5" />
                            <span>좋아요 표시한 게시글</span>
                          </span>
                          <Link
                            href={`/community/all/${post.id}`}
                            className="mt-1 block text-sm font-black text-gray-900 hover:text-[#0058FF]"
                          >
                            {post.title}
                          </Link>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {communityTab === "likedReplies" && (
                  <div className="space-y-3">
                    {liveLikedComments.length === 0 ? (
                      <div className="py-10 text-center text-xs font-bold text-gray-400">
                        {!isOwnAndLoggedIn
                          ? "로그인하면 좋아요한 댓글을 확인할 수 있습니다."
                          : communityLikedCommentsInfinite.isLoading
                            ? "좋아요한 댓글을 불러오는 중입니다…"
                            : "좋아요한 댓글 내역이 없습니다."}
                      </div>
                    ) : (
                      liveLikedComments.map(comment => (
                        <div
                          key={comment.id}
                          className="rounded-xl border border-gray-200 p-4 text-xs"
                        >
                          <span className="inline-flex items-center gap-1 font-bold text-gray-700">
                            <V1IconHeart className="h-3.5 w-3.5" />
                            <span>좋아요 표시한 댓글</span>
                          </span>
                          <Link
                            href={`/community/all/${comment.postId}`}
                            className="mt-1 block font-bold text-gray-900 hover:text-[#0058FF]"
                          >
                            “{comment.content}”
                          </Link>
                          <p className="mt-0.5 text-gray-400">원문: {comment.postTitle}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {isOwnAndLoggedIn && communityTab === "reports" && (
                  <div className="space-y-3">
                    {liveReports.length === 0 ? (
                      <div className="py-10 text-center text-xs font-bold text-gray-400">
                        {communityReportsInfinite.isLoading
                          ? "신고 내역을 불러오는 중입니다…"
                          : "접수된 신고 내역이 없습니다."}
                      </div>
                    ) : (
                      liveReports.map(item => (
                        <div
                          key={item.id}
                          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-gray-200 p-4 text-xs"
                        >
                          <div>
                            <span className="rounded bg-red-50 px-2 py-0.5 font-bold text-red-600">
                              {item.targetType === "POST" ? "게시글" : "댓글"} 신고 · 접수완료
                            </span>
                            <p className="mt-1.5 font-bold text-gray-900">{item.title}</p>
                            <p className="mt-0.5 text-gray-500">
                              사유: {item.reasonDescription}
                            </p>
                          </div>
                          <V1Button
                            variant="white"
                            size="xs"
                            disabled={cancelReportMutation.isPending}
                            onClick={() =>
                              cancelReportMutation.mutate({
                                targetType: item.targetType,
                                targetId: item.targetId,
                                id: item.id,
                              })
                            }
                          >
                            신고 취소
                          </V1Button>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* 커서 기반 무한스크롤 센티넬 & 더 보기 버튼 */}
                <div
                  ref={communitySentinelRef}
                  data-infinite-scroll="mypage-community-sentinel"
                  className="mt-4 flex flex-col items-center justify-center gap-2"
                >
                  {activeInfinite.hasNextPage && (
                    <V1Button
                      variant="white"
                      size="xs"
                      disabled={activeInfinite.isFetchingNextPage}
                      onClick={() => void activeInfinite.fetchNextPage()}
                    >
                      {activeInfinite.isFetchingNextPage ? "불러오는 중…" : "더 보기"}
                    </V1Button>
                  )}
                </div>
              </V1FolderTabs>
            )}
          </div>
        </div>
      </div>

      {/* V1 FollowMembersModal (팔로워 / 팔로잉 목록 모달) */}
      <DimModal
        open={followModalType !== null}
        onClose={() => {
          setFollowModalType(null);
          setFollowOverrides({});
        }}
        title={followModalType === "followers" ? "팔로워 (Followers)" : "팔로잉 (Following)"}
        subtitle="회원 프로필을 클릭해 포트폴리오를 조회하거나 팔로우 상태를 변경할 수 있습니다."
      >
        {modalFollowList.length === 0 ? (
          <p className="py-8 text-center text-xs font-bold text-gray-400">
            {followModalInfinite.isLoading ? "회원 목록을 불러오는 중입니다…" : "표시할 회원이 없습니다."}
          </p>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-gray-100">
              {modalFollowList.map(person => (
                <li key={person.memberId} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <V1UserAvatar
                      src={person.profileImgUrl}
                      memberId={person.memberId}
                      nickname={person.nickname}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/members/${person.memberId}`}
                          className="truncate text-sm font-bold text-gray-900 hover:text-[#0058FF]"
                          onClick={() => {
                            setFollowModalType(null);
                            setFollowOverrides({});
                          }}
                        >
                          {person.nickname}
                        </Link>
                        {person.followsMe && (
                          <span className="shrink-0 whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">
                            나를 팔로우 중
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-gray-500">{person.profileMsg}</p>
                    </div>
                  </div>
                  {isOwnAndLoggedIn && person.memberId !== member.memberId && (
                    <V1Button
                      variant={person.following ? "gray" : "blue"}
                      size="xs"
                      onClick={() => toggleFollowInModal(person)}
                    >
                      {person.following ? "팔로우 취소" : "팔로우"}
                    </V1Button>
                  )}
                </li>
              ))}
            </ul>
            {followModalInfinite.hasNextPage && (
              <div className="flex justify-center pt-1">
                <V1Button
                  variant="white"
                  size="xs"
                  disabled={followModalInfinite.isFetchingNextPage}
                  onClick={() => void followModalInfinite.fetchNextPage()}
                >
                  {followModalInfinite.isFetchingNextPage ? "불러오는 중…" : "더 보기"}
                </V1Button>
              </div>
            )}
          </div>
        )}
      </DimModal>
    </MemberShell>
  );
}
