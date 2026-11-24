import { marketOverviewJson } from "../../trading/api/client";
import { resolveTradingOrigin } from "../../../lib/api-origins";

export interface MarketOverviewData {
  btcDominancePercent: number | null;
  btcDominanceChange24h: number | null;
  kimchiPremiumPercent: number | null;
  ethKimchiPremiumPercent?: number | null;
  xrpKimchiPremiumPercent?: number | null;
  openInterestBillionsUsd: number | null;
  fearGreedValue: number | null;
  fearGreedLabelKr: string | null;
  futuresBullPct: number | null;
  futuresBearPct: number | null;
  btcChange24h: number | null;
  usdKrwRate: number | null;
  usdKrwChangeAmount: number | null;
  usdKrwChangePct: number | null;
  usdKrwHistory: number[];
  updatedAt: string | null;
}

export interface ExchangeRateChartGeometry {
  polylinePoints: string;
  minRate: number;
  maxRate: number;
  twoWeeksAgoRate: number;
  oneWeekAgoRate: number;
  todayRate: number;
}

export function buildExchangeRateChartGeometry(
  history: readonly number[],
): ExchangeRateChartGeometry | null {
  const safeHistory = history.filter(v => Number.isFinite(v) && v > 0);
  if (safeHistory.length < 2) {
    return null;
  }
  const minRate = Math.min(...safeHistory);
  const maxRate = Math.max(...safeHistory);
  const span = maxRate - minRate;
  const pad = span < 1 ? 5 : span * 0.1;
  const low = minRate - pad;
  const high = maxRate + pad;
  const range = Math.max(high - low, 1);

  const polylinePoints = safeHistory
    .map((rate, idx) => {
      const x = (idx / (safeHistory.length - 1)) * 400 + 10;
      const y = 115 - ((rate - low) / range) * 95;
      return `${Number(x.toFixed(1))},${y.toFixed(1)}`;
    })
    .join(" ");

  return {
    polylinePoints,
    minRate,
    maxRate,
    twoWeeksAgoRate: safeHistory[0]!,
    oneWeekAgoRate: safeHistory[Math.floor(safeHistory.length / 2)]!,
    todayRate: safeHistory[safeHistory.length - 1]!,
  };
}

export function computeBtcDominanceChange24h(
  currentDominancePercent: number,
  totalMarketCapChange24hPct: number,
  btcPriceChange24hPct: number,
): number | null {
  if (
    !Number.isFinite(currentDominancePercent) ||
    !Number.isFinite(totalMarketCapChange24hPct) ||
    !Number.isFinite(btcPriceChange24hPct)
  ) {
    return null;
  }
  const denom = 1 + btcPriceChange24hPct / 100;
  if (denom <= 0) {
    return null;
  }
  const prevDominance =
    currentDominancePercent * ((1 + totalMarketCapChange24hPct / 100) / denom);
  const delta = currentDominancePercent - prevDominance;
  if (!Number.isFinite(delta)) {
    return null;
  }
  return Number(delta.toFixed(2));
}

export function computeKimchiPremiumPercent(
  upbitBtcKrw: number,
  binanceBtcUsd: number,
  usdKrwRate: number,
): number | null {
  if (
    !Number.isFinite(upbitBtcKrw) ||
    !Number.isFinite(binanceBtcUsd) ||
    !Number.isFinite(usdKrwRate) ||
    upbitBtcKrw <= 0 ||
    binanceBtcUsd <= 0 ||
    usdKrwRate <= 0
  ) {
    return null;
  }
  const globalKrwPrice = binanceBtcUsd * usdKrwRate;
  const pct = (upbitBtcKrw / globalKrwPrice - 1) * 100;
  if (!Number.isFinite(pct)) {
    return null;
  }
  return Number(pct.toFixed(2));
}

export function classifyFearGreedLabelKr(
  value: number,
  rawClassification?: string | null,
): string | null {
  const normalized = (rawClassification ?? "").trim().toLowerCase();
  if (normalized === "extreme fear") return "극단적 공포";
  if (normalized === "fear") return "공포";
  if (normalized === "neutral") return "중립";
  if (normalized === "greed") return "탐욕";
  if (normalized === "extreme greed") return "극단적 탐욕";

  if (!Number.isFinite(value)) return null;
  if (value <= 24) return "극단적 공포";
  if (value <= 44) return "공포";
  if (value <= 55) return "중립";
  if (value <= 74) return "탐욕";
  return "극단적 탐욕";
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export function parseMarketOverviewPayload(value: unknown): MarketOverviewData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const data = value as Record<string, unknown>;
  if (data.status === "UNAVAILABLE") {
    return null;
  }

  const rawDominance = finiteOrNull(data.btcDominancePercent);
  const rawDominanceChange = finiteOrNull(data.btcDominanceChange24h);
  const rawKimchi = finiteOrNull(data.kimchiPremiumPercent);
  const rawEthKimchi = finiteOrNull(data.ethKimchiPremiumPercent);
  const rawXrpKimchi = finiteOrNull(data.xrpKimchiPremiumPercent);
  const rawOi = finiteOrNull(data.openInterestBillionsUsd);
  const rawFng = finiteOrNull(data.fearGreedValue);
  const fearGreedValue =
    rawFng !== null ? Math.max(0, Math.min(100, Math.round(rawFng))) : null;
  const rawLabel =
    typeof data.fearGreedLabelKr === "string" && data.fearGreedLabelKr.trim().length > 0
      ? data.fearGreedLabelKr.trim()
      : fearGreedValue !== null
        ? classifyFearGreedLabelKr(fearGreedValue)
        : null;

  const rawBull = finiteOrNull(data.futuresBullPct);
  const futuresBullPct =
    rawBull !== null ? Math.max(5, Math.min(95, Math.round(rawBull))) : null;
  const futuresBearPct = futuresBullPct !== null ? 100 - futuresBullPct : null;

  const rawBtcChange = finiteOrNull(data.btcChange24h);
  const rawUsdKrw = finiteOrNull(data.usdKrwRate);
  const parsedUsdKrwRate =
    rawUsdKrw !== null && rawUsdKrw >= 500 ? Number(rawUsdKrw.toFixed(2)) : null;
  const rawUsdKrwChange = finiteOrNull(data.usdKrwChangeAmount);
  const rawUsdKrwChangePct = finiteOrNull(data.usdKrwChangePct);

  const rawHistory = Array.isArray(data.usdKrwHistory)
    ? data.usdKrwHistory
        .map(item => Number(item))
        .filter(num => Number.isFinite(num) && num > 0)
    : [];
  const usdKrwHistory =
    rawHistory.length >= 2
      ? parsedUsdKrwRate !== null && rawHistory.length >= 14
        ? [...rawHistory.slice(0, 13), parsedUsdKrwRate]
        : rawHistory
      : [];

  const hasAnyLiveMetric =
    rawDominance !== null ||
    rawKimchi !== null ||
    rawOi !== null ||
    fearGreedValue !== null ||
    futuresBullPct !== null ||
    parsedUsdKrwRate !== null;

  if (!hasAnyLiveMetric) {
    return null;
  }

  return {
    btcDominancePercent: rawDominance !== null ? Number(rawDominance.toFixed(1)) : null,
    btcDominanceChange24h:
      rawDominanceChange !== null ? Number(rawDominanceChange.toFixed(2)) : null,
    kimchiPremiumPercent: rawKimchi !== null ? Number(rawKimchi.toFixed(2)) : null,
    ethKimchiPremiumPercent: rawEthKimchi !== null ? Number(rawEthKimchi.toFixed(2)) : null,
    xrpKimchiPremiumPercent: rawXrpKimchi !== null ? Number(rawXrpKimchi.toFixed(2)) : null,
    openInterestBillionsUsd: rawOi !== null ? Number(rawOi.toFixed(1)) : null,
    fearGreedValue,
    fearGreedLabelKr: rawLabel,
    futuresBullPct,
    futuresBearPct,
    btcChange24h: rawBtcChange !== null ? Number(rawBtcChange.toFixed(2)) : null,
    usdKrwRate: parsedUsdKrwRate,
    usdKrwChangeAmount:
      rawUsdKrwChange !== null ? Number(rawUsdKrwChange.toFixed(2)) : null,
    usdKrwChangePct:
      rawUsdKrwChangePct !== null ? Number(rawUsdKrwChangePct.toFixed(2)) : null,
    usdKrwHistory,
    updatedAt:
      typeof data.updatedAt === "string" && data.updatedAt.trim().length > 0
        ? data.updatedAt
        : null,
  };
}

async function fetchJsonWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs = 4500,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function resolveTradingMarketBaseUrl(): string {
  return resolveTradingOrigin();
}

export async function fetchRedisMarketOverview(
  tradingBase: string = resolveTradingMarketBaseUrl(),
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<MarketOverviewData> {
  const payload = await marketOverviewJson(tradingBase, signal, transport);
  const parsed = parseMarketOverviewPayload(payload);
  if (!parsed) {
    throw new Error("Redis market overview snapshot is not ready yet");
  }
  return parsed;
}

export async function fetchLiveMarketOverview(
  fetchImpl: typeof fetch = fetch,
): Promise<MarketOverviewData | null> {
  const [
    binanceResult,
    binanceEthResult,
    binanceXrpResult,
    coingeckoGlobalResult,
    upbitResult,
    fxResult,
    derivativesResult,
    fngResult,
    takerRatioResult,
  ] = await Promise.allSettled([
    fetchJsonWithTimeout("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT", fetchImpl),
    fetchJsonWithTimeout("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT", fetchImpl),
    fetchJsonWithTimeout("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=XRPUSDT", fetchImpl),
    fetchJsonWithTimeout("https://api.coingecko.com/api/v3/global", fetchImpl),
    fetchJsonWithTimeout("https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,KRW-XRP", fetchImpl),
    fetchJsonWithTimeout("https://open.er-api.com/v6/latest/USD", fetchImpl),
    fetchJsonWithTimeout(
      "https://api.coingecko.com/api/v3/derivatives/exchanges?per_page=10",
      fetchImpl,
    ),
    fetchJsonWithTimeout("https://api.alternative.me/fng/?limit=1", fetchImpl),
    fetchJsonWithTimeout(
      "https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=1",
      fetchImpl,
    ),
  ]);

  let ethUsd = Number.NaN;
  if (binanceEthResult.status === "fulfilled" && binanceEthResult.value && typeof binanceEthResult.value === "object") {
    const obj = binanceEthResult.value as Record<string, unknown>;
    ethUsd = Number(obj.lastPrice ?? obj.price);
  }
  let xrpUsd = Number.NaN;
  if (binanceXrpResult.status === "fulfilled" && binanceXrpResult.value && typeof binanceXrpResult.value === "object") {
    const obj = binanceXrpResult.value as Record<string, unknown>;
    xrpUsd = Number(obj.lastPrice ?? obj.price);
  }

  let btcUsd = Number.NaN;
  let btcChange24hPct = Number.NaN;
  if (binanceResult.status === "fulfilled" && binanceResult.value && typeof binanceResult.value === "object") {
    const obj = binanceResult.value as Record<string, unknown>;
    btcUsd = Number(obj.lastPrice ?? obj.price);
    btcChange24hPct = Number(obj.priceChangePercent);
  }
  if (!Number.isFinite(btcUsd) || btcUsd <= 0) {
    try {
      const spot = (await fetchJsonWithTimeout(
        "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
        fetchImpl,
      )) as Record<string, unknown>;
      btcUsd = Number(spot?.lastPrice ?? spot?.price);
      if (!Number.isFinite(btcChange24hPct)) {
        btcChange24hPct = Number(spot?.priceChangePercent);
      }
    } catch {
      // Leave unavailable
    }
  }

  let btcDominancePercent: number | null = null;
  let btcDominanceChange24h: number | null = null;
  if (
    coingeckoGlobalResult.status === "fulfilled" &&
    coingeckoGlobalResult.value &&
    typeof coingeckoGlobalResult.value === "object"
  ) {
    const root = coingeckoGlobalResult.value as { data?: Record<string, unknown> };
    const data = root.data;
    const marketCapPct = data?.market_cap_percentage as Record<string, unknown> | undefined;
    const rawDom = Number(marketCapPct?.btc);
    const rawTotalChange = Number(data?.market_cap_change_percentage_24h_usd);
    if (Number.isFinite(rawDom) && rawDom > 0) {
      btcDominancePercent = Number(rawDom.toFixed(1));
      if (Number.isFinite(rawTotalChange) && Number.isFinite(btcChange24hPct)) {
        btcDominanceChange24h = computeBtcDominanceChange24h(
          rawDom,
          rawTotalChange,
          btcChange24hPct,
        );
      }
    }
  }
  if (btcDominancePercent === null) {
    try {
      const paprika = (await fetchJsonWithTimeout(
        "https://api.coinpaprika.com/v1/global",
        fetchImpl,
      )) as Record<string, unknown>;
      const rawDom = Number(paprika?.bitcoin_dominance_percentage);
      const rawTotalChange = Number(paprika?.market_cap_change_24h);
      if (Number.isFinite(rawDom) && rawDom > 0) {
        btcDominancePercent = Number(rawDom.toFixed(1));
        if (Number.isFinite(rawTotalChange) && Number.isFinite(btcChange24hPct)) {
          btcDominanceChange24h = computeBtcDominanceChange24h(
            rawDom,
            rawTotalChange,
            btcChange24hPct,
          );
        }
      }
    } catch {
      // Leave unavailable
    }
  }

  let upbitBtcKrw = Number.NaN;
  let upbitEthKrw = Number.NaN;
  let upbitXrpKrw = Number.NaN;
  if (upbitResult.status === "fulfilled" && Array.isArray(upbitResult.value)) {
    for (const rawRow of upbitResult.value) {
      if (!rawRow || typeof rawRow !== "object") continue;
      const row = rawRow as Record<string, unknown>;
      const market = typeof row.market === "string" ? row.market.toUpperCase() : "";
      const price = Number(row.trade_price);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (market === "KRW-BTC" || (!market && !Number.isFinite(upbitBtcKrw))) {
        upbitBtcKrw = price;
      } else if (market === "KRW-ETH") {
        upbitEthKrw = price;
      } else if (market === "KRW-XRP") {
        upbitXrpKrw = price;
      }
    }
  }

  let usdKrwRate = Number.NaN;
  let frankfurterLatestDate: string | null = null;
  if (fxResult.status === "fulfilled" && fxResult.value && typeof fxResult.value === "object") {
    const rates = (fxResult.value as { rates?: Record<string, unknown> }).rates;
    usdKrwRate = Number(rates?.KRW);
  }
  if (!Number.isFinite(usdKrwRate) || usdKrwRate <= 0) {
    try {
      const frankfurter = (await fetchJsonWithTimeout(
        "https://api.frankfurter.app/latest?from=USD&to=KRW",
        fetchImpl,
      )) as { date?: unknown; rates?: Record<string, unknown> };
      usdKrwRate = Number(frankfurter?.rates?.KRW);
      if (typeof frankfurter?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(frankfurter.date)) {
        frankfurterLatestDate = frankfurter.date;
      }
    } catch {
      // Leave unavailable
    }
  }

  const resolvedUsdKrwRate =
    Number.isFinite(usdKrwRate) && usdKrwRate >= 500
      ? Number(usdKrwRate.toFixed(2))
      : null;

  let usdKrwHistory: number[] = [];
  let usdKrwChangeAmount: number | null = null;
  let usdKrwChangePct: number | null = null;

  if (resolvedUsdKrwRate !== null) {
    try {
      const endDateStr = frankfurterLatestDate ?? new Date().toISOString().slice(0, 10);
      const endDateMs = Date.parse(`${endDateStr}T00:00:00Z`);
      const startDateStr = new Date(
        (Number.isFinite(endDateMs) ? endDateMs : Date.now()) - 22 * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      const seriesPayload = (await fetchJsonWithTimeout(
        `https://api.frankfurter.app/${startDateStr}..${endDateStr}?from=USD&to=KRW`,
        fetchImpl,
      )) as { rates?: Record<string, { KRW?: unknown }> };
      if (seriesPayload?.rates && typeof seriesPayload.rates === "object") {
        const sortedDates = Object.keys(seriesPayload.rates).sort();
        const seriesValues = sortedDates
          .map(d => Number(seriesPayload.rates?.[d]?.KRW))
          .filter(val => Number.isFinite(val) && val > 0)
          .map(val => Number(val.toFixed(1)));
        if (seriesValues.length >= 2) {
          const prior = seriesValues.slice(-13);
          usdKrwHistory = [...prior, resolvedUsdKrwRate];
          const prevRef =
            Math.abs(resolvedUsdKrwRate - prior[prior.length - 1]!) >= 0.01
              ? prior[prior.length - 1]!
              : prior[0]!;
          if (prevRef > 0) {
            usdKrwChangeAmount = Number((resolvedUsdKrwRate - prevRef).toFixed(2));
            usdKrwChangePct = Number((((resolvedUsdKrwRate - prevRef) / prevRef) * 100).toFixed(2));
          }
        }
      }
    } catch {
      // Leave history empty when live series unavailable
    }
  }

  const kimchiPremiumPercent =
    Number.isFinite(upbitBtcKrw) && Number.isFinite(btcUsd) && Number.isFinite(usdKrwRate)
      ? computeKimchiPremiumPercent(upbitBtcKrw, btcUsd, usdKrwRate)
      : null;
  const ethKimchiPremiumPercent =
    Number.isFinite(upbitEthKrw) && Number.isFinite(ethUsd) && Number.isFinite(usdKrwRate)
      ? computeKimchiPremiumPercent(upbitEthKrw, ethUsd, usdKrwRate)
      : null;
  const xrpKimchiPremiumPercent =
    Number.isFinite(upbitXrpKrw) && Number.isFinite(xrpUsd) && Number.isFinite(usdKrwRate)
      ? computeKimchiPremiumPercent(upbitXrpKrw, xrpUsd, usdKrwRate)
      : null;

  let openInterestBillionsUsd: number | null = null;
  if (derivativesResult.status === "fulfilled" && Array.isArray(derivativesResult.value)) {
    const list = derivativesResult.value as Array<Record<string, unknown>>;
    const binanceFutures =
      list.find(item => item.id === "binance_futures") ?? list[0];
    const oiBtc = Number(binanceFutures?.open_interest_btc);
    if (Number.isFinite(oiBtc) && oiBtc > 0 && Number.isFinite(btcUsd) && btcUsd > 0) {
      openInterestBillionsUsd = Number(((oiBtc * btcUsd) / 1e9).toFixed(1));
    }
  }
  if (openInterestBillionsUsd === null) {
    try {
      const oiHist = await fetchJsonWithTimeout(
        "https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=1",
        fetchImpl,
      );
      if (Array.isArray(oiHist) && oiHist[0] && typeof oiHist[0] === "object") {
        const valUsd = Number((oiHist[0] as Record<string, unknown>).sumOpenInterestValue);
        if (Number.isFinite(valUsd) && valUsd > 0) {
          openInterestBillionsUsd = Number((valUsd / 1e9).toFixed(1));
        }
      }
    } catch {
      // Leave unavailable
    }
  }

  let fearGreedValue: number | null = null;
  let fearGreedLabelKr: string | null = null;
  if (fngResult.status === "fulfilled" && fngResult.value && typeof fngResult.value === "object") {
    const dataArr = (fngResult.value as { data?: unknown }).data;
    if (Array.isArray(dataArr) && dataArr[0] && typeof dataArr[0] === "object") {
      const entry = dataArr[0] as Record<string, unknown>;
      const parsedVal = Number(entry.value);
      if (Number.isFinite(parsedVal) && parsedVal >= 0 && parsedVal <= 100) {
        fearGreedValue = Math.round(parsedVal);
        fearGreedLabelKr = classifyFearGreedLabelKr(
          fearGreedValue,
          typeof entry.value_classification === "string" ? entry.value_classification : null,
        );
      }
    }
  }

  let futuresBullPct: number | null = null;
  if (
    takerRatioResult.status === "fulfilled" &&
    Array.isArray(takerRatioResult.value) &&
    takerRatioResult.value[0] &&
    typeof takerRatioResult.value[0] === "object"
  ) {
    const first = takerRatioResult.value[0] as Record<string, unknown>;
    const buyVol = Number(first.buyVol);
    const sellVol = Number(first.sellVol);
    const buySellRatio = Number(first.buySellRatio);
    if (Number.isFinite(buyVol) && Number.isFinite(sellVol) && buyVol + sellVol > 0) {
      futuresBullPct = Math.max(
        5,
        Math.min(95, Math.round((buyVol / (buyVol + sellVol)) * 100)),
      );
    } else if (Number.isFinite(buySellRatio) && buySellRatio > 0) {
      futuresBullPct = Math.max(
        5,
        Math.min(95, Math.round((buySellRatio / (1 + buySellRatio)) * 100)),
      );
    }
  }
  if (futuresBullPct === null) {
    try {
      const accountRatio = await fetchJsonWithTimeout(
        "https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1",
        fetchImpl,
      );
      if (Array.isArray(accountRatio) && accountRatio[0] && typeof accountRatio[0] === "object") {
        const first = accountRatio[0] as Record<string, unknown>;
        const longAccount = Number(first.longAccount);
        const longShortRatio = Number(first.longShortRatio);
        if (Number.isFinite(longAccount) && longAccount > 0 && longAccount <= 1) {
          futuresBullPct = Math.max(5, Math.min(95, Math.round(longAccount * 100)));
        } else if (Number.isFinite(longShortRatio) && longShortRatio > 0) {
          futuresBullPct = Math.max(
            5,
            Math.min(95, Math.round((longShortRatio / (1 + longShortRatio)) * 100)),
          );
        }
      }
    } catch {
      // Leave unavailable
    }
  }

  const btcChange24h = Number.isFinite(btcChange24hPct)
    ? Number(btcChange24hPct.toFixed(2))
    : null;

  const hasAnyLiveMetric =
    btcDominancePercent !== null ||
    kimchiPremiumPercent !== null ||
    openInterestBillionsUsd !== null ||
    fearGreedValue !== null ||
    futuresBullPct !== null ||
    resolvedUsdKrwRate !== null;

  if (!hasAnyLiveMetric) {
    return null;
  }

  return {
    btcDominancePercent,
    btcDominanceChange24h,
    kimchiPremiumPercent,
    ethKimchiPremiumPercent,
    xrpKimchiPremiumPercent,
    openInterestBillionsUsd,
    fearGreedValue,
    fearGreedLabelKr,
    futuresBullPct,
    futuresBearPct: futuresBullPct !== null ? 100 - futuresBullPct : null,
    btcChange24h,
    usdKrwRate: resolvedUsdKrwRate,
    usdKrwChangeAmount,
    usdKrwChangePct,
    usdKrwHistory,
    updatedAt: new Date().toISOString(),
  };
}
