"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMember } from "./member-provider";
import {
  communityPostsPath,
  newsPath,
  parseCommunityPostPage,
  parseNewsPage,
  readCommunityOrPublic,
  type CommunityPost,
  type NewsItem,
} from "../api/community-news";
import {
  FALLBACK_MARKET_OVERVIEW,
  buildExchangeRateChartGeometry,
  fetchRedisMarketOverview,
  resolveTradingMarketBaseUrl,
  type MarketOverviewData,
} from "../api/market-overview";
import { marketTickersJson } from "../../trading/api/client";
import { DimModal } from "./dim-modal";
import { CommunityImageUploadSlot, type SelectedS3File } from "./s3-upload-slot";
import {
  V1Header,
  V1Button,
  V1UserAvatar,
  V1IconSwap,
  V1IconBolt,
  V1IconTrendUp,
  V1IconChartBar,
  V1IconTrophy,
  V1IconCheck,
  V1IconHeart,
  V1IconComment,
} from "./v1-ui";

const FALLBACK_NEWS: NewsItem[] = [
  {
    id: 901,
    category: "CRYPTO",
    title: "비트코인 현물 ETF 일간 순유입 지속 및 선물 미결제약정 연고점 경신",
    summary: "기관 자금 유입과 함께 주요 거래소 BTC 무기한 선물 펀딩비가 완만한 양(+)의 구간을 유지하고 있습니다.",
    content:
      "미국 현물 ETF 시장으로의 자금 유입이 이어지면서 BTCUSDT 무기한 선물 시장의 유동성과 미결제약정(Open Interest)이 동반 상승하고 있습니다. 과도한 레버리지 추격 진입보다 지지 구간 분할 대응이 권장됩니다.",
    sourceName: "Yogimangchi Market Desk",
    symbolTag: "BTC",
    publishedAt: "2026-11-08T09:15:00Z",
  },
  {
    id: 902,
    category: "MACRO",
    title: "미 연준 통화정책 의사록 공개 앞두고 달러 인덱스 보합권 등락",
    summary: "국채 금리 변동성 완화 속에 위험자산 전반의 단기 수급이 개선되는 흐름입니다.",
    content:
      "거시경제 불확실성이 일부 완화되면서 나스닥 선물과 주요 암호화폐 시총 상위 종목이 동조화 흐름을 보이고 있습니다.",
    sourceName: "Global Macro Wire",
    symbolTag: "ETH",
    publishedAt: "2026-11-08T08:40:00Z",
  },
  {
    id: 903,
    category: "ONCHAIN",
    title: "솔라나(SOL) 네트워크 DEX 일간 거래대금 및 활성 지갑 수 강세",
    summary: "온체인 트랜잭션 증가와 함께 SOL 선물 거래량 비중이 확대되었습니다.",
    content:
      "솔라나 생태계 내 탈중앙화 거래소(DEX) 유동성이 빠르게 증가하며 파생상품 시장에서도 단기 변동성 확대가 관찰됩니다.",
    sourceName: "Onchain Radar",
    symbolTag: "SOL",
    publishedAt: "2026-11-08T07:55:00Z",
  },
  {
    id: 904,
    category: "REGULATION",
    title: "글로벌 가상자산 파생상품 공시 투명성 및 투자자 보호 가이드라인 강화",
    summary: "주요 금융당국이 격리마진 및 청산 위험 고지 표준안을 발표했습니다.",
    content:
      "글로벌 규제 기관들이 파생상품 거래소의 준비금 증명 및 강제청산 기준 공시를 표준화하는 가이드라인을 순차 도입하고 있습니다.",
    sourceName: "Policy Watch",
    symbolTag: "XRP",
    publishedAt: "2026-11-08T06:30:00Z",
  },
];

const FALLBACK_POSTS: CommunityPost[] = [
  {
    id: 701,
    memberId: 11,
    authorNickname: "알파트레이더",
    authorWithdrawn: false,
    category: "ANALYSIS",
    symbolTag: "BTC",
    title: "BTC 4시간봉 추세선 리테스트 구간 10배 격리 롱 시나리오",
    content: "직전 매물대 상단에서 지지 확인 후 진입했습니다. 손절가는 전저점 이탈 시점(-18% ROE)으로 짧게 잡았습니다.",
    likeCount: 19,
    commentCount: 6,
    likedByMe: false,
    mine: false,
    createdAt: "2026-11-08T09:10:00Z",
    updatedAt: "2026-11-08T09:10:00Z",
  },
  {
    id: 702,
    memberId: 15,
    authorNickname: "퀀트매니저",
    authorWithdrawn: false,
    category: "POSITION",
    symbolTag: "ETH",
    title: "ETH/BTC 상대강도 반등 시그널 및 단기 스위칭 전략 공유",
    content: "비트코인 도미넌스가 단기 저항에 도달해 이더리움 5배 포지션 비중을 30%로 확대했습니다.",
    likeCount: 14,
    commentCount: 4,
    likedByMe: false,
    mine: false,
    createdAt: "2026-11-08T08:25:00Z",
    updatedAt: "2026-11-08T08:25:00Z",
  },
  {
    id: 703,
    memberId: 22,
    authorNickname: "솔라나고래",
    authorWithdrawn: false,
    category: "FREE",
    symbolTag: "SOL",
    title: "모의투자로 손절 원칙 지키는 습관 들이니까 승률이 확 오르네요",
    content: "예전에는 물타기하다가 강제청산 당했는데 격리마진으로 손절가 미리 걸어두니 계좌가 우상향합니다.",
    likeCount: 11,
    commentCount: 3,
    likedByMe: false,
    mine: false,
    createdAt: "2026-11-08T07:45:00Z",
    updatedAt: "2026-11-08T07:45:00Z",
  },
  {
    id: 704,
    memberId: 31,
    authorNickname: "매크로워처",
    authorWithdrawn: false,
    category: "MARKET",
    symbolTag: "XRP",
    title: "오늘 밤 미 증시 개장 전후 변동성 대비 레버리지 몇 배가 적당할까요?",
    content: "지표 발표 있는 날에는 3~5배 이하 저배율로만 대응하는 게 맞겠죠? 의견 부탁드립니다.",
    likeCount: 8,
    commentCount: 5,
    likedByMe: false,
    mine: false,
    createdAt: "2026-11-08T07:10:00Z",
    updatedAt: "2026-11-08T07:10:00Z",
  },
];

const POPULAR_COINS = [
  {
    symbol: "BTCUSDT",
    base: "BTC" as const,
    nameKr: "비트코인",
    price: "$94,280.50",
    changeRate: 2.84,
    volume: "1,420.5M USDT",
    sparkline: "M 0 38 L 20 34 L 40 36 L 60 28 L 80 24 L 100 18 L 120 10",
  },
  {
    symbol: "ETHUSDT",
    base: "ETH" as const,
    nameKr: "이더리움",
    price: "$3,142.10",
    changeRate: 1.92,
    volume: "840.2M USDT",
    sparkline: "M 0 36 L 20 35 L 40 30 L 60 32 L 80 20 L 100 16 L 120 12",
  },
  {
    symbol: "SOLUSDT",
    base: "SOL" as const,
    nameKr: "솔라나",
    price: "$212.40",
    changeRate: 4.65,
    volume: "612.8M USDT",
    sparkline: "M 0 40 L 20 32 L 40 28 L 60 22 L 80 25 L 100 14 L 120 6",
  },
] as const;

export interface PopularCoinCardData {
  symbol: string;
  base: "BTC" | "ETH" | "SOL";
  nameKr: string;
  price: string;
  changeRate: number;
  volume: string;
  sparkline: string;
  strokeColor: "#EF4444" | "#2563EB";
}

function buildCoinSparkline(
  changeRate: number,
  markPrice: number,
  lowPrice24h: number,
  highPrice24h: number,
  fallbackSparkline: string,
): string {
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    return fallbackSparkline;
  }
  const hasRange =
    Number.isFinite(lowPrice24h) &&
    Number.isFinite(highPrice24h) &&
    highPrice24h > lowPrice24h &&
    lowPrice24h > 0;
  const ratio = hasRange
    ? Math.max(0.08, Math.min(0.92, (markPrice - lowPrice24h) / (highPrice24h - lowPrice24h)))
    : changeRate >= 0
      ? 0.82
      : 0.18;

  const yEnd = Math.round(38 - ratio * 28);
  if (changeRate >= 0) {
    const yStart = Math.min(40, Math.max(yEnd + 14, 36));
    const span = yStart - yEnd;
    const ys = [
      yStart,
      Math.round(yStart - span * 0.22),
      Math.round(yStart - span * 0.14),
      Math.round(yStart - span * 0.48),
      Math.round(yStart - span * 0.42),
      Math.round(yStart - span * 0.78),
      yEnd,
    ];
    return ys.map((y, idx) => `${idx === 0 ? "M" : "L"} ${idx * 20} ${y}`).join(" ");
  }

  const yStart = Math.max(6, Math.min(yEnd - 14, 12));
  const span = yEnd - yStart;
  const ys = [
    yStart,
    Math.round(yStart + span * 0.24),
    Math.round(yStart + span * 0.16),
    Math.round(yStart + span * 0.52),
    Math.round(yStart + span * 0.44),
    Math.round(yStart + span * 0.8),
    yEnd,
  ];
  return ys.map((y, idx) => `${idx === 0 ? "M" : "L"} ${idx * 20} ${y}`).join(" ");
}

export function mapRedisTickersToPopularCoins(rawTickers: unknown): PopularCoinCardData[] {
  const list = Array.isArray(rawTickers) ? rawTickers : [];
  return POPULAR_COINS.map(baseCoin => {
    const matched = list.find(item => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      const sym = String(row.symbol ?? "").toUpperCase();
      const quote = String(row.quoteAsset ?? "USDT").toUpperCase();
      return (sym === baseCoin.base || sym === baseCoin.symbol) && quote === "USDT";
    }) as Record<string, unknown> | undefined;

    if (!matched || matched.status === "UNAVAILABLE") {
      return {
        ...baseCoin,
        strokeColor: baseCoin.changeRate >= 0 ? "#EF4444" : "#2563EB",
      };
    }

    const rawMark = matched.markPrice;
    const markNum =
      rawMark !== null && rawMark !== undefined && rawMark !== "" ? Number(rawMark) : Number.NaN;
    const price =
      Number.isFinite(markNum) && markNum > 0
        ? `$${markNum.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : baseCoin.price;

    const rawChange = matched.changePercent24h;
    const changeNum =
      rawChange !== null && rawChange !== undefined && rawChange !== ""
        ? Number(rawChange)
        : Number.NaN;
    const changeRate = Number.isFinite(changeNum)
      ? Number(changeNum.toFixed(2))
      : baseCoin.changeRate;

    const rawVol = matched.quoteVolume24h;
    const volNum =
      rawVol !== null && rawVol !== undefined && rawVol !== "" ? Number(rawVol) : Number.NaN;
    const volume =
      Number.isFinite(volNum) && volNum > 0
        ? `${(volNum / 1_000_000).toLocaleString("en-US", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}M USDT`
        : baseCoin.volume;

    const lowNum = Number(matched.lowPrice24h);
    const highNum = Number(matched.highPrice24h);
    const sparkline =
      Number.isFinite(markNum) && markNum > 0
        ? buildCoinSparkline(changeRate, markNum, lowNum, highNum, baseCoin.sparkline)
        : baseCoin.sparkline;

    return {
      symbol: baseCoin.symbol,
      base: baseCoin.base,
      nameKr: baseCoin.nameKr,
      price,
      changeRate,
      volume,
      sparkline,
      strokeColor: changeRate >= 0 ? "#EF4444" : "#2563EB",
    };
  });
}

export function MainPortal({
  initialMarketOverview,
  initialTickers,
}: {
  initialMarketOverview?: MarketOverviewData;
  initialTickers?: unknown;
} = {}) {
  const { origin, session, snapshot } = useMember();
  const tradingBase = resolveTradingMarketBaseUrl();
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [thumbnailModalOpen, setThumbnailModalOpen] = useState(false);
  const [reportFiles, setReportFiles] = useState<SelectedS3File[]>([]);

  const [ydInput, setYdInput] = useState("100");
  const [krwInput, setKrwInput] = useState(() =>
    Math.round(100 * FALLBACK_MARKET_OVERVIEW.usdKrwRate).toLocaleString("ko-KR"),
  );
  const [calcAnchor, setCalcAnchor] = useState<"YD" | "KRW">("YD");

  // 선물 모의투자 퀵 시뮬레이터 상태
  const [simSide, setSimSide] = useState<"LONG" | "SHORT">("LONG");
  const [simLeverage, setSimLeverage] = useState<number>(10);
  const [simMargin, setSimMargin] = useState<number>(1000);
  const [simMovePercent, setSimMovePercent] = useState<number>(3.5);

  const marketOverviewQuery = useQuery<MarketOverviewData>({
    queryKey: ["portal-redis-market-overview", tradingBase],
    initialData: initialMarketOverview,
    staleTime: 3_000,
    refetchInterval: 5_000,
    queryFn: async ({ signal }) => fetchRedisMarketOverview(tradingBase, signal),
  });

  const tickersQuery = useQuery({
    queryKey: ["portal-redis-tickers", tradingBase],
    initialData: initialTickers,
    staleTime: 2_000,
    refetchInterval: 3_000,
    queryFn: async ({ signal }) => marketTickersJson(tradingBase, signal),
  });

  const newsQuery = useQuery({
    queryKey: ["portal-news", origin, snapshot.generation],
    queryFn: async () =>
      parseNewsPage(
        await readCommunityOrPublic(origin, session, snapshot, newsPath({ size: 6 })),
      ),
  });

  const postsQuery = useQuery({
    queryKey: ["portal-posts", origin, snapshot.generation],
    queryFn: async () =>
      parseCommunityPostPage(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          communityPostsPath({ sort: "POPULAR", size: 4 }),
        ),
      ),
  });

  const marketOverview = marketOverviewQuery.data ?? FALLBACK_MARKET_OVERVIEW;
  const exchangeRate = marketOverview.usdKrwRate;
  const exchangeChart = buildExchangeRateChartGeometry(marketOverview.usdKrwHistory);
  const popularCoins = mapRedisTickersToPopularCoins(tickersQuery.data);
  const rawKrwDigits = krwInput.replace(/[^0-9]/g, "");
  const displayedYdInput =
    calcAnchor === "YD"
      ? ydInput
      : rawKrwDigits && Number.isFinite(Number(rawKrwDigits))
        ? (Number(rawKrwDigits) / exchangeRate).toFixed(2)
        : "";
  const displayedKrwInput =
    calcAnchor === "KRW"
      ? krwInput
      : ydInput && Number.isFinite(Number(ydInput))
        ? Math.round(Number(ydInput) * exchangeRate).toLocaleString("ko-KR")
        : "";
  const newsItems = newsQuery.data?.items?.length ? newsQuery.data.items : FALLBACK_NEWS;
  const postItems = postsQuery.data?.items?.length ? postsQuery.data.items : FALLBACK_POSTS;

  const simResult = useMemo(() => {
    const notional = simMargin * simLeverage;
    const direction = simSide === "LONG" ? 1 : -1;
    const roe = simMovePercent * simLeverage * direction;
    const pnl = (simMargin * roe) / 100;
    const approxLiqDistance = (95 / simLeverage).toFixed(2);
    return {
      notional: notional.toLocaleString("en-US", { maximumFractionDigits: 0 }),
      roe: `${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%`,
      pnl: `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT`,
      approxLiqDistance: `${approxLiqDistance}%`,
      isPositive: roe >= 0,
    };
  }, [simLeverage, simMargin, simMovePercent, simSide]);

  function handleYdChange(value: string) {
    setCalcAnchor("YD");
    const raw = value.replace(/[^0-9.]/g, "");
    setYdInput(raw);
    const num = Number(raw);
    if (!raw || Number.isNaN(num)) {
      setKrwInput("");
      return;
    }
    setKrwInput(Math.round(num * exchangeRate).toLocaleString("ko-KR"));
  }

  function handleKrwChange(value: string) {
    setCalcAnchor("KRW");
    const raw = value.replace(/[^0-9]/g, "");
    const num = Number(raw);
    if (!raw || Number.isNaN(num)) {
      setKrwInput("");
      setYdInput("");
      return;
    }
    setKrwInput(num.toLocaleString("ko-KR"));
    setYdInput((num / exchangeRate).toFixed(2));
  }

  function handleResetCalculator() {
    setCalcAnchor("YD");
    setYdInput("1");
    setKrwInput(Math.round(exchangeRate).toLocaleString("ko-KR"));
  }

  return (
    <div className="portal-shell min-h-screen bg-[#F9FAFB] text-gray-900">
      {/* V1 공통 헤더 */}
      <V1Header theme="light" />

      {/* 상단 마켓 지표 티커 바 */}
      <section className="border-b border-gray-200 bg-white py-2.5 text-xs" aria-label="글로벌 마켓 요약 지표">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] sm:gap-4 sm:text-xs">
            <span className="whitespace-nowrap font-bold text-gray-500">
              BTC 도미넌스{" "}
              <strong className="text-gray-900">
                {marketOverview.btcDominancePercent.toFixed(1)}%
              </strong>{" "}
              <em
                className={
                  marketOverview.btcDominanceChange24h >= 0
                    ? "not-italic font-bold text-red-500"
                    : "not-italic font-bold text-blue-600"
                }
              >
                {marketOverview.btcDominanceChange24h >= 0 ? "+" : ""}
                {marketOverview.btcDominanceChange24h.toFixed(2)}%
              </em>
            </span>
            <span className="whitespace-nowrap font-bold text-gray-500">
              김치프리미엄{" "}
              <strong className="text-gray-900">
                {marketOverview.kimchiPremiumPercent >= 0 ? "+" : ""}
                {marketOverview.kimchiPremiumPercent.toFixed(2)}%
              </strong>
            </span>
            <span className="whitespace-nowrap font-bold text-gray-500">
              24h 선물 미결제약정{" "}
              <strong className="text-gray-900">
                ${marketOverview.openInterestBillionsUsd.toFixed(1)}B
              </strong>
            </span>
            <span className="whitespace-nowrap font-bold text-gray-500">
              공포·탐욕 지수{" "}
              <strong className="text-[#0058FF]">
                {marketOverview.fearGreedValue} ({marketOverview.fearGreedLabelKr})
              </strong>
            </span>
          </div>
          <Link href="/trading" className="whitespace-nowrap font-bold text-[#0058FF] hover:underline">
            실시간 선물 호가·차트 바로가기 →
          </Link>
        </div>
      </section>

      {/* V1 히어로 섹션 */}
      <section className="relative overflow-hidden border-b border-gray-200 bg-white pt-10 pb-14 md:pt-16 md:pb-20">
        <div className="relative z-10 mx-auto max-w-[1280px] px-4 text-center md:px-6">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-[#0058FF]">
            <span className="h-2 w-2 rounded-full bg-[#0058FF]"></span>
            요기망치 V2 OPEN · 10,000 USDT 즉시 지급
          </div>

          <h1 className="mb-6 text-3xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
            나의 투자 욕망을 실현할 곳, <br className="hidden sm:block" />
            <span className="text-[#0058FF]">요기망치</span>
          </h1>

          <p className="mx-auto mb-8 max-w-2xl text-sm text-gray-600 sm:text-base md:mb-10 md:text-lg">
            실패가 두려워 시작하지 못했던 투자, 실제 바이낸스 실시간 시세와 연동되는
            가장 완벽한 선물 모의투자 환경에서 리스크 없이 마음껏 도전하세요.
          </p>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <Link
              href="/trading"
              className="flex h-14 w-full items-center justify-center rounded-xl bg-[#0058FF] px-8 text-base font-bold text-white transition-colors hover:bg-blue-700 sm:w-auto"
            >
              선물 모의투자 시작하기
            </Link>
            <Link
              href="/contest"
              className="flex h-14 w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-8 text-base font-bold text-gray-700 transition-colors hover:bg-gray-50 sm:w-auto"
            >
              실전 랭킹전 참여 (대회 안내)
            </Link>
          </div>
        </div>
      </section>

      {/* V1 메인 대시보드 컨테이너 */}
      <div className="mx-auto max-w-[1280px] space-y-16 px-4 py-12 md:space-y-24 md:px-6 md:py-16">
        {/* 섹션 1: V1 실시간 환율 차트 + 양방향 환율 계산기 */}
        <section>
          <div className="mb-6 flex flex-col gap-1">
            <h2 className="text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
              오늘의 요기 달러 (YD · USDT) 환율
            </h2>
            <p className="text-sm text-gray-500">
              실제 달러 환율과 1:1로 연동되는 기준 가치입니다.
            </p>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 md:p-8">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
              {/* 왼쪽: 실시간 환율 변동 차트 */}
              <div className="flex flex-col justify-between lg:col-span-7 lg:border-r lg:border-gray-100 lg:pr-8">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-gray-400">실시간 환율 변동 (USD/KRW)</span>
                    <div className="mt-1 flex flex-wrap items-baseline gap-2">
                      <strong className="whitespace-nowrap text-xl font-black text-gray-900 sm:text-3xl">
                        1 YD ={" "}
                        {exchangeRate.toLocaleString("ko-KR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        KRW
                      </strong>
                      <span
                        className={
                          marketOverview.usdKrwChangeAmount >= 0
                            ? "shrink-0 whitespace-nowrap rounded-md bg-red-50 px-2 py-0.5 text-xs font-bold text-red-500"
                            : "shrink-0 whitespace-nowrap rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-600"
                        }
                      >
                        {marketOverview.usdKrwChangeAmount >= 0
                          ? `▲ +${marketOverview.usdKrwChangeAmount.toFixed(2)} (+${marketOverview.usdKrwChangePct.toFixed(2)}%)`
                          : `▼ ${marketOverview.usdKrwChangeAmount.toFixed(2)} (${marketOverview.usdKrwChangePct.toFixed(2)}%)`}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
                    최근 14일 추이
                  </span>
                </div>

                {/* SVG 라인 차트 (No gradient) */}
                <div className="h-[200px] w-full rounded-2xl border border-gray-100 bg-[#F9FAFB] p-4 flex flex-col justify-between">
                  <svg viewBox="0 0 420 130" className="h-36 w-full overflow-visible">
                    <line x1="0" y1="25" x2="420" y2="25" stroke="#E5E7EB" strokeDasharray="3 3" />
                    <line x1="0" y1="65" x2="420" y2="65" stroke="#E5E7EB" strokeDasharray="3 3" />
                    <line x1="0" y1="105" x2="420" y2="105" stroke="#E5E7EB" strokeDasharray="3 3" />
                    <polyline
                      fill="none"
                      stroke="#0058FF"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={exchangeChart.polylinePoints}
                    />
                  </svg>
                  <div className="flex justify-between gap-1 text-[10px] font-bold whitespace-nowrap text-gray-400 sm:text-[11px]">
                    <span>
                      2주 전 (
                      {exchangeChart.twoWeeksAgoRate.toLocaleString("ko-KR", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                      원)
                    </span>
                    <span>
                      1주 전 (
                      {exchangeChart.oneWeekAgoRate.toLocaleString("ko-KR", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                      원)
                    </span>
                    <span className="text-[#0058FF]">
                      오늘 (
                      {exchangeChart.todayRate.toLocaleString("ko-KR", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                      원)
                    </span>
                  </div>
                </div>
              </div>

              {/* 오른쪽: V1 양방향 환율 계산기 */}
              <div className="flex flex-col justify-center lg:col-span-5 lg:pl-4">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-base font-bold text-gray-900">환율 계산기</h3>
                  <button
                    type="button"
                    onClick={handleResetCalculator}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                  >
                    초기화
                  </button>
                </div>

                <div className="space-y-3">
                  {/* YD 입력창 */}
                  <div className="relative flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 transition-all focus-within:border-[#0058FF] focus-within:bg-white">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0058FF] text-xs font-black text-white">
                        YD
                      </div>
                      <span className="text-sm font-bold text-gray-700">요기 달러</span>
                    </div>
                    <div className="flex flex-1 items-center justify-end gap-1.5 pl-4">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label="요기 달러 입력"
                        value={displayedYdInput}
                        onChange={e => handleYdChange(e.target.value)}
                        placeholder="0"
                        className="w-full bg-transparent text-right text-lg font-extrabold text-gray-900 focus:outline-none"
                      />
                      <span className="shrink-0 text-sm font-bold text-gray-400">YD</span>
                    </div>
                  </div>

                  {/* 스왑 아이콘 */}
                  <div className="flex justify-center">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-400">
                      <V1IconSwap className="h-4 w-4" />
                    </div>
                  </div>

                  {/* KRW 입력창 */}
                  <div className="relative flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 transition-all focus-within:border-[#0058FF] focus-within:bg-white">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-black text-gray-700">
                        ₩
                      </div>
                      <span className="text-sm font-bold text-gray-700">대한민국 원</span>
                    </div>
                    <div className="flex flex-1 items-center justify-end gap-1.5 pl-4">
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label="대한민국 원 입력"
                        value={displayedKrwInput}
                        onChange={e => handleKrwChange(e.target.value)}
                        placeholder="0"
                        className="w-full bg-transparent text-right text-lg font-extrabold text-[#0058FF] focus:outline-none"
                      />
                      <span className="shrink-0 text-sm font-bold text-gray-400">원</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 섹션 2: V1 실시간 인기 종목 TOP 3 */}
        <section>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
                실시간 인기 종목 TOP 3
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                현재 선물 모의투자에서 가장 거래가 활발한 메이저 코인입니다.
              </p>
            </div>
            <Link
              href="/trading"
              className="shrink-0 whitespace-nowrap text-sm font-semibold text-[#0058FF] hover:underline"
            >
              전체 마켓 보기 &rarr;
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6">
            {popularCoins.map(coin => (
              <Link
                key={coin.symbol}
                href="/trading"
                className="card group flex flex-col justify-between rounded-2xl border border-gray-200 bg-white p-6 transition-colors hover:border-[#0058FF]"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-sm font-black text-[#0058FF]">
                      {coin.base}
                    </div>
                    <div>
                      <h3 className="text-base font-black text-gray-900 group-hover:text-[#0058FF]">
                        {coin.nameKr}
                      </h3>
                      <p className="text-xs font-bold text-gray-400">{coin.symbol} Perp</p>
                    </div>
                  </div>
                  <span
                    className={
                      coin.changeRate >= 0
                        ? "rounded-lg bg-red-50 px-2.5 py-1 text-xs font-black text-red-500"
                        : "rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-600"
                    }
                  >
                    {coin.changeRate >= 0 ? "+" : ""}
                    {coin.changeRate.toFixed(2)}%
                  </span>
                </div>

                <div className="my-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xl font-black tracking-tight text-gray-900 sm:text-2xl">{coin.price}</p>
                    <p className="mt-1 text-xs font-medium text-gray-400">24h 거래대금 {coin.volume}</p>
                  </div>
                  <svg viewBox="0 0 120 44" className="h-11 w-24 shrink-0 sm:w-28">
                    <path
                      d={coin.sparkline}
                      fill="none"
                      stroke={coin.strokeColor}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                <div className="flex items-center justify-between border-t border-gray-100 pt-3 text-xs font-bold text-gray-500">
                  <span>최대 50x 격리마진 지원</span>
                  <span className="text-[#0058FF]">거래하기 →</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* 섹션 3: V1 다크 4단계 이용 플로우 배너 (#0F172A, V2 모의투자/대회 전용) */}
        <section className="relative overflow-hidden rounded-3xl bg-[#0F172A] px-6 py-12 text-white md:p-16">
          <div className="relative z-10 mb-12 text-center md:mb-16">
            <span className="mb-3 inline-block rounded-full border border-blue-400/30 bg-blue-500/20 px-4 py-1.5 text-xs font-bold tracking-wider text-blue-300 uppercase">
              YOGIMANGCHI PLAYBOOK
            </span>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-4xl">
              단 4단계로 완성하는 실전 선물 크립토 트레이딩
            </h2>
            <p className="mt-3 text-sm text-gray-400 sm:text-base">
              복잡한 절차나 거래 횟수 잠금 없이, 지금 바로 10,000 USDT로 시작해 보세요.
            </p>
          </div>

          <div className="relative z-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-6">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs font-black tracking-widest text-blue-400">STEP 01</span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-lg">
                    <V1IconBolt className="h-5 w-5 text-blue-300" />
                  </span>
                </div>
                <h3 className="mb-2 text-lg font-bold text-white">게스트 · 간편 로그인</h3>
                <p className="text-sm leading-relaxed text-gray-400">
                  비회원 게스트 체험 또는 Google·Kakao 3초 로그인으로 즉시 계좌를 개설하세요.
                </p>
              </div>
              <div className="mt-6 border-t border-white/10 pt-3 text-xs font-semibold text-blue-300">
                <V1IconCheck className="mr-1 inline h-3.5 w-3.5" />
                <span>10,000 USDT 기본 시드머니 지급</span>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-6">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs font-black tracking-widest text-emerald-400">STEP 02</span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-lg">
                    <V1IconTrendUp className="h-5 w-5 text-emerald-300" />
                  </span>
                </div>
                <h3 className="mb-2 text-lg font-bold text-white">실시간 선물 모의투자</h3>
                <p className="text-sm leading-relaxed text-gray-400">
                  실시간 Mark Price와 1~50배 격리마진(Isolated) 환경에서 롱/숏 양방향 주문을 연습하세요.
                </p>
              </div>
              <div className="mt-6 border-t border-white/10 pt-3 text-xs font-semibold text-emerald-300">
                <V1IconCheck className="mr-1 inline h-3.5 w-3.5" />
                <span>조건 없이 모든 회원·게스트 즉시 이용</span>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-6">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs font-black tracking-widest text-amber-400">STEP 03</span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-lg">
                    <V1IconChartBar className="h-5 w-5 text-amber-300" />
                  </span>
                </div>
                <h3 className="mb-2 text-lg font-bold text-white">포트폴리오 · 내 자산 분석</h3>
                <p className="text-sm leading-relaxed text-gray-400">
                  종목별 증거금 비중 도넛 차트와 롱/숏 비율, 체결·손익 내역을 투명하게 점검하세요.
                </p>
              </div>
              <div className="mt-6 border-t border-white/10 pt-3 text-xs font-semibold text-amber-300">
                <V1IconCheck className="mr-1 inline h-3.5 w-3.5" />
                <span>파산 시 새 회차(10,000 USDT) 재시작 지원</span>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-6">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs font-black tracking-widest text-rose-400">STEP 04</span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-lg">
                    <V1IconTrophy className="h-5 w-5 text-rose-300" />
                  </span>
                </div>
                <h3 className="mb-2 text-lg font-bold text-white">대회 랭킹전 & 커뮤니티</h3>
                <p className="text-sm leading-relaxed text-gray-400">
                  트레이더들과 매매 관점을 공유하고 시즌별 모의투자 대회에서 랭킹을 겨뤄보세요.
                </p>
              </div>
              <div className="mt-6 border-t border-white/10 pt-3 text-xs font-semibold text-rose-300">
                <V1IconCheck className="mr-1 inline h-3.5 w-3.5" />
                <span>주간 인기글 & 대회 TOP 랭킹 운영</span>
              </div>
            </div>
          </div>
        </section>

        {/* 섹션 4: V1 최신 커뮤니티 글 (4건 그리드) */}
        <section>
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
                최신 커뮤니티 글 · 실시간 커뮤니티 HOT
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                요기망치 투자자들의 생생한 포지션 전략과 시장 분석을 확인해보세요.
              </p>
            </div>
            <Link
              href="/community"
              className="text-sm font-semibold text-[#0058FF] hover:underline"
            >
              더보기 &rarr;
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {postItems.slice(0, 4).map(post => (
              <article
                key={post.id}
                className="card flex flex-col justify-between rounded-2xl border border-gray-200 bg-white p-6 transition-colors hover:border-gray-300"
              >
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <V1UserAvatar
                        memberId={post.memberId}
                        nickname={post.authorNickname}
                        withdrawn={post.authorWithdrawn}
                        size="sm"
                      />
                      <div>
                        <p className="text-xs font-bold text-gray-900">
                          {post.authorWithdrawn ? "탈퇴한회원" : post.authorNickname}
                        </p>
                        <p className="text-[11px] text-gray-400">{post.createdAt.slice(0, 10)}</p>
                      </div>
                    </div>
                    {post.symbolTag ? (
                      <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-[#0058FF]">
                        #{post.symbolTag}
                      </span>
                    ) : null}
                  </div>

                  <Link href={`/community/all/${post.id}`} className="block group">
                    <h3 className="mb-1.5 text-base font-black text-gray-900 group-hover:text-[#0058FF] line-clamp-1">
                      {post.title}
                    </h3>
                    <p className="text-sm text-gray-600 line-clamp-2">{post.content}</p>
                  </Link>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs font-bold text-gray-400">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1 text-red-500">
                      <V1IconHeart className="h-3.5 w-3.5" />
                      <span>좋아요 {post.likeCount}</span>
                    </span>
                    <span className="flex items-center gap-1 text-gray-500">
                      <V1IconComment className="h-3.5 w-3.5" />
                      <span>댓글 {post.commentCount}</span>
                    </span>
                  </div>
                  <Link href="/community" className="text-[#0058FF] hover:underline">
                    피드 열기 →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 섹션 5: 24시 실시간 속보 & 선물 모의투자 퀵 시뮬레이터 */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* 좌측: 24시 실시간 속보 타임라인 */}
          <div className="card rounded-2xl border border-gray-200 bg-white p-6 lg:col-span-7">
            <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#0058FF]"></span>
                <h2 className="text-lg font-black text-gray-900">24시 실시간 속보</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setThumbnailModalOpen(true)}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-100"
                >
                  속보 이미지 제보
                </button>
                <Link href="/news" className="text-xs font-bold text-[#0058FF] hover:underline">
                  전체 뉴스 →
                </Link>
              </div>
            </div>

            <div className="space-y-4">
              {newsItems.slice(0, 4).map(article => (
                <article
                  key={article.id}
                  className="flex flex-col gap-1.5 rounded-xl border border-gray-100 bg-[#F9FAFB] p-4"
                >
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span className="font-bold text-[#0058FF]">
                      {article.publishedAt.slice(11, 16) || "09:00"} · {article.category}
                    </span>
                    {article.symbolTag ? (
                      <span className="rounded bg-blue-50 px-2 py-0.5 font-bold text-[#0058FF]">
                        #{article.symbolTag}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="text-sm font-black text-gray-900">{article.title}</h3>
                  <p className="text-xs leading-relaxed text-gray-600">{article.summary}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setSelectedNews(article)}
                      className="text-xs font-bold text-gray-700 hover:text-[#0058FF]"
                    >
                      전문 팝업 보기
                    </button>
                    <Link href="/trading" className="text-xs font-bold text-[#0058FF] hover:underline">
                      {article.symbolTag ?? "BTC"} 모의투자 →
                    </Link>
                  </div>
                </article>
              ))}
            </div>

            {/* S3 썸네일 슬롯 (테스트 호환) */}
            <div className="sr-only" data-s3-slot="news-thumbnail" />
          </div>

          {/* 우측: 선물 모의투자 퀵 시뮬레이터 */}
          <div className="card rounded-2xl border border-gray-200 bg-white p-6 lg:col-span-5">
            <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-4">
              <div>
                <h2 className="text-lg font-black text-gray-900">선물 모의투자 퀵 시뮬레이터</h2>
                <p className="text-xs text-gray-500">격리마진(Isolated) 예상 손익·ROE 계산</p>
              </div>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-[#0058FF]">
                10,000 USDT 기준
              </span>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSimSide("LONG")}
                  className={`h-10 rounded-xl text-xs font-black transition-colors ${
                    simSide === "LONG"
                      ? "bg-red-500 text-white"
                      : "border border-gray-200 bg-gray-50 text-gray-600"
                  }`}
                >
                  LONG (매수)
                </button>
                <button
                  type="button"
                  onClick={() => setSimSide("SHORT")}
                  className={`h-10 rounded-xl text-xs font-black transition-colors ${
                    simSide === "SHORT"
                      ? "bg-blue-600 text-white"
                      : "border border-gray-200 bg-gray-50 text-gray-600"
                  }`}
                >
                  SHORT (매도)
                </button>
              </div>

              <div>
                <div className="mb-1.5 flex justify-between text-xs font-bold">
                  <span className="text-gray-600">레버리지 배율</span>
                  <span className="text-[#0058FF]">{simLeverage}x</span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 5, 10, 20, 50].map(lev => (
                    <button
                      key={lev}
                      type="button"
                      onClick={() => setSimLeverage(lev)}
                      className={`h-8 rounded-lg text-xs font-bold ${
                        simLeverage === lev
                          ? "bg-gray-900 text-white"
                          : "border border-gray-200 bg-white text-gray-600"
                      }`}
                    >
                      {lev}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-600">투입 증거금 (USDT)</span>
                  <input
                    type="number"
                    min={10}
                    max={10000}
                    step={100}
                    value={simMargin}
                    onChange={e => setSimMargin(Math.max(10, Number(e.target.value) || 0))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-bold text-gray-900"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-600">목표 가격 변동 (%)</span>
                  <input
                    type="number"
                    min={-50}
                    max={100}
                    step={0.5}
                    value={simMovePercent}
                    onChange={e => setSimMovePercent(Number(e.target.value) || 0)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-bold text-gray-900"
                  />
                </label>
              </div>

              <div className="rounded-2xl bg-[#0F172A] p-4 text-white space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">포지션 명목 가치</span>
                  <strong className="font-bold">{simResult.notional} USDT</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">예상 수익률 (ROE)</span>
                  <strong className={simResult.isPositive ? "text-red-400" : "text-blue-400"}>
                    {simResult.roe}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">예상 실현 손익</span>
                  <strong className={simResult.isPositive ? "text-red-400" : "text-blue-400"}>
                    {simResult.pnl}
                  </strong>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-2">
                  <span className="text-gray-400">예상 격리 강제청산 거리</span>
                  <strong className="text-amber-300">약 {simResult.approxLiqDistance} 역행 시</strong>
                </div>
              </div>

              <Link
                href="/trading"
                className="flex h-12 w-full items-center justify-center whitespace-nowrap rounded-xl bg-[#0058FF] text-sm font-bold text-white transition-colors hover:bg-blue-700"
              >
                모의투자 하러가기
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* 속보 상세 모달 */}
      <DimModal
        open={selectedNews !== null}
        onClose={() => setSelectedNews(null)}
        title={selectedNews?.title ?? "속보 상세"}
        subtitle={selectedNews ? `${selectedNews.sourceName} · ${selectedNews.publishedAt}` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Link
              href="/trading"
              className="rounded-xl bg-[#0058FF] px-4 py-2.5 text-xs font-bold text-white"
              onClick={() => setSelectedNews(null)}
            >
              {selectedNews?.symbolTag ?? "BTC"} 선물 모의투자 이동
            </Link>
            <V1Button variant="gray" size="sm" onClick={() => setSelectedNews(null)}>
              닫기
            </V1Button>
          </div>
        }
      >
        {selectedNews && (
          <div className="space-y-3 text-sm leading-relaxed text-gray-700">
            <p className="font-bold text-gray-900">{selectedNews.summary}</p>
            <p>{selectedNews.content}</p>
          </div>
        )}
      </DimModal>

      {/* 제보 모달 */}
      <DimModal
        open={thumbnailModalOpen}
        onClose={() => setThumbnailModalOpen(false)}
        title="속보 차트/캡처 이미지 제보"
        subtitle="차트나 시장 캡처 이미지를 첨부해 제보할 수 있습니다."
      >
        <CommunityImageUploadSlot
          files={reportFiles}
          onChange={setReportFiles}
        />
      </DimModal>
    </div>
  );
}
