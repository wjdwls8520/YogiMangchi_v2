"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MemberShell } from "./member-views";
import { useMember } from "./member-provider";
import { DimModal } from "./dim-modal";
import { TradingDataProvider } from "../../trading/components/trading-data-provider";
import { MemberSimulation } from "../../trading/components/member-simulation";
import { tradingJson } from "../../trading/api/client";
import { contentJson } from "../api/client";
import { parseFollowPage } from "../api/contracts";
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
  followerCount?: number;
  followingCount?: number;
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

const INITIAL_FOLLOWERS: FollowMemberItem[] = [
  { memberId: 11, nickname: "알파트레이더", profileMsg: "BTC/ETH 추세 매매 전문", following: true, followsMe: true },
  { memberId: 15, nickname: "퀀트매니저", profileMsg: "펀딩비 차익 및 단기 변동성 돌파", following: false, followsMe: true },
  { memberId: 22, nickname: "솔라나고래", profileMsg: "격리 10배 원칙 매매", following: true, followsMe: true },
];

const INITIAL_FOLLOWINGS: FollowMemberItem[] = [
  { memberId: 11, nickname: "알파트레이더", profileMsg: "BTC/ETH 추세 매매 전문", following: true, followsMe: true },
  { memberId: 22, nickname: "솔라나고래", profileMsg: "격리 10배 원칙 매매", following: true, followsMe: true },
  { memberId: 31, nickname: "매크로워처", profileMsg: "FOMC·CPI 거시 지표 분석", following: true, followsMe: false },
];

const POSITION_COLORS = ["#0058FF", "#9CB34E", "#1D7CA7", "#F59E0B", "#8B5CF6"] as const;

const SYMBOL_NAME_KR: Record<string, string> = {
  BTCUSDT: "비트코인 무기한",
  ETHUSDT: "이더리움 무기한",
  SOLUSDT: "솔라나 무기한",
  XRPUSDT: "리플 무기한",
  BNBUSDT: "바이낸스코인 무기한",
  DOGEUSDT: "도지코인 무기한",
};

function symbolNameKr(symbol: string): string {
  return SYMBOL_NAME_KR[symbol.toUpperCase()] ?? `${symbol} 무기한`;
}

const MOCK_POSITIONS = [
  {
    id: 1,
    symbol: "BTCUSDT",
    nameKr: "비트코인 무기한",
    side: "LONG" as const,
    leverage: 10,
    quantity: "0.450 BTC",
    entryPrice: "92,400.00",
    markPrice: "94,280.50",
    liqPrice: "83,610.00",
    margin: "4,158.00 USDT",
    pnl: "+846.23 USDT",
    roe: "+20.35%",
    isPositive: true,
    marginRatio: 45,
    color: "#0058FF",
  },
  {
    id: 2,
    symbol: "ETHUSDT",
    nameKr: "이더리움 무기한",
    side: "LONG" as const,
    leverage: 5,
    quantity: "3.200 ETH",
    entryPrice: "3,080.00",
    markPrice: "3,142.10",
    liqPrice: "2,495.00",
    margin: "1,971.20 USDT",
    pnl: "+198.72 USDT",
    roe: "+10.08%",
    isPositive: true,
    marginRatio: 22,
    color: "#9CB34E",
  },
  {
    id: 3,
    symbol: "SOLUSDT",
    nameKr: "솔라나 무기한",
    side: "SHORT" as const,
    leverage: 5,
    quantity: "20.00 SOL",
    entryPrice: "215.00",
    markPrice: "212.40",
    liqPrice: "255.80",
    margin: "860.00 USDT",
    pnl: "+52.00 USDT",
    roe: "+6.05%",
    isPositive: true,
    marginRatio: 10,
    color: "#1D7CA7",
  },
];

const MOCK_CLOSED_PNL = [
  {
    id: 101,
    closedAt: "2026-11-08 09:42:11",
    symbol: "BTCUSDT",
    nameKr: "비트코인 무기한",
    side: "LONG",
    leverage: 10,
    entryPrice: "91,150.00",
    exitPrice: "93,400.00",
    quantity: "0.300 BTC",
    realizedPnl: "+675.00 USDT",
    roe: "+24.68%",
    isPositive: true,
  },
  {
    id: 102,
    closedAt: "2026-11-07 21:15:04",
    symbol: "XRPUSDT",
    nameKr: "리플 무기한",
    side: "SHORT",
    leverage: 5,
    entryPrice: "0.5820",
    exitPrice: "0.5910",
    quantity: "2,000 XRP",
    realizedPnl: "-18.00 USDT",
    roe: "-7.73%",
    isPositive: false,
  },
];

const MOCK_ORDERS = [
  {
    id: 3001,
    orderedAt: "2026-11-08 10:12:30",
    symbol: "BTCUSDT",
    nameKr: "비트코인",
    side: "BUY",
    sideLabel: "매수/롱",
    orderType: "MARKET",
    orderStatus: "COMPLETED",
    orderPrice: "시장가",
    orderQuantity: "0.450 BTC",
    filledQuantity: "0.450 BTC",
    avgFilledPrice: "92,400.00 USDT",
  },
  {
    id: 3002,
    orderedAt: "2026-11-08 09:50:18",
    symbol: "ETHUSDT",
    nameKr: "이더리움",
    side: "BUY",
    sideLabel: "매수/롱",
    orderType: "LIMIT",
    orderStatus: "COMPLETED",
    orderPrice: "3,080.00 USDT",
    orderQuantity: "3.200 ETH",
    filledQuantity: "3.200 ETH",
    avgFilledPrice: "3,080.00 USDT",
  },
  {
    id: 3003,
    orderedAt: "2026-11-08 08:30:00",
    symbol: "BTCUSDT",
    nameKr: "비트코인",
    side: "SELL",
    sideLabel: "매도/숏 (익절대기)",
    orderType: "LIMIT",
    orderStatus: "PENDING",
    orderPrice: "96,500.00 USDT",
    orderQuantity: "0.200 BTC",
    filledQuantity: "0.000 BTC",
    avgFilledPrice: "-",
  },
];

const MOCK_TRADES = [
  {
    id: 4001,
    executedAt: "2026-11-08 10:12:30",
    symbol: "BTCUSDT",
    nameKr: "비트코인",
    side: "BUY",
    sideLabel: "매수/롱",
    price: "92,400.00 USDT",
    quantity: "0.450 BTC",
    totalAmount: "41,580.00 USDT",
    fee: "12.47 USDT",
    realizedProfit: "0.00 USDT",
  },
  {
    id: 4002,
    executedAt: "2026-11-08 09:42:11",
    symbol: "BTCUSDT",
    nameKr: "비트코인",
    side: "SELL",
    sideLabel: "매도/청산",
    price: "93,400.00 USDT",
    quantity: "0.300 BTC",
    totalAmount: "28,020.00 USDT",
    fee: "8.41 USDT",
    realizedProfit: "+675.00 USDT",
  },
];

const FINISHED_CONTEST_SEASONS = [
  {
    seasonId: "2026-S1",
    seasonTitle: "2026 정규 시즌 1 선물 랭킹전",
    period: "2026.09.01 ~ 2026.09.30",
    seedMoney: "10,000.00 USDT",
    finalEquity: "24,860.00 USDT",
    finalRoi: "+148.60%",
    finalRank: "1위 / 412명",
    winRate: "74.2% (23승 8패)",
    status: "정산완료",
  },
  {
    seasonId: "2026-PRE",
    seasonTitle: "2026 프리시즌 오픈 토너먼트",
    period: "2026.07.15 ~ 2026.08.15",
    seedMoney: "10,000.00 USDT",
    finalEquity: "13,420.50 USDT",
    finalRoi: "+34.21%",
    finalRank: "12위 / 285명",
    winRate: "65.0% (13승 7패)",
    status: "정산완료",
  },
];

function formatSignedUsdt(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-")) return `${trimmed} USDT`;
  if (trimmed.startsWith("+")) return `${trimmed} USDT`;
  if (trimmed === "0" || trimmed === "0.00") return "0.00 USDT";
  return `+${trimmed} USDT`;
}

function formatSignedPct(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-") || trimmed.startsWith("+")) {
    return trimmed.endsWith("%") ? trimmed : `${trimmed}%`;
  }
  if (trimmed === "0" || trimmed === "0.00") return "0.00%";
  return `+${trimmed.endsWith("%") ? trimmed : `${trimmed}%`}`;
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
  const targetMemberId = member.memberId ?? 7;
  const tradingBase = process.env.NEXT_PUBLIC_TRADING_API_BASE_URL ?? "http://localhost:8081";

  const [selectedTab, setSelectedTab] = useState<MyPageMainTab | null>(initialMainTab ?? null);
  const [detailTab, setDetailTab] = useState<LedgerDetailTab>("holdings");
  const [contestSubTab, setContestSubTab] = useState<ContestSubTab>("live");
  const [portfolioTab, setPortfolioTab] = useState<"mock" | "contest">("mock");
  const [communityTab, setCommunityTab] = useState<
    "posts" | "replies" | "likedPosts" | "likedReplies" | "reports"
  >("posts");
  const [followModalType, setFollowModalType] = useState<"followers" | "followings" | null>(null);
  const [followers, setFollowers] = useState<FollowMemberItem[]>(INITIAL_FOLLOWERS);
  const [followings, setFollowings] = useState<FollowMemberItem[]>(INITIAL_FOLLOWINGS);
  const [fallbackReports, setFallbackReports] = useState([
    {
      id: 501,
      targetType: "POST" as const,
      targetId: 501,
      postId: 501,
      title: "외부 리딩방 불법 홍보 게시글",
      reason: "스팸 홍보/도배글입니다.",
      reportedAt: "2026-11-07",
      status: "접수완료",
    },
  ]);

  // 5대 원장 검색 필터 상태
  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterSide, setFilterSide] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  const communitySentinelRef = useRef<HTMLDivElement>(null);

  const profileQuery = useQuery({
    queryKey: ["member", "profile", member.memberId, member.generation],
    enabled: isOwnAndLoggedIn,
    queryFn: () => session.request("/members/me") as Promise<ProfileResponse>,
  });

  // [T-1] 공개 포트폴리오 API 조회 (모두 열람 가능)
  const publicPortfolioQuery = useQuery({
    queryKey: ["member", "public-portfolio", targetMemberId, tradingBase, member.generation],
    enabled: targetMemberId > 0,
    queryFn: async ({ signal }) =>
      parsePublicMemberPortfolio(
        await tradingJson(tradingBase, `portfolios/members/${targetMemberId}`, { signal }),
      ),
  });

  // 본인 로그인 시 5대 원장 실시간 API 조회
  const ownerOrdersQuery = useQuery({
    queryKey: [
      "member",
      "trading-orders",
      member.memberId,
      member.generation,
      filterSymbol,
      filterSide,
      filterStatus,
      filterStartDate,
      filterEndDate,
    ],
    enabled: isOwnAndLoggedIn && detailTab === "orders",
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (filterSymbol.trim()) params.set("symbol", filterSymbol.trim().toUpperCase());
      if (filterSide === "BUY") params.set("side", "LONG");
      else if (filterSide === "SELL") params.set("side", "SHORT");
      if (filterStatus === "COMPLETED") params.set("status", "FILLED");
      else if (filterStatus === "CANCELED") params.set("status", "CANCELLED");
      else if (filterStatus) params.set("status", filterStatus);
      if (filterStartDate) params.set("createdFrom", `${filterStartDate}T00:00:00Z`);
      if (filterEndDate) params.set("createdBefore", `${filterEndDate}T23:59:59Z`);
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
    enabled: isOwnAndLoggedIn && detailTab === "trades",
    queryFn: async ({ signal }) =>
      session.authorized(cred =>
        tradingJson(tradingBase, "account/fills?limit=50", { token: cred.accessToken, signal }),
      ) as Promise<Array<Record<string, unknown>>>,
  });

  const ownerClosedPositionsQuery = useQuery({
    queryKey: ["member", "trading-closed-positions", member.memberId, member.generation],
    enabled: isOwnAndLoggedIn && detailTab === "pnl",
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
    enabled: isOwnAndLoggedIn,
    queryFn: async ({ signal }) =>
      session.authorized(cred =>
        tradingJson(tradingBase, "account/orders/pending", { token: cred.accessToken, signal }),
      ) as Promise<Array<Record<string, unknown>>>,
  });

  // 팔로워/팔로잉 모달 실데이터 조회
  const followModalQuery = useQuery({
    queryKey: ["member", "follow-modal", targetMemberId, followModalType, member.generation],
    enabled: followModalType !== null && targetMemberId > 0,
    queryFn: async ({ signal }) => {
      const path = `/members/${targetMemberId}/${followModalType}?size=20`;
      const raw = isOwnAndLoggedIn
        ? await session.request(path, { signal })
        : await contentJson(origin, path, { signal });
      return parseFollowPage(raw);
    },
  });

  // [C-6] 커뮤니티활동 커서 기반 무한스크롤
  const communityPostsInfinite = useInfiniteQuery({
    queryKey: ["member", "community-posts", targetMemberId, member.generation],
    enabled: targetMemberId > 0,
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
    enabled: targetMemberId > 0,
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
    enabled: targetMemberId > 0,
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
    enabled: targetMemberId > 0,
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
    enabled: isOwnAndLoggedIn,
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
    onSuccess: (_data, item) => {
      setFallbackReports(curr => curr.filter(r => r.id !== item.id));
      void queryClient.invalidateQueries({
        queryKey: ["member", "community-reports", member.memberId],
      });
    },
  });

  const nickname = profileQuery.data?.nickname ?? member.nickname ?? "트레이더";
  const profileMsg =
    profileQuery.data?.profileMessage ?? "리스크 관리와 손절 원칙을 지키는 선물 트레이더입니다.";
  const followerCount = profileQuery.data?.followerCount ?? followers.length;
  const followingCount = profileQuery.data?.followingCount ?? followings.length;

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

  // 공개 포트폴리오 실데이터 바인딩 (SSR 시점 또는 미개설 시 기본 표시값 폴백)
  const livePortfolio =
    publicPortfolioQuery.data && publicPortfolioQuery.data.accountExists
      ? publicPortfolioQuery.data
      : null;

  const displayPositions = livePortfolio
    ? livePortfolio.positions.map((pos, idx) => ({
        id: pos.id,
        symbol: pos.symbol,
        nameKr: symbolNameKr(pos.symbol),
        side: pos.side,
        leverage: pos.leverage,
        quantity: `${pos.quantity} ${pos.symbol.replace(/USDT$/i, "")}`,
        entryPrice: pos.entryPrice,
        markPrice: pos.markPrice,
        liqPrice: pos.liquidationPrice,
        margin: `${pos.margin} USDT`,
        pnl: formatSignedUsdt(pos.unrealizedPnl),
        roe: formatSignedPct(pos.roePct),
        isPositive: isNonNegativeDecimal(pos.unrealizedPnl),
        marginRatio: Math.round(Number(pos.marginRatioPct) || 0),
        color: POSITION_COLORS[idx % POSITION_COLORS.length],
      }))
    : MOCK_POSITIONS;

  const usedMarginRatioDisplay = livePortfolio
    ? `${livePortfolio.allocation.usedMarginRatioPct}%`
    : "77.0%";
  const availableCashRatioDisplay = livePortfolio
    ? `${livePortfolio.allocation.availableCashRatioPct}%`
    : "23%";
  const longRatioDisplay = livePortfolio ? livePortfolio.allocation.longRatioPct : "87.7";
  const shortRatioDisplay = livePortfolio ? livePortfolio.allocation.shortRatioPct : "12.3";
  const longMarginDisplay = livePortfolio
    ? `${livePortfolio.allocation.longMarginUsdt} USDT`
    : "6,129.20 USDT";
  const shortMarginDisplay = livePortfolio
    ? `${livePortfolio.allocation.shortMarginUsdt} USDT`
    : "860.00 USDT";
  const longCountDisplay = livePortfolio ? livePortfolio.allocation.longPositionCount : 2;
  const shortCountDisplay = livePortfolio ? livePortfolio.allocation.shortPositionCount : 1;
  const usedMarginTotalDisplay = livePortfolio
    ? `${livePortfolio.wallet.usedMargin} USDT`
    : "6,989.20 USDT";
  const availableBalanceDisplay = livePortfolio
    ? `${livePortfolio.wallet.availableBalance} USDT`
    : "4,107.75 USDT";
  const winRateDisplay = livePortfolio
    ? `${livePortfolio.closedTradeSummary.winRatePct}% (${livePortfolio.closedTradeSummary.winCount}승 ${livePortfolio.closedTradeSummary.lossCount}패)`
    : "68.4% (13승 6패)";

  const assetSummary = livePortfolio
    ? {
        title: "모의투자 선물 지갑",
        totalAsset: `${livePortfolio.wallet.totalEquity} USDT`,
        cashBalance: `${livePortfolio.wallet.availableBalance} USDT`,
        totalBuyAmount: `${livePortfolio.wallet.usedMargin} USDT`,
        totalCoinValue: `${livePortfolio.wallet.balance} USDT`,
        totalProfit: formatSignedUsdt(livePortfolio.wallet.totalPnl),
        totalRoi: formatSignedPct(livePortfolio.wallet.totalRoiPct),
        isPositive: isNonNegativeDecimal(livePortfolio.wallet.totalPnl),
        unit: "USDT",
      }
    : {
        title: "모의투자 선물 지갑",
        totalAsset: "11,096.95 USDT",
        cashBalance: "4,107.75 USDT",
        totalBuyAmount: "6,989.20 USDT",
        totalCoinValue: "8,086.15 USDT",
        totalProfit: "+1,096.95 USDT",
        totalRoi: "+10.97%",
        isPositive: true,
        unit: "USDT",
      };

  // 원장 주문 내역 바인딩
  const liveOrders = ownerOrdersQuery.data
    ? ownerOrdersQuery.data.map((row, idx) => {
        const sym = String(row.symbol ?? "BTCUSDT");
        const sideRaw = String(row.side ?? "LONG");
        const isBuy = sideRaw === "LONG" || sideRaw === "BUY";
        const typeRaw = String(row.type ?? "MARKET");
        const statusRaw = String(row.status ?? "FILLED");
        const normalizedStatus =
          statusRaw === "FILLED"
            ? "COMPLETED"
            : statusRaw === "CANCELLED"
              ? "CANCELED"
              : statusRaw;
        return {
          id: typeof row.orderId === "number" ? row.orderId : typeof row.id === "number" ? row.id : idx + 1,
          orderedAt: String(row.createdAt ?? row.orderedAt ?? ""),
          symbol: sym,
          nameKr: symbolNameKr(sym).replace(" 무기한", ""),
          side: isBuy ? "BUY" : "SELL",
          sideLabel: isBuy ? "매수/롱" : "매도/숏",
          orderType: typeRaw,
          orderStatus: normalizedStatus,
          orderPrice: typeRaw === "MARKET" ? "시장가" : `${String(row.limitPrice ?? row.price ?? "0")} USDT`,
          orderQuantity: `${String(row.quantity ?? "0")} ${sym.replace(/USDT$/i, "")}`,
          filledQuantity: `${String(row.filledQuantity ?? row.quantity ?? "0")} ${sym.replace(/USDT$/i, "")}`,
          avgFilledPrice: `${String(row.executionPrice ?? row.averageFillPrice ?? "-")} USDT`,
        };
      })
    : null;

  const filteredOrders = (liveOrders ?? MOCK_ORDERS).filter(item => {
    if (filterSymbol && !item.symbol.includes(filterSymbol.toUpperCase())) return false;
    if (filterSide && item.side !== filterSide) return false;
    if (filterStatus && item.orderStatus !== filterStatus) return false;
    return true;
  });

  const openOrders = ownerPendingOrdersQuery.data
    ? ownerPendingOrdersQuery.data.map((row, idx) => {
        const sym = String(row.symbol ?? "BTCUSDT");
        const sideRaw = String(row.side ?? "LONG");
        const isBuy = sideRaw === "LONG" || sideRaw === "BUY";
        return {
          id: typeof row.orderId === "number" ? row.orderId : typeof row.id === "number" ? row.id : idx + 1,
          orderedAt: String(row.createdAt ?? ""),
          symbol: sym,
          nameKr: symbolNameKr(sym).replace(" 무기한", ""),
          side: isBuy ? "BUY" : "SELL",
          sideLabel: isBuy ? "매수/롱" : "매도/숏",
          orderType: String(row.type ?? "LIMIT"),
          orderStatus: "PENDING",
          orderPrice: `${String(row.limitPrice ?? row.price ?? "0")} USDT`,
          orderQuantity: `${String(row.quantity ?? "0")} ${sym.replace(/USDT$/i, "")}`,
          filledQuantity: `0 ${sym.replace(/USDT$/i, "")}`,
          avgFilledPrice: "-",
        };
      })
    : MOCK_ORDERS.filter(item => item.orderStatus === "PENDING");

  const closedPnlRows = (() => {
    const rawItems =
      ownerClosedPositionsQuery.data && Array.isArray(ownerClosedPositionsQuery.data.items)
        ? (ownerClosedPositionsQuery.data.items as Array<Record<string, unknown>>)
        : null;
    if (!rawItems) return MOCK_CLOSED_PNL;
    return rawItems.map((row, idx) => {
      const sym = String(row.symbol ?? "BTCUSDT");
      const netPnl = String(row.netPnl ?? row.realizedPnl ?? "0");
      return {
        id: typeof row.positionId === "number" ? row.positionId : idx + 1,
        closedAt: String(row.closedAt ?? ""),
        symbol: sym,
        nameKr: symbolNameKr(sym),
        side: String(row.side ?? "LONG"),
        leverage: typeof row.leverage === "number" ? row.leverage : 1,
        entryPrice: String(row.entryPrice ?? "0"),
        exitPrice: String(row.exitPrice ?? row.closePrice ?? "0"),
        quantity: `${String(row.closedQuantity ?? row.quantity ?? "0")} ${sym.replace(/USDT$/i, "")}`,
        realizedPnl: formatSignedUsdt(netPnl),
        roe: formatSignedPct(String(row.roePct ?? "0")),
        isPositive: isNonNegativeDecimal(netPnl),
      };
    });
  })();

  const tradeRows = ownerFillsQuery.data
    ? ownerFillsQuery.data.map((row, idx) => {
        const sym = String(row.symbol ?? "BTCUSDT");
        const sideRaw = String(row.side ?? "LONG");
        const isBuy = sideRaw === "LONG" || sideRaw === "BUY";
        const pnlRaw = String(row.realizedPnl ?? "0");
        return {
          id: typeof row.fillId === "number" ? row.fillId : idx + 1,
          executedAt: String(row.executedAt ?? ""),
          symbol: sym,
          nameKr: symbolNameKr(sym).replace(" 무기한", ""),
          side: isBuy ? "BUY" : "SELL",
          sideLabel: isBuy ? "매수/롱" : "매도/숏",
          price: `${String(row.executionPrice ?? row.price ?? "0")} USDT`,
          quantity: `${String(row.quantity ?? "0")} ${sym.replace(/USDT$/i, "")}`,
          totalAmount: `${String(row.notional ?? "0")} USDT`,
          fee: `${String(row.fee ?? "0")} USDT`,
          realizedProfit: formatSignedUsdt(pnlRaw),
        };
      })
    : MOCK_TRADES;

  function toggleFollowInModal(targetId: number) {
    setFollowers(curr =>
      curr.map(item => (item.memberId === targetId ? { ...item, following: !item.following } : item)),
    );
    setFollowings(curr =>
      curr.map(item => (item.memberId === targetId ? { ...item, following: !item.following } : item)),
    );
    if (isOwnAndLoggedIn) {
      const target =
        (followModalType === "followers" ? followers : followings).find(
          item => item.memberId === targetId,
        ) ?? null;
      const nextMethod = target?.following ? "DELETE" : "PUT";
      void session
        .request(`/members/${targetId}/follows`, { method: nextMethod })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ["member", "follow-modal"] });
          void queryClient.invalidateQueries({ queryKey: ["member", "profile"] });
        })
        .catch(() => {});
    }
  }

  const modalFollowList: FollowMemberItem[] = followModalQuery.data
    ? followModalQuery.data.content.map(entry => ({
        memberId: entry.memberId,
        nickname: entry.nickname,
        profileMsg: entry.profileMessage || "등록된 소개가 없습니다.",
        profileImgUrl: entry.profileImgUrl,
        following: followModalType === "followings",
        followsMe: followModalType === "followers",
      }))
    : followModalType === "followers"
      ? followers
      : followings;

  const liveMyPosts: CommunityPost[] | null = communityPostsInfinite.data
    ? communityPostsInfinite.data.pages.flatMap(p => p.items)
    : null;
  const liveMyComments: MemberCommunityCommentItem[] | null = communityCommentsInfinite.data
    ? communityCommentsInfinite.data.pages.flatMap(p => p.items)
    : null;
  const liveLikedPosts: CommunityPost[] | null = communityLikedPostsInfinite.data
    ? communityLikedPostsInfinite.data.pages.flatMap(p => p.items)
    : null;
  const liveLikedComments: MemberCommunityCommentItem[] | null =
    communityLikedCommentsInfinite.data
      ? communityLikedCommentsInfinite.data.pages.flatMap(p => p.items)
      : null;
  const liveReports: MemberCommunityReportItem[] | null = communityReportsInfinite.data
    ? communityReportsInfinite.data.pages.flatMap(p => p.items)
    : null;

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
          <div className="space-y-6 lg:col-span-4">
            <V1ProfileSidebar
              profile={{
                memberId: targetMemberId,
                nickname,
                profileMsg,
                profileImgUrl:
                  profileQuery.data?.profileImgUrl ?? profileQuery.data?.profileImageUrl,
                role: "USER",
                followerCount,
                followingCount,
              }}
              onClickFollowers={() => setFollowModalType("followers")}
              onClickFollowings={() => setFollowModalType("followings")}
              actionArea={
                isOwnAndLoggedIn ? (
                  <div className="space-y-2">
                    <Link
                      href="/me/settings"
                      className="flex h-10 w-full items-center justify-center rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      회원정보 수정
                    </Link>
                    <button
                      type="button"
                      onClick={() => void session.logout()}
                      className="flex h-9 w-full items-center justify-center rounded-xl bg-gray-100 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-200"
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
                      ? `${livePortfolio.roundNumber}회차 시드머니: ${livePortfolio.initialSeed} USDT`
                      : "1회차 시드머니: 10,000 USDT"}
                  </span>
                  <Link href="/trading" className="font-bold text-blue-400 hover:underline">
                    선물 거래소 이동 →
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
          <div className="space-y-6 lg:col-span-8">
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
                            <circle
                              cx="18"
                              cy="18"
                              r="14"
                              fill="none"
                              stroke="#0058FF"
                              strokeWidth="4.5"
                              strokeDasharray="45 55"
                              strokeDashoffset="0"
                            />
                            <circle
                              cx="18"
                              cy="18"
                              r="14"
                              fill="none"
                              stroke="#9CB34E"
                              strokeWidth="4.5"
                              strokeDasharray="22 78"
                              strokeDashoffset="-45"
                            />
                            <circle
                              cx="18"
                              cy="18"
                              r="14"
                              fill="none"
                              stroke="#1D7CA7"
                              strokeWidth="4.5"
                              strokeDasharray="10 90"
                              strokeDashoffset="-67"
                            />
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
                            <li key={pos.symbol} className="flex items-center justify-between">
                              <span className="flex items-center gap-2 font-bold text-gray-700">
                                <span
                                  className="inline-block h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: pos.color }}
                                />
                                {pos.symbol}
                              </span>
                              <span className="font-black text-gray-900">{pos.marginRatio}%</span>
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
                      <div className="grid grid-cols-2 gap-2 border-t border-gray-200 pt-3 text-xs">
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
                            {displayPositions.map(pos => (
                              <tr key={pos.id} className="hover:bg-gray-50">
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
                                  ${pos.liqPrice}
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold text-gray-700">
                                  {pos.margin}
                                </td>
                                <td className="px-4 py-3.5 text-right font-black text-red-500">
                                  <div>{pos.pnl}</div>
                                  <div className="text-[11px]">{pos.roe}</div>
                                </td>
                                <td className="px-4 py-3.5 text-right">
                                  <Link
                                    href={`/community/all?sharePosition=${pos.symbol.replace("USDT", "")}`}
                                    className="inline-flex h-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-bold text-[#0058FF] transition-colors hover:bg-blue-100"
                                  >
                                    포지션 공유
                                  </Link>
                                </td>
                              </tr>
                            ))}
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
                          <p className="mt-1 text-xl font-black text-red-500">
                            {livePortfolio
                              ? formatSignedUsdt(livePortfolio.wallet.realizedPnl)
                              : "+657.00 USDT"}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4">
                          <span className="text-xs font-bold text-gray-400">미실현 평가손익</span>
                          <p className="mt-1 text-xl font-black text-red-500">
                            {livePortfolio
                              ? formatSignedUsdt(livePortfolio.wallet.unrealizedPnl)
                              : "+1,096.95 USDT"}
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
                              <th className="px-4 py-3.5 text-right">실현손익 (ROE)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {closedPnlRows.map(row => (
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
                                  </span>
                                </td>
                                <td className="px-4 py-3.5 text-right">${row.entryPrice}</td>
                                <td className="px-4 py-3.5 text-right font-bold">${row.exitPrice}</td>
                                <td className="px-4 py-3.5 text-right">{row.quantity}</td>
                                <td
                                  className={`px-4 py-3.5 text-right font-black ${
                                    row.isPositive ? "text-red-500" : "text-blue-600"
                                  }`}
                                >
                                  {row.realizedPnl} ({row.roe})
                                </td>
                              </tr>
                            ))}
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
                          <option value="BUY">매수/롱</option>
                          <option value="SELL">매도/숏</option>
                        </select>
                        <select
                          aria-label="주문 상태 필터"
                          value={filterStatus}
                          onChange={e => setFilterStatus(e.target.value)}
                          className="h-9 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold"
                        >
                          <option value="">상태 전체</option>
                          <option value="PENDING">대기중</option>
                          <option value="PARTIALLY_FILLED">부분체결</option>
                          <option value="COMPLETED">체결완료</option>
                          <option value="CANCELED">취소</option>
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
                              <th className="px-4 py-3.5 text-right">체결수량</th>
                              <th className="px-4 py-3.5 text-right">상태</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {filteredOrders.map(order => (
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
                                <td className="px-4 py-3.5 text-right font-medium">{order.orderPrice}</td>
                                <td className="px-4 py-3.5 text-right">{order.orderQuantity}</td>
                                <td className="px-4 py-3.5 text-right font-bold">{order.filledQuantity}</td>
                                <td className="px-4 py-3.5 text-right font-bold text-gray-700">
                                  {order.orderStatus === "COMPLETED"
                                    ? "체결완료"
                                    : order.orderStatus === "CANCELED"
                                      ? "취소"
                                      : order.orderStatus === "PARTIALLY_FILLED"
                                        ? "부분체결"
                                        : "대기중"}
                                </td>
                              </tr>
                            ))}
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
                          {tradeRows.map(trade => (
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
                              <td className="px-4 py-3.5 text-right text-gray-500">{trade.fee}</td>
                              <td className="px-4 py-3.5 text-right font-black text-red-500">
                                {trade.realizedProfit}
                              </td>
                            </tr>
                          ))}
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
                          {openOrders.map(order => (
                            <tr key={order.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3.5 text-gray-500">{order.orderedAt}</td>
                              <td className="px-4 py-3.5 font-bold text-gray-900">
                                {order.nameKr} ({order.symbol})
                              </td>
                              <td className="px-4 py-3.5 font-bold text-blue-600">{order.sideLabel}</td>
                              <td className="px-4 py-3.5 text-right font-bold">{order.orderPrice}</td>
                              <td className="px-4 py-3.5 text-right">{order.orderQuantity}</td>
                              <td className="px-4 py-3.5 text-right">
                                <Link
                                  href="/trading"
                                  className="inline-flex rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-100"
                                >
                                  터미널에서 취소
                                </Link>
                              </td>
                            </tr>
                          ))}
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
                      <h3 className="text-lg font-black text-gray-900">
                        시즌별 대회 자산 현황
                      </h3>
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

                  {/* ① 내 시즌별 대회 실시간 자산 */}
                  <section className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#0058FF]">
                          LIVE · 2026 정규 시즌 2
                        </span>
                        <h4 className="text-sm font-black text-gray-900">
                          내 시즌별 대회 실시간 자산
                        </h4>
                      </div>
                      <span className="text-xs font-bold text-gray-500">
                        실시간 순위: <strong className="text-[#0058FF]">14위</strong> / 520명
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                        <span className="text-[11px] font-bold text-gray-400">실시간 대회 평가자산</span>
                        <p className="mt-1 text-base font-black text-gray-900">12,480.00 USDT</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                        <span className="text-[11px] font-bold text-gray-400">대회 가용 증거금</span>
                        <p className="mt-1 text-base font-black text-gray-900">8,480.00 USDT</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                        <span className="text-[11px] font-bold text-gray-400">실시간 대회 수익금</span>
                        <p className="mt-1 text-base font-black text-red-500">+2,480.00 USDT</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                        <span className="text-[11px] font-bold text-gray-400">실시간 대회 수익률(ROI)</span>
                        <p className="mt-1 text-base font-black text-red-500">+24.80%</p>
                      </div>
                    </div>
                  </section>

                  {/* ② 종료된 시즌의 대회 자산 */}
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-black text-gray-900">
                        종료된 시즌의 대회 자산 및 정산 이력
                      </h4>
                      <span className="text-xs font-medium text-gray-400">
                        총 {FINISHED_CONTEST_SEASONS.length}개 시즌 참가 완료
                      </span>
                    </div>

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
                          {FINISHED_CONTEST_SEASONS.map(season => (
                            <tr key={season.seasonId} className="hover:bg-gray-50">
                              <td className="px-4 py-3.5">
                                <div className="font-black text-gray-900">{season.seasonTitle}</div>
                                <div className="text-[11px] text-gray-400">{season.period}</div>
                              </td>
                              <td className="px-4 py-3.5 text-right text-gray-600">{season.seedMoney}</td>
                              <td className="px-4 py-3.5 text-right font-black text-gray-900">
                                {season.finalEquity}
                              </td>
                              <td className="px-4 py-3.5 text-right font-black text-red-500">
                                {season.finalRoi}
                              </td>
                              <td className="px-4 py-3.5 text-right font-bold text-[#0058FF]">
                                {season.finalRank}
                              </td>
                              <td className="px-4 py-3.5 text-right">
                                <div className="font-bold text-gray-800">{season.winRate}</div>
                                <span className="text-[11px] font-bold text-gray-400">{season.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
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
                              <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke="#0058FF"
                                strokeWidth="4.5"
                                strokeDasharray="45 55"
                                strokeDashoffset="0"
                              />
                              <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke="#9CB34E"
                                strokeWidth="4.5"
                                strokeDasharray="22 78"
                                strokeDashoffset="-45"
                              />
                              <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke="#1D7CA7"
                                strokeWidth="4.5"
                                strokeDasharray="10 90"
                                strokeDashoffset="-67"
                              />
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
                              <li key={pos.symbol} className="flex items-center justify-between">
                                <span className="flex items-center gap-2 font-bold text-gray-700">
                                  <span
                                    className="inline-block h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: pos.color }}
                                  />
                                  {pos.symbol}
                                </span>
                                <span className="font-black text-gray-900">{pos.marginRatio}%</span>
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

                        <div className="grid grid-cols-2 gap-2 border-t border-gray-200 pt-3 text-xs">
                          <div>
                            <span className="text-gray-400">평균 레버리지</span>
                            <p className="font-black text-gray-900">7.8x (격리)</p>
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
                            {displayPositions.map(pos => (
                              <tr key={pos.symbol} className="hover:bg-gray-50">
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
                                <td className="px-4 py-3.5 text-right font-black text-red-500">
                                  {pos.pnl} ({pos.roe})
                                </td>
                                <td className="px-4 py-3.5 text-right">
                                  <Link
                                    href={`/community/all?sharePosition=${pos.symbol.replace("USDT", "")}`}
                                    className="inline-flex h-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-bold text-[#0058FF] transition-colors hover:bg-blue-100"
                                  >
                                    포지션 공유
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <h3 className="text-base font-black text-gray-900">시즌별 대회 참가 성적 요약</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {FINISHED_CONTEST_SEASONS.map(season => (
                        <div
                          key={season.seasonId}
                          className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-5"
                        >
                          <span className="text-xs font-bold text-[#0058FF]">
                            {season.seasonTitle}
                          </span>
                          <p className="mt-2 text-2xl font-black text-red-500">{season.finalRoi}</p>
                          <p className="mt-1 text-xs font-bold text-gray-600">
                            최종 순위 {season.finalRank} · 승률 {season.winRate}
                          </p>
                        </div>
                      ))}
                    </div>
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
                    {liveMyPosts ? (
                      liveMyPosts.length === 0 ? (
                        <div className="py-10 text-center text-xs font-bold text-gray-400">
                          작성한 커뮤니티 게시글이 없습니다.
                        </div>
                      ) : (
                        liveMyPosts.map(post => (
                          <article key={post.id} className="rounded-xl border border-gray-200 p-4">
                            <div className="flex items-center justify-between text-xs text-gray-400">
                              <span className="font-bold text-[#0058FF]">
                                {communityCategoryLabel(post.category as CommunityCategory)}
                                {post.symbolTag ? ` · #${post.symbolTag}` : ""}
                              </span>
                              <span>{post.createdAt}</span>
                            </div>
                            <Link
                              href={`/community/all/${post.id}`}
                              className="mt-1 block text-sm font-black text-gray-900 hover:text-[#0058FF]"
                            >
                              {post.title}
                            </Link>
                            <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                              {post.content}
                            </p>
                          </article>
                        ))
                      )
                    ) : (
                      <article className="rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <span className="font-bold text-[#0058FF]">포지션 공유 · #BTC</span>
                          <span>2026-11-08</span>
                        </div>
                        <Link
                          href="/community"
                          className="mt-1 block text-sm font-black text-gray-900 hover:text-[#0058FF]"
                        >
                          BTC 10배 롱 포지션 진입 및 손절가 공유
                        </Link>
                        <p className="mt-1 text-xs text-gray-600">
                          지지 구간 확인 후 진입했으며 손절가는 -25% ROE 지점으로 설정했습니다.
                        </p>
                      </article>
                    )}
                  </div>
                )}

                {communityTab === "replies" && (
                  <div className="space-y-3">
                    {liveMyComments ? (
                      liveMyComments.length === 0 ? (
                        <div className="py-10 text-center text-xs font-bold text-gray-400">
                          작성한 댓글 내역이 없습니다.
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
                      )
                    ) : (
                      <div className="rounded-xl border border-gray-200 p-4 text-xs">
                        <p className="font-bold text-gray-900">
                          “감사합니다! 리스크 관리가 최우선입니다.”
                        </p>
                        <p className="mt-1 text-gray-400">
                          원문: BTC 10배 롱 포지션 진입 및 손절가 공유
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {communityTab === "likedPosts" && (
                  <div className="space-y-3">
                    {liveLikedPosts ? (
                      liveLikedPosts.length === 0 ? (
                        <div className="py-10 text-center text-xs font-bold text-gray-400">
                          좋아요한 게시글 내역이 없습니다.
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
                      )
                    ) : (
                      <div className="rounded-xl border border-gray-200 p-4 text-xs">
                        <span className="inline-flex items-center gap-1 font-bold text-gray-700">
                          <V1IconHeart className="h-3.5 w-3.5" />
                          <span>좋아요 표시한 게시글</span>
                        </span>
                        <p className="mt-1 text-sm font-black text-gray-900">
                          ETH/BTC 상대강도 반등 시그널 및 단기 스위칭 전략 공유
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {communityTab === "likedReplies" && (
                  <div className="space-y-3">
                    {liveLikedComments && liveLikedComments.length > 0 ? (
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
                    ) : (
                      <div className="py-10 text-center text-xs font-bold text-gray-400">
                        좋아요한 댓글 내역이 없습니다.
                      </div>
                    )}
                  </div>
                )}

                {isOwnAndLoggedIn && communityTab === "reports" && (
                  <div className="space-y-3">
                    {liveReports ? (
                      liveReports.length === 0 ? (
                        <div className="py-10 text-center text-xs font-bold text-gray-400">
                          접수된 신고 내역이 없습니다.
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
                      )
                    ) : fallbackReports.length === 0 ? (
                      <div className="py-10 text-center text-xs font-bold text-gray-400">
                        접수된 신고 내역이 없습니다.
                      </div>
                    ) : (
                      fallbackReports.map(item => (
                        <div
                          key={item.id}
                          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-gray-200 p-4 text-xs"
                        >
                          <div>
                            <span className="rounded bg-red-50 px-2 py-0.5 font-bold text-red-600">
                              게시글 신고 · {item.status}
                            </span>
                            <p className="mt-1.5 font-bold text-gray-900">{item.title}</p>
                            <p className="mt-0.5 text-gray-500">사유: {item.reason}</p>
                          </div>
                          <V1Button
                            variant="white"
                            size="xs"
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
        onClose={() => setFollowModalType(null)}
        title={followModalType === "followers" ? "팔로워 (Followers)" : "팔로잉 (Following)"}
        subtitle="회원 프로필을 클릭해 포트폴리오를 조회하거나 팔로우 상태를 변경할 수 있습니다."
      >
        <ul className="divide-y divide-gray-100">
          {modalFollowList.map(person => (
            <li key={person.memberId} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <V1UserAvatar
                  src={person.profileImgUrl}
                  memberId={person.memberId}
                  nickname={person.nickname}
                  size="md"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/members/${person.memberId}`}
                      className="text-sm font-bold text-gray-900 hover:text-[#0058FF]"
                      onClick={() => setFollowModalType(null)}
                    >
                      {person.nickname}
                    </Link>
                    {person.followsMe && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">
                        나를 팔로우 중
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{person.profileMsg}</p>
                </div>
              </div>
              <V1Button
                variant={person.following ? "gray" : "blue"}
                size="xs"
                onClick={() => toggleFollowInModal(person.memberId)}
              >
                {person.following ? "팔로잉" : "팔로우"}
              </V1Button>
            </li>
          ))}
        </ul>
      </DimModal>
    </MemberShell>
  );
}
