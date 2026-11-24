"use client";

import type { MarketOverviewData } from "../api/market-overview";

interface HeroMarketChartsProps {
  marketOverview: MarketOverviewData | null;
  isLoading: boolean;
  onRetry: () => void;
}

const FEAR_GREED_BANDS = [
  { key: "extreme-fear", min: 0, max: 24, startDeg: 180, endDeg: 138, color: "#F6465D" },
  { key: "fear", min: 25, max: 44, startDeg: 134, endDeg: 102, color: "#F97316" },
  { key: "neutral", min: 45, max: 55, startDeg: 98, endDeg: 82, color: "#9CA3AF" },
  { key: "greed", min: 56, max: 74, startDeg: 78, endDeg: 46, color: "var(--color-bull)" },
  { key: "extreme-greed", min: 75, max: 100, startDeg: 42, endDeg: 0, color: "#0058FF" },
] as const;

function polarPoint(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy - radius * Math.sin(rad),
  };
}

function describeTopArc(
  cx: number,
  cy: number,
  radius: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polarPoint(cx, cy, radius, startDeg);
  const end = polarPoint(cx, cy, radius, endDeg);
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${radius} ${radius} 0 0 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function getFearGreedAccent(value: number | null): string {
  if (value === null) return "#6B7280";
  const matched = FEAR_GREED_BANDS.find(band => value >= band.min && value <= band.max);
  return matched?.color ?? "#0058FF";
}

function getKimchiColor(value: number | null): string {
  if (value === null) return "#6B7280";
  if (value > 0) return "var(--color-bull)";
  if (value < 0) return "#F6465D";
  return "#6B7280";
}

function formatSignedPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function HeroMarketCharts({
  marketOverview,
  isLoading,
  onRetry,
}: HeroMarketChartsProps) {
  if (isLoading) {
    return (
      <div
        className="grid grid-cols-1 gap-3.5 sm:grid-cols-2"
        aria-busy="true"
        aria-label="실시간 마켓 지표 불러오는 중"
        data-hero-market-charts="loading"
      >
        {[0, 1, 2, 3].map(idx => (
          <div
            key={idx}
            className="flex h-[160px] flex-col justify-between rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="h-3.5 w-24 rounded ym-skeleton" />
              <span className="h-5 w-14 rounded-md ym-skeleton" />
            </div>
            <div className="h-16 w-full rounded-xl ym-skeleton" />
            <div className="flex items-center justify-between">
              <span className="h-3 w-16 rounded ym-skeleton" />
              <span className="h-3 w-12 rounded ym-skeleton" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!marketOverview) {
    return (
      <div
        className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-[#F9FAFB] p-6 text-center"
        data-hero-market-charts="unavailable"
      >
        <p className="text-sm font-bold text-gray-600">실시간 시세 연동 대기 중 (—)</p>
        <p className="text-xs text-gray-400">
          BTC 도미넌스 · 김치프리미엄(BTC·ETH·XRP) · 투자자 롱/숏 비율 · 공포·탐욕 지수를 불러오고 있습니다.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-bold text-[#0058FF] transition-colors hover:bg-blue-50 cursor-pointer"
        >
          다시 조회
        </button>
      </div>
    );
  }

  // 1. BTC 도미넌스 도넛 차트 계산 (전체 시총 대비 BTC 비중)
  const domPct =
    marketOverview.btcDominancePercent !== null
      ? Math.max(0, Math.min(100, marketOverview.btcDominancePercent))
      : null;
  const altPct = domPct !== null ? Math.max(0, Number((100 - domPct).toFixed(1))) : null;
  const domRadius = 31;
  const domCircumference = 2 * Math.PI * domRadius;
  const domDashOffset =
    domPct !== null ? domCircumference * (1 - domPct / 100) : domCircumference;

  // 2. 김치프리미엄 BTC · ETH · XRP 3종 비교 바 차트 (-5% ~ +5% 스케일)
  const kimchiRows = [
    { symbol: "BTC" as const, value: marketOverview.kimchiPremiumPercent },
    { symbol: "ETH" as const, value: marketOverview.ethKimchiPremiumPercent ?? null },
    { symbol: "XRP" as const, value: marketOverview.xrpKimchiPremiumPercent ?? null },
  ];

  // 3. 투자자 롱/숏 비율 (바이낸스 BTCUSDT 선물 기준)
  const longPct = marketOverview.futuresBullPct;
  const shortPct =
    marketOverview.futuresBearPct !== null
      ? marketOverview.futuresBearPct
      : longPct !== null
        ? 100 - longPct
        : null;
  const longShortStance =
    longPct === null || shortPct === null
      ? { label: "대기 중", color: "#6B7280", bg: "bg-gray-100" }
      : longPct >= 53
        ? { label: "매수 우위", color: "var(--color-bull)", bg: "bg-emerald-50" }
        : shortPct >= 53
          ? { label: "매도 우위", color: "#F6465D", bg: "bg-rose-50" }
          : { label: "균형", color: "#4B5563", bg: "bg-gray-100" };
  const ratioTrackWidth = 200;
  const ratioGap = 3;
  const longBarWidth =
    longPct !== null ? Math.max(8, ((ratioTrackWidth - ratioGap) * longPct) / 100) : 0;
  const shortBarWidth =
    shortPct !== null ? Math.max(8, ratioTrackWidth - ratioGap - longBarWidth) : 0;

  // 4. 공포·탐욕 지수 180도 반원 게이지 계산 (Alternative.me BTC 중심 시장 지수)
  const fngValue = marketOverview.fearGreedValue;
  const fngColor = getFearGreedAccent(fngValue);
  const fngClamped = fngValue !== null ? Math.max(0, Math.min(100, fngValue)) : 50;
  const fngAngle = 180 - (fngClamped / 100) * 180;
  const fngNeedleTip = polarPoint(90, 82, 46, fngAngle);
  const fngArcDot = polarPoint(90, 82, 62, fngAngle);

  return (
    <div
      className="grid grid-cols-1 gap-3.5 sm:grid-cols-2"
      aria-label="글로벌 마켓 요약 지표"
      data-hero-market-charts="ready"
    >
      {/* 차트 1: BTC 도미넌스 도넛 차트 */}
      <article
        data-hero-chart="btc-dominance"
        className="flex flex-col justify-between rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4 transition-colors hover:border-gray-300"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-gray-500">BTC 도미넌스</span>
          <span className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
            BTC 기준
          </span>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <svg
            viewBox="0 0 80 80"
            className="h-[74px] w-[74px] shrink-0"
            role="img"
            aria-label={
              domPct !== null ? `BTC 도미넌스 ${domPct.toFixed(1)}% 도넛 차트` : "BTC 도미넌스 차트"
            }
          >
            <circle cx="40" cy="40" r={domRadius} fill="none" stroke="#E5E7EB" strokeWidth="8" />
            {domPct !== null ? (
              <circle
                cx="40"
                cy="40"
                r={domRadius}
                fill="none"
                stroke="#0058FF"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={domCircumference.toFixed(2)}
                strokeDashoffset={domDashOffset.toFixed(2)}
                transform="rotate(-90 40 40)"
              />
            ) : null}
            <text
              x="40"
              y="37"
              textAnchor="middle"
              fill="#6B7280"
              fontSize="8.5"
              fontWeight="700"
            >
              BTC
            </text>
            <text
              x="40"
              y="49"
              textAnchor="middle"
              fill="#111827"
              fontSize="11.5"
              fontWeight="800"
            >
              {domPct !== null ? `${domPct.toFixed(1)}%` : "—"}
            </text>
          </svg>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-1.5 tabular-nums">
              <strong className="text-2xl font-black leading-none tracking-tight text-gray-900">
                {domPct !== null ? `${domPct.toFixed(1)}%` : "—"}
              </strong>
              {marketOverview.btcDominanceChange24h !== null ? (
                <em
                  className={
                    marketOverview.btcDominanceChange24h >= 0
                      ? "not-italic rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-bull"
                      : "not-italic rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-bold text-[#F6465D]"
                  }
                >
                  {marketOverview.btcDominanceChange24h >= 0 ? "+" : ""}
                  {marketOverview.btcDominanceChange24h.toFixed(2)}%
                </em>
              ) : null}
            </div>
            <div className="space-y-1 text-[11px] font-semibold text-gray-500 tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#0058FF]" />
                  BTC
                </span>
                <span className="font-bold text-gray-700">
                  {domPct !== null ? `${domPct.toFixed(1)}%` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-gray-300" />
                  알트코인
                </span>
                <span className="font-bold text-gray-600">
                  {altPct !== null ? `${altPct.toFixed(1)}%` : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </article>

      {/* 차트 2: 김치프리미엄 BTC · ETH · XRP 3종 비교 차트 */}
      <article
        data-hero-chart="kimchi-premium"
        className="flex flex-col justify-between rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4 transition-colors hover:border-gray-300"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-gray-500">김치프리미엄</span>
          <span className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
            BTC · ETH · XRP
          </span>
        </div>

        <div className="mt-2.5 space-y-2">
          {kimchiRows.map(row => {
            const color = getKimchiColor(row.value);
            const clamped = row.value !== null ? Math.max(-5, Math.min(5, row.value)) : 0;
            const center = 64;
            const halfW = 58;
            const offset = (clamped / 5) * halfW;
            return (
              <div
                key={row.symbol}
                data-kimchi-coin={row.symbol}
                className="flex items-center gap-2"
              >
                <span className="w-8 shrink-0 text-[11px] font-black text-gray-800">
                  {row.symbol}
                </span>
                <svg
                  viewBox="0 0 128 16"
                  className="h-4 min-w-0 flex-1"
                  role="img"
                  aria-label={`${row.symbol} 김치프리미엄 ${formatSignedPercent(row.value)}`}
                >
                  <rect x="6" y="5" width="116" height="6" rx="3" fill="#E5E7EB" />
                  {row.value !== null ? (
                    <>
                      <rect
                        x={(offset >= 0 ? center : center + offset).toFixed(1)}
                        y="5"
                        width={Math.max(3, Math.abs(offset)).toFixed(1)}
                        height="6"
                        rx="3"
                        fill={color}
                      />
                      <circle
                        cx={(center + offset).toFixed(1)}
                        cy="8"
                        r="3.5"
                        fill={color}
                        stroke="#FFFFFF"
                        strokeWidth="1.5"
                      />
                    </>
                  ) : null}
                  <line x1={center} y1="2" x2={center} y2="14" stroke="#9CA3AF" strokeWidth="1.2" />
                </svg>
                {row.symbol === "BTC" ? (
                  <strong
                    className="w-14 shrink-0 text-right text-xs font-black tabular-nums"
                    style={{ color }}
                  >
                    {formatSignedPercent(row.value)}
                  </strong>
                ) : (
                  <span
                    className="w-14 shrink-0 text-right text-xs font-extrabold tabular-nums"
                    style={{ color }}
                  >
                    {formatSignedPercent(row.value)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-1.5 flex items-center justify-between pl-10 pr-16 text-[9.5px] font-bold text-gray-400 tabular-nums">
          <span>-5%</span>
          <span className="text-gray-500">0% 기준</span>
          <span>+5%</span>
        </div>
      </article>

      {/* 차트 3: 투자자 롱/숏 비율 (BTC 선물 기준) */}
      <article
        data-hero-chart="long-short-ratio"
        className="flex flex-col justify-between rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4 transition-colors hover:border-gray-300"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-gray-500">투자자 롱/숏 비율</span>
          <span className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
            BTC 기준
          </span>
        </div>

        <div className="mt-2.5 flex items-end justify-between gap-2 tabular-nums">
          <div>
            <span className="block text-[10px] font-bold text-gray-400">롱 (매수)</span>
            <strong className="text-xl font-black leading-tight text-bull">
              {longPct !== null ? `${longPct}%` : "—"}
            </strong>
          </div>
          <span
            className={`mb-0.5 rounded-md px-2 py-0.5 text-[11px] font-bold ${longShortStance.bg}`}
            style={{ color: longShortStance.color }}
          >
            {longShortStance.label}
          </span>
          <div className="text-right">
            <span className="block text-[10px] font-bold text-gray-400">숏 (매도)</span>
            <strong className="text-xl font-black leading-tight text-[#F6465D]">
              {shortPct !== null ? `${shortPct}%` : "—"}
            </strong>
          </div>
        </div>

        <div className="mt-2">
          <svg
            viewBox="0 0 220 26"
            className="h-7 w-full"
            role="img"
            aria-label={
              longPct !== null && shortPct !== null
                ? `BTC 기준 투자자 롱 ${longPct}%, 숏 ${shortPct}% 비율 차트`
                : "BTC 기준 투자자 롱/숏 비율 차트"
            }
          >
            <rect x="10" y="5" width={ratioTrackWidth} height="10" rx="5" fill="#E5E7EB" />
            {longPct !== null && shortPct !== null ? (
              <>
                <rect
                  x="10"
                  y="5"
                  width={longBarWidth.toFixed(1)}
                  height="10"
                  rx="5"
                  fill="var(--color-bull)"
                />
                <rect
                  x={(10 + longBarWidth + ratioGap).toFixed(1)}
                  y="5"
                  width={shortBarWidth.toFixed(1)}
                  height="10"
                  rx="5"
                  fill="#F6465D"
                />
              </>
            ) : null}
            <line x1="110" y1="2" x2="110" y2="18" stroke="#FFFFFF" strokeWidth="2" />
            <line x1="110" y1="2" x2="110" y2="18" stroke="#6B7280" strokeWidth="1" strokeDasharray="2 2" />
            <text x="10" y="25" fill="#9CA3AF" fontSize="8.5" fontWeight="700">
              LONG
            </text>
            <text x="110" y="25" textAnchor="middle" fill="#6B7280" fontSize="8.5" fontWeight="700">
              BTCUSDT 선물 5m
            </text>
            <text x="210" y="25" textAnchor="end" fill="#9CA3AF" fontSize="8.5" fontWeight="700">
              SHORT
            </text>
          </svg>
        </div>
      </article>

      {/* 차트 4: 공포·탐욕 지수 180도 반원 게이지 차트 */}
      <article
        data-hero-chart="fear-greed"
        className="flex flex-col justify-between rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4 transition-colors hover:border-gray-300"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-bold text-gray-500 whitespace-nowrap">공포·탐욕 지수</span>
          </div>
          <strong
            className="text-xs font-black tabular-nums whitespace-nowrap"
            style={{ color: fngColor }}
          >
            {fngValue !== null
              ? `${fngValue}${marketOverview.fearGreedLabelKr ? ` (${marketOverview.fearGreedLabelKr})` : ""}`
              : "—"}
          </strong>
        </div>

        <div className="mt-1 flex items-center justify-center">
          <svg
            viewBox="0 0 180 98"
            className="h-[84px] w-[160px]"
            role="img"
            aria-label={
              fngValue !== null
                ? `BTC 중심 시장 공포·탐욕 지수 ${fngValue} 반원 게이지 차트`
                : "BTC 중심 시장 공포·탐욕 지수 게이지 차트"
            }
          >
            {FEAR_GREED_BANDS.map(band => {
              const isActive =
                fngValue !== null && fngValue >= band.min && fngValue <= band.max;
              return (
                <path
                  key={band.key}
                  d={describeTopArc(90, 82, 62, band.startDeg, band.endDeg)}
                  fill="none"
                  stroke={band.color}
                  strokeWidth="11"
                  strokeLinecap="round"
                  opacity={isActive ? "1" : "0.24"}
                />
              );
            })}
            {fngValue !== null ? (
              <>
                <line
                  x1="90"
                  y1="82"
                  x2={fngNeedleTip.x.toFixed(1)}
                  y2={fngNeedleTip.y.toFixed(1)}
                  stroke="#111827"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <circle cx="90" cy="82" r="4.5" fill="#111827" />
                <circle
                  cx={fngArcDot.x.toFixed(1)}
                  cy={fngArcDot.y.toFixed(1)}
                  r="5.5"
                  fill="#FFFFFF"
                  stroke={fngColor}
                  strokeWidth="3"
                />
              </>
            ) : null}
            <text x="16" y="95" fill="#9CA3AF" fontSize="9" fontWeight="700">
              0
            </text>
            <text x="90" y="66" textAnchor="middle" fill="#111827" fontSize="16" fontWeight="900">
              {fngValue !== null ? fngValue : "—"}
            </text>
            <text x="90" y="95" textAnchor="middle" fill="#6B7280" fontSize="8.5" fontWeight="700">
              BTC 중심 시장
            </text>
            <text x="164" y="95" textAnchor="end" fill="#9CA3AF" fontSize="9" fontWeight="700">
              100
            </text>
          </svg>
        </div>
      </article>
    </div>
  );
}
