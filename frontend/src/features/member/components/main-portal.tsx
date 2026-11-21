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
  type NewsItem,
} from "../api/community-news";
import {
  buildExchangeRateChartGeometry,
  fetchRedisMarketOverview,
  resolveTradingMarketBaseUrl,
  type MarketOverviewData,
} from "../api/market-overview";
import { marketTickersJson } from "../../trading/api/client";
import { DimModal } from "./dim-modal";
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

const FEATURED_COINS = [
  { symbol: "BTCUSDT", base: "BTC" as const, nameKr: "비트코인" },
  { symbol: "ETHUSDT", base: "ETH" as const, nameKr: "이더리움" },
  { symbol: "SOLUSDT", base: "SOL" as const, nameKr: "솔라나" },
] as const;

export interface PopularCoinCardData {
  symbol: string;
  base: "BTC" | "ETH" | "SOL";
  nameKr: string;
  available: boolean;
  price: string | null;
  changeRate: number | null;
  volume: string | null;
  high24h: string | null;
  low24h: string | null;
  trendColor: "#0ECB81" | "#F6465D" | "#6B7280";
}

function formatUsdPrice(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function mapRedisTickersToPopularCoins(rawTickers: unknown): PopularCoinCardData[] {
  const list = Array.isArray(rawTickers) ? rawTickers : [];
  return FEATURED_COINS.map(baseCoin => {
    const matched = list.find(item => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      const sym = String(row.symbol ?? "").toUpperCase();
      const quote = String(row.quoteAsset ?? "USDT").toUpperCase();
      return (sym === baseCoin.base || sym === baseCoin.symbol) && quote === "USDT";
    }) as Record<string, unknown> | undefined;

    if (!matched || matched.status === "UNAVAILABLE") {
      return {
        symbol: baseCoin.symbol,
        base: baseCoin.base,
        nameKr: baseCoin.nameKr,
        available: false,
        price: null,
        changeRate: null,
        volume: null,
        high24h: null,
        low24h: null,
        trendColor: "#6B7280",
      };
    }

    const rawMark = matched.markPrice;
    const markNum =
      rawMark !== null && rawMark !== undefined && rawMark !== "" ? Number(rawMark) : Number.NaN;
    if (!Number.isFinite(markNum) || markNum <= 0) {
      return {
        symbol: baseCoin.symbol,
        base: baseCoin.base,
        nameKr: baseCoin.nameKr,
        available: false,
        price: null,
        changeRate: null,
        volume: null,
        high24h: null,
        low24h: null,
        trendColor: "#6B7280",
      };
    }

    const rawChange = matched.changePercent24h;
    const changeNum =
      rawChange !== null && rawChange !== undefined && rawChange !== ""
        ? Number(rawChange)
        : Number.NaN;
    const changeRate = Number.isFinite(changeNum) ? Number(changeNum.toFixed(2)) : null;

    const rawVol = matched.quoteVolume24h;
    const volNum =
      rawVol !== null && rawVol !== undefined && rawVol !== "" ? Number(rawVol) : Number.NaN;
    const volume =
      Number.isFinite(volNum) && volNum > 0
        ? `${(volNum / 1_000_000).toLocaleString("en-US", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}M USDT`
        : null;

    const highNum = Number(matched.highPrice24h);
    const lowNum = Number(matched.lowPrice24h);
    const high24h = Number.isFinite(highNum) && highNum > 0 ? formatUsdPrice(highNum) : null;
    const low24h = Number.isFinite(lowNum) && lowNum > 0 ? formatUsdPrice(lowNum) : null;

    const trendColor: "#0ECB81" | "#F6465D" | "#6B7280" =
      changeRate === null
        ? "#6B7280"
        : changeRate > 0
          ? "#0ECB81"
          : changeRate < 0
            ? "#F6465D"
            : "#6B7280";

    return {
      symbol: baseCoin.symbol,
      base: baseCoin.base,
      nameKr: baseCoin.nameKr,
      available: true,
      price: formatUsdPrice(markNum),
      changeRate,
      volume,
      high24h,
      low24h,
      trendColor,
    };
  });
}

export function MainPortal({
  initialMarketOverview,
  initialTickers,
}: {
  initialMarketOverview?: MarketOverviewData | null;
  initialTickers?: unknown;
} = {}) {
  const { origin, session, snapshot } = useMember();
  const tradingBase = resolveTradingMarketBaseUrl();
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);

  const [ydInput, setYdInput] = useState("100");
  const [krwInput, setKrwInput] = useState("");
  const [calcAnchor, setCalcAnchor] = useState<"YD" | "KRW">("YD");

  // 선물 모의투자 퀵 시뮬레이터 상태
  const [simSide, setSimSide] = useState<"LONG" | "SHORT">("LONG");
  const [simLeverage, setSimLeverage] = useState<number>(10);
  const [simMargin, setSimMargin] = useState<number>(1000);
  const [simMarginInput, setSimMarginInput] = useState<string>("1000");
  const [simMovePercent, setSimMovePercent] = useState<number>(3.5);

  const marketOverviewQuery = useQuery<MarketOverviewData | null>({
    queryKey: ["portal-redis-market-overview", tradingBase],
    initialData: initialMarketOverview ?? undefined,
    staleTime: 3_000,
    refetchInterval: selectedNews !== null ? false : 5_000,
    queryFn: async ({ signal }) => fetchRedisMarketOverview(tradingBase, signal),
  });

  const tickersQuery = useQuery({
    queryKey: ["portal-redis-tickers", tradingBase],
    initialData: initialTickers,
    staleTime: 2_000,
    refetchInterval: selectedNews !== null ? false : 3_000,
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

  const marketOverview = marketOverviewQuery.data ?? null;
  const isOverviewLoading = marketOverviewQuery.isPending && !marketOverview;
  const exchangeRate = marketOverview?.usdKrwRate ?? null;
  const exchangeChart = marketOverview
    ? buildExchangeRateChartGeometry(marketOverview.usdKrwHistory)
    : null;
  const isTickersLoading = tickersQuery.isPending && tickersQuery.data === undefined;
  const popularCoins = mapRedisTickersToPopularCoins(tickersQuery.data);
  const hasAnyLivePopularCoin = popularCoins.some(coin => coin.available);
  const rawKrwDigits = krwInput.replace(/[^0-9]/g, "");
  const displayedYdInput =
    calcAnchor === "YD"
      ? ydInput
      : exchangeRate !== null && rawKrwDigits && Number.isFinite(Number(rawKrwDigits))
        ? (Number(rawKrwDigits) / exchangeRate).toFixed(2)
        : "";
  const displayedKrwInput =
    calcAnchor === "KRW"
      ? krwInput
      : exchangeRate !== null && ydInput && Number.isFinite(Number(ydInput))
        ? Math.round(Number(ydInput) * exchangeRate).toLocaleString("ko-KR")
        : "";
  const newsItems = newsQuery.data?.items ?? [];
  const postItems = postsQuery.data?.items ?? [];

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

  function formatPortalKstDate(value: string): string {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value.slice(0, 10);
    const kst = new Date(parsed + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(kst.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatPortalKstTime(value: string): string {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value.slice(11, 16) || "09:00";
    const kst = new Date(parsed + 9 * 60 * 60 * 1000);
    const h = String(kst.getUTCHours()).padStart(2, "0");
    const min = String(kst.getUTCMinutes()).padStart(2, "0");
    return `${h}:${min}`;
  }

  function formatPortalKstDateTime(value: string): string {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    const kst = new Date(parsed + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(kst.getUTCDate()).padStart(2, "0");
    const h = String(kst.getUTCHours()).padStart(2, "0");
    const min = String(kst.getUTCMinutes()).padStart(2, "0");
    return `${y}.${m}.${d} ${h}:${min} KST`;
  }

  function handleYdChange(value: string) {
    setCalcAnchor("YD");
    const stripped = value.replace(/[^0-9.]/g, "");
    const dotIdx = stripped.indexOf(".");
    const raw =
      dotIdx >= 0
        ? `${stripped.slice(0, dotIdx + 1)}${stripped.slice(dotIdx + 1).replace(/\./g, "")}`
        : stripped;
    setYdInput(raw);
    const num = Number(raw);
    if (!raw || Number.isNaN(num) || exchangeRate === null) {
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
    if (exchangeRate !== null) {
      setYdInput((num / exchangeRate).toFixed(2));
    }
  }

  function handleResetCalculator() {
    setCalcAnchor("YD");
    setYdInput("1");
    setKrwInput(exchangeRate !== null ? Math.round(exchangeRate).toLocaleString("ko-KR") : "");
  }

  return (
    <div className="portal-shell min-h-screen bg-[#F9FAFB] text-gray-900">
      {/* V1 공통 헤더 */}
      <V1Header theme="light" />

      {/* 상단 마켓 지표 티커 바 */}
      <section className="border-b border-gray-200 bg-white py-2.5 text-xs" aria-label="글로벌 마켓 요약 지표">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 md:px-6">
          {isOverviewLoading ? (
            <div className="flex flex-wrap items-center gap-3" aria-busy="true" aria-label="실시간 마켓 지표 불러오는 중">
              {[0, 1, 2, 3].map(idx => (
                <span key={idx} className="inline-block h-4 w-28 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          ) : marketOverview ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] sm:gap-4 sm:text-xs tabular-nums">
              <span className="whitespace-nowrap font-bold text-gray-500">
                BTC 도미넌스{" "}
                <strong className="text-gray-900">
                  {marketOverview.btcDominancePercent !== null
                    ? `${marketOverview.btcDominancePercent.toFixed(1)}%`
                    : "—"}
                </strong>{" "}
                {marketOverview.btcDominanceChange24h !== null ? (
                  <em
                    className={
                      marketOverview.btcDominanceChange24h >= 0
                        ? "not-italic font-bold text-[#0ECB81]"
                        : "not-italic font-bold text-[#F6465D]"
                    }
                  >
                    {marketOverview.btcDominanceChange24h >= 0 ? "+" : ""}
                    {marketOverview.btcDominanceChange24h.toFixed(2)}%
                  </em>
                ) : null}
              </span>
              <span className="whitespace-nowrap font-bold text-gray-500">
                김치프리미엄{" "}
                <strong className="text-gray-900">
                  {marketOverview.kimchiPremiumPercent !== null
                    ? `${marketOverview.kimchiPremiumPercent >= 0 ? "+" : ""}${marketOverview.kimchiPremiumPercent.toFixed(2)}%`
                    : "—"}
                </strong>
              </span>
              <span className="whitespace-nowrap font-bold text-gray-500">
                24h 선물 미결제약정{" "}
                <strong className="text-gray-900">
                  {marketOverview.openInterestBillionsUsd !== null
                    ? `$${marketOverview.openInterestBillionsUsd.toFixed(1)}B`
                    : "—"}
                </strong>
              </span>
              <span className="whitespace-nowrap font-bold text-gray-500">
                공포·탐욕 지수{" "}
                <strong className="text-[#0058FF]">
                  {marketOverview.fearGreedValue !== null
                    ? `${marketOverview.fearGreedValue}${marketOverview.fearGreedLabelKr ? ` (${marketOverview.fearGreedLabelKr})` : ""}`
                    : "—"}
                </strong>
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs font-bold text-gray-500">
              <span>실시간 시세 연동 대기 중 (—)</span>
              <button
                type="button"
                onClick={() => void marketOverviewQuery.refetch()}
                className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-bold text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                다시 조회
              </button>
            </div>
          )}
          <Link href="/trading" className="whitespace-nowrap font-bold text-[#0058FF] hover:underline">
            모의투자 하러가기 →
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
              대회 참여하기
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
                    <div className="mt-1 flex flex-wrap items-baseline gap-2 tabular-nums">
                      {isOverviewLoading ? (
                        <div className="h-8 w-52 animate-pulse rounded-lg bg-gray-100" />
                      ) : exchangeRate !== null ? (
                        <>
                          <strong className="whitespace-nowrap text-xl font-black text-gray-900 sm:text-3xl">
                            1 YD ={" "}
                            {exchangeRate.toLocaleString("ko-KR", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{" "}
                            KRW
                          </strong>
                          {marketOverview?.usdKrwChangeAmount !== null &&
                          marketOverview?.usdKrwChangeAmount !== undefined &&
                          marketOverview?.usdKrwChangePct !== null &&
                          marketOverview?.usdKrwChangePct !== undefined ? (
                            <span
                              className={
                                marketOverview.usdKrwChangeAmount >= 0
                                  ? "shrink-0 whitespace-nowrap rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-[#0ECB81]"
                                  : "shrink-0 whitespace-nowrap rounded-md bg-rose-50 px-2 py-0.5 text-xs font-bold text-[#F6465D]"
                              }
                            >
                              {marketOverview.usdKrwChangeAmount >= 0
                                ? `▲ +${marketOverview.usdKrwChangeAmount.toFixed(2)} (+${marketOverview.usdKrwChangePct.toFixed(2)}%)`
                                : `▼ ${marketOverview.usdKrwChangeAmount.toFixed(2)} (${marketOverview.usdKrwChangePct.toFixed(2)}%)`}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="whitespace-nowrap text-xl font-black text-gray-400 sm:text-2xl">
                            1 YD = — KRW
                          </strong>
                          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">
                            실시간 시세 연동 대기 중
                          </span>
                          <button
                            type="button"
                            onClick={() => void marketOverviewQuery.refetch()}
                            className="rounded-md border border-gray-200 bg-white px-2.5 py-0.5 text-xs font-bold text-[#0058FF] hover:bg-blue-50 cursor-pointer"
                          >
                            다시 조회
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
                    최근 14일 추이
                  </span>
                </div>

                {/* SVG 라인 차트 (실제 시계열이 있을 때만 렌더링, No gradient) */}
                <div className="h-[200px] w-full rounded-2xl border border-gray-100 bg-[#F9FAFB] p-4 flex flex-col justify-between">
                  {isOverviewLoading ? (
                    <div className="flex h-full flex-col justify-between animate-pulse">
                      <div className="h-32 w-full rounded-xl bg-gray-200/70" />
                      <div className="flex justify-between">
                        <span className="h-3 w-20 rounded bg-gray-200" />
                        <span className="h-3 w-20 rounded bg-gray-200" />
                        <span className="h-3 w-20 rounded bg-gray-200" />
                      </div>
                    </div>
                  ) : exchangeChart ? (
                    <>
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
                      <div className="flex justify-between gap-1 text-[10px] font-bold whitespace-nowrap text-gray-400 sm:text-[11px] tabular-nums">
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
                    </>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                      <p className="text-xs font-bold text-gray-500">
                        실시간 환율 시계열 연동 대기 중
                      </p>
                      <button
                        type="button"
                        onClick={() => void marketOverviewQuery.refetch()}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer"
                      >
                        다시 조회
                      </button>
                    </div>
                  )}
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
                    <div className="flex shrink-0 items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0058FF] text-xs font-black text-white">
                        YD
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-sm font-bold text-gray-700">요기 달러</span>
                    </div>
                    <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 pl-4">
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
                    <div className="flex shrink-0 items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-black text-gray-700">
                        ₩
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-sm font-bold text-gray-700">대한민국 원</span>
                    </div>
                    <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 pl-4">
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
              모의투자 하러가기 &rarr;
            </Link>
          </div>

          <div
            data-popular-coins-state={
              isTickersLoading ? "loading" : hasAnyLivePopularCoin ? "ready" : "unavailable"
            }
            className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6"
          >
            {popularCoins.map(coin => (
              <Link
                key={coin.symbol}
                href={`/trading?symbol=${coin.base}`}
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
                  {isTickersLoading ? (
                    <span className="h-6 w-16 animate-pulse rounded-lg bg-gray-100" />
                  ) : coin.available && coin.changeRate !== null ? (
                    <span
                      className={
                        coin.changeRate >= 0
                          ? "rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-black tabular-nums text-[#0ECB81]"
                          : "rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-black tabular-nums text-[#F6465D]"
                      }
                    >
                      {coin.changeRate >= 0 ? "+" : ""}
                      {coin.changeRate.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-400">
                      —
                    </span>
                  )}
                </div>

                <div className="my-5 space-y-2 tabular-nums">
                  {isTickersLoading ? (
                    <div className="space-y-2 animate-pulse" aria-busy="true">
                      <div className="h-7 w-32 rounded bg-gray-200" />
                      <div className="h-4 w-40 rounded bg-gray-100" />
                    </div>
                  ) : coin.available ? (
                    <>
                      <p className="text-xl font-black tracking-tight text-gray-900 sm:text-2xl">
                        {coin.price}
                      </p>
                      <p className="text-xs font-medium text-gray-500">
                        24h 거래대금 {coin.volume ?? "—"}
                      </p>
                      {(coin.high24h || coin.low24h) && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[#F9FAFB] px-3 py-2 text-[11px] font-semibold text-gray-500">
                          <span>
                            24h 고가 <strong className="text-gray-800">{coin.high24h ?? "—"}</strong>
                          </span>
                          <span>
                            저가 <strong className="text-gray-800">{coin.low24h ?? "—"}</strong>
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="rounded-xl bg-[#F9FAFB] px-3 py-3 text-xs font-bold text-gray-500">
                      <p className="text-lg font-black text-gray-400">—</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-gray-400">
                        실시간 시세 연동 대기 중
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-gray-100 pt-3 text-xs font-bold text-gray-500">
                  <span>최대 100x 격리마진 지원</span>
                  <span className="text-[#0058FF]">거래하기 →</span>
                </div>
              </Link>
            ))}
          </div>
          {!isTickersLoading && !hasAnyLivePopularCoin && (
            <div className="mt-3 flex items-center justify-end gap-2 text-xs font-bold text-gray-500">
              <span>실시간 시세 연동 대기 중</span>
              <button
                type="button"
                onClick={() => void tickersQuery.refetch()}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-[#0058FF] hover:bg-blue-50 cursor-pointer"
              >
                시세 다시 조회
              </button>
            </div>
          )}
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
                  실시간 Mark Price와 1~100배 격리마진(Isolated) 환경에서 롱/숏 양방향 주문을 연습하세요.
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

          {postsQuery.isPending ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy="true" aria-label="최신 커뮤니티 글 불러오는 중">
              {[0, 1, 2, 3].map(idx => (
                <div
                  key={idx}
                  className="h-44 animate-pulse rounded-2xl border border-gray-200 bg-white p-6"
                >
                  <div className="mb-3 flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-full bg-gray-200" />
                    <div className="space-y-1.5">
                      <div className="h-3 w-20 rounded bg-gray-200" />
                      <div className="h-2.5 w-16 rounded bg-gray-100" />
                    </div>
                  </div>
                  <div className="mb-2 h-4 w-3/4 rounded bg-gray-200" />
                  <div className="h-3 w-full rounded bg-gray-100" />
                </div>
              ))}
            </div>
          ) : postItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <p className="text-sm font-bold text-gray-700">
                아직 등록된 인기 커뮤니티 글이 없습니다.
              </p>
              <p className="text-xs text-gray-500">
                첫 번째 시황 분석이나 포지션 전략을 커뮤니티에 공유해보세요.
              </p>
              <Link
                href="/community"
                className="inline-flex h-9 items-center justify-center rounded-xl bg-[#0058FF] px-4 text-xs font-bold text-white hover:bg-blue-700"
              >
                커뮤니티로 이동 →
              </Link>
            </div>
          ) : (
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
                          src={post.authorProfileImgUrl}
                          withdrawn={post.authorWithdrawn}
                          size="sm"
                        />
                        <div>
                          <p className="text-xs font-bold text-gray-900">
                            {post.authorWithdrawn ? "탈퇴한회원" : post.authorNickname}
                          </p>
                          <p className="text-[11px] text-gray-400">{formatPortalKstDate(post.createdAt)}</p>
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
                      <span className="flex items-center gap-1 text-[#F6465D]">
                        <V1IconHeart className="h-3.5 w-3.5" />
                        <span>좋아요 {post.likeCount}</span>
                      </span>
                      <span className="flex items-center gap-1 text-gray-500">
                        <V1IconComment className="h-3.5 w-3.5" />
                        <span>댓글 {post.commentCount}</span>
                      </span>
                    </div>
                    <Link href={`/community/all/${post.id}`} className="text-[#0058FF] hover:underline">
                      피드 열기 →
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* 섹션 5: 24시 실시간 속보 & 선물 모의투자 퀵 시뮬레이터 */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* 좌측: 24시 실시간 속보 타임라인 */}
          <div className="card rounded-2xl border border-gray-200 bg-white p-6 lg:col-span-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#0058FF]"></span>
                <h2 className="text-lg font-black text-gray-900 whitespace-nowrap">24시 실시간 속보</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href="/community"
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-bold leading-none text-gray-700 hover:bg-gray-100"
                >
                  커뮤니티 시황 공유
                </Link>
                <Link href="/news" className="inline-flex items-center whitespace-nowrap text-xs font-bold text-[#0058FF] hover:underline">
                  전체 뉴스 →
                </Link>
              </div>
            </div>

            {newsQuery.isPending ? (
              <div className="space-y-3" aria-busy="true" aria-label="실시간 속보 불러오는 중">
                {[0, 1, 2, 3].map(idx => (
                  <div
                    key={idx}
                    className="h-24 animate-pulse rounded-xl border border-gray-100 bg-[#F9FAFB] p-4"
                  >
                    <div className="mb-2 h-3 w-28 rounded bg-gray-200" />
                    <div className="mb-1.5 h-4 w-3/4 rounded bg-gray-200" />
                    <div className="h-3 w-full rounded bg-gray-100" />
                  </div>
                ))}
              </div>
            ) : newsItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] px-5 py-10 text-center">
                <p className="text-sm font-bold text-gray-700">
                  현재 표시할 실시간 속보가 없습니다.
                </p>
                <Link href="/news" className="text-xs font-bold text-[#0058FF] hover:underline">
                  실시간 뉴스 데스크 확인하기 →
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {newsItems.slice(0, 4).map(article => (
                  <article
                    key={article.id}
                    className="flex flex-col gap-1.5 rounded-xl border border-gray-100 bg-[#F9FAFB] p-4"
                  >
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span className="font-bold text-[#0058FF]">
                        {formatPortalKstTime(article.publishedAt)} · {article.category}
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
                      <Link
                        href={`/trading?symbol=${article.symbolTag ?? "BTC"}`}
                        className="text-xs font-bold text-[#0058FF] hover:underline"
                      >
                        {article.symbolTag ?? "BTC"} 모의투자 하러가기 →
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* 우측: 선물 모의투자 퀵 시뮬레이터 */}
          <div className="card rounded-2xl border border-gray-200 bg-white p-6 lg:col-span-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 pb-4">
              <div className="min-w-0">
                <h2 className="text-lg font-black text-gray-900 break-keep">선물 모의투자 퀵 시뮬레이터</h2>
                <p className="text-xs text-gray-500">격리마진(Isolated) 예상 손익·ROE 계산</p>
              </div>
              <span className="inline-flex shrink-0 whitespace-nowrap items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold leading-none text-[#0058FF]">
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
                      ? "bg-[#0ECB81] text-white"
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
                      ? "bg-[#F6465D] text-white"
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
                <div className="grid grid-cols-6 gap-1.5">
                  {[1, 5, 10, 20, 50, 100].map(lev => (
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
                    value={simMarginInput}
                    onChange={e => {
                      const rawVal = e.target.value;
                      setSimMarginInput(rawVal);
                      const parsed = Number(rawVal);
                      if (Number.isFinite(parsed) && parsed > 0) {
                        setSimMargin(Math.min(10000, Math.max(10, parsed)));
                      }
                    }}
                    onBlur={() => {
                      const clamped = Math.min(10000, Math.max(10, Number(simMarginInput) || 10));
                      setSimMargin(clamped);
                      setSimMarginInput(String(clamped));
                    }}
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
                  <strong className={simResult.isPositive ? "text-[#0ECB81]" : "text-[#F6465D]"}>
                    {simResult.roe}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">예상 실현 손익</span>
                  <strong className={simResult.isPositive ? "text-[#0ECB81]" : "text-[#F6465D]"}>
                    {simResult.pnl}
                  </strong>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-2">
                  <span className="text-gray-400">예상 격리 강제청산 거리</span>
                  <strong className="text-amber-300">약 {simResult.approxLiqDistance} 역행 시</strong>
                </div>
              </div>

              <Link
                href={`/trading?symbol=BTC&side=${simSide}&leverage=${simLeverage}`}
                className="flex h-12 w-full items-center justify-center whitespace-nowrap rounded-xl bg-[#0058FF] text-sm font-bold text-white transition-colors hover:bg-blue-700"
              >
                {simSide} {simLeverage}x 모의투자 하러가기
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
        subtitle={
          selectedNews
            ? `${selectedNews.sourceName} · ${formatPortalKstDateTime(selectedNews.publishedAt)}`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-2">
            <Link
              href={`/trading?symbol=${selectedNews?.symbolTag ?? "BTC"}`}
              className="rounded-xl bg-[#0058FF] px-4 py-2.5 text-xs font-bold text-white"
              onClick={() => setSelectedNews(null)}
            >
              {selectedNews?.symbolTag ?? "BTC"} 모의투자 하러가기
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
    </div>
  );
}
