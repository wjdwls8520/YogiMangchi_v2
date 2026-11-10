export interface MarketOverviewData {
  btcDominancePercent: number;
  btcDominanceChange24h: number;
  kimchiPremiumPercent: number;
  openInterestBillionsUsd: number;
  fearGreedValue: number;
  fearGreedLabelKr: string;
  futuresBullPct: number;
  futuresBearPct: number;
  btcChange24h: number;
  usdKrwRate: number;
  usdKrwChangeAmount: number;
  usdKrwChangePct: number;
  usdKrwHistory: number[];
  updatedAt: string;
}

const DEFAULT_USD_KRW_OFFSETS = [
  -16.3, -14.0, -15.4, -12.1, -9.5, -10.7, -8.3, -5.6, -7.0, -4.4, -2.1, -3.5, -0.9, 0,
] as const;

export function buildDeterministicUsdKrwHistory(anchorRate: number): number[] {
  const safeRate = Number.isFinite(anchorRate) && anchorRate > 0 ? anchorRate : 1384.5;
  return DEFAULT_USD_KRW_OFFSETS.map((offset, idx) =>
    idx === DEFAULT_USD_KRW_OFFSETS.length - 1
      ? Number(safeRate.toFixed(2))
      : Number((safeRate + offset).toFixed(1)),
  );
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
): ExchangeRateChartGeometry {
  const valid = history.filter(v => Number.isFinite(v) && v > 0);
  const safeHistory = valid.length >= 2 ? valid : FALLBACK_MARKET_OVERVIEW.usdKrwHistory;
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
    twoWeeksAgoRate: safeHistory[0],
    oneWeekAgoRate: safeHistory[Math.floor(safeHistory.length / 2)],
    todayRate: safeHistory[safeHistory.length - 1],
  };
}

export const FALLBACK_MARKET_OVERVIEW: MarketOverviewData = {
  btcDominancePercent: 56.4,
  btcDominanceChange24h: 0.32,
  kimchiPremiumPercent: 0.85,
  openInterestBillionsUsd: 38.4,
  fearGreedValue: 68,
  fearGreedLabelKr: "탐욕",
  futuresBullPct: 54,
  futuresBearPct: 46,
  btcChange24h: 1.85,
  usdKrwRate: 1384.5,
  usdKrwChangeAmount: 5.8,
  usdKrwChangePct: 0.42,
  usdKrwHistory: [
    1368.2, 1370.5, 1369.1, 1372.4, 1375.0, 1373.8, 1376.2, 1378.9, 1377.5, 1380.1,
    1382.4, 1381.0, 1383.6, 1384.5,
  ],
  updatedAt: "2026-11-10T00:00:00Z",
};

export function computeBtcDominanceChange24h(
  currentDominancePercent: number,
  totalMarketCapChange24hPct: number,
  btcPriceChange24hPct: number,
): number {
  if (
    !Number.isFinite(currentDominancePercent) ||
    !Number.isFinite(totalMarketCapChange24hPct) ||
    !Number.isFinite(btcPriceChange24hPct)
  ) {
    return FALLBACK_MARKET_OVERVIEW.btcDominanceChange24h;
  }
  const denom = 1 + btcPriceChange24hPct / 100;
  if (denom <= 0) {
    return FALLBACK_MARKET_OVERVIEW.btcDominanceChange24h;
  }
  const prevDominance =
    currentDominancePercent * ((1 + totalMarketCapChange24hPct / 100) / denom);
  const delta = currentDominancePercent - prevDominance;
  if (!Number.isFinite(delta)) {
    return FALLBACK_MARKET_OVERVIEW.btcDominanceChange24h;
  }
  return Number(delta.toFixed(2));
}

export function computeKimchiPremiumPercent(
  upbitBtcKrw: number,
  binanceBtcUsd: number,
  usdKrwRate: number,
): number {
  if (
    !Number.isFinite(upbitBtcKrw) ||
    !Number.isFinite(binanceBtcUsd) ||
    !Number.isFinite(usdKrwRate) ||
    upbitBtcKrw <= 0 ||
    binanceBtcUsd <= 0 ||
    usdKrwRate <= 0
  ) {
    return FALLBACK_MARKET_OVERVIEW.kimchiPremiumPercent;
  }
  const globalKrwPrice = binanceBtcUsd * usdKrwRate;
  const pct = (upbitBtcKrw / globalKrwPrice - 1) * 100;
  if (!Number.isFinite(pct)) {
    return FALLBACK_MARKET_OVERVIEW.kimchiPremiumPercent;
  }
  return Number(pct.toFixed(2));
}

export function classifyFearGreedLabelKr(
  value: number,
  rawClassification?: string | null,
): string {
  const normalized = (rawClassification ?? "").trim().toLowerCase();
  if (normalized === "extreme fear") return "극단적 공포";
  if (normalized === "fear") return "공포";
  if (normalized === "neutral") return "중립";
  if (normalized === "greed") return "탐욕";
  if (normalized === "extreme greed") return "극단적 탐욕";

  if (!Number.isFinite(value)) return FALLBACK_MARKET_OVERVIEW.fearGreedLabelKr;
  if (value <= 24) return "극단적 공포";
  if (value <= 44) return "공포";
  if (value <= 55) return "중립";
  if (value <= 74) return "탐욕";
  return "극단적 탐욕";
}

function finiteOr(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function parseMarketOverviewPayload(value: unknown): MarketOverviewData {
  if (!value || typeof value !== "object") {
    return FALLBACK_MARKET_OVERVIEW;
  }
  const data = value as Record<string, unknown>;
  const fearGreedValue = Math.max(
    0,
    Math.min(100, Math.round(finiteOr(data.fearGreedValue, FALLBACK_MARKET_OVERVIEW.fearGreedValue))),
  );
  const rawLabel =
    typeof data.fearGreedLabelKr === "string" && data.fearGreedLabelKr.trim().length > 0
      ? data.fearGreedLabelKr.trim()
      : classifyFearGreedLabelKr(fearGreedValue);

  const rawFuturesBull = Math.max(
    5,
    Math.min(
      95,
      Math.round(finiteOr(data.futuresBullPct, FALLBACK_MARKET_OVERVIEW.futuresBullPct)),
    ),
  );

  const parsedUsdKrwRate = Number(
    Math.max(500, finiteOr(data.usdKrwRate, FALLBACK_MARKET_OVERVIEW.usdKrwRate)).toFixed(2),
  );
  const rawHistory = Array.isArray(data.usdKrwHistory)
    ? data.usdKrwHistory
        .map(item => Number(item))
        .filter(num => Number.isFinite(num) && num > 0)
    : [];
  const usdKrwHistory =
    rawHistory.length >= 4
      ? [...rawHistory.slice(0, 13), parsedUsdKrwRate]
      : buildDeterministicUsdKrwHistory(parsedUsdKrwRate);

  return {
    btcDominancePercent: Number(
      finiteOr(data.btcDominancePercent, FALLBACK_MARKET_OVERVIEW.btcDominancePercent).toFixed(1),
    ),
    btcDominanceChange24h: Number(
      finiteOr(data.btcDominanceChange24h, FALLBACK_MARKET_OVERVIEW.btcDominanceChange24h).toFixed(
        2,
      ),
    ),
    kimchiPremiumPercent: Number(
      finiteOr(data.kimchiPremiumPercent, FALLBACK_MARKET_OVERVIEW.kimchiPremiumPercent).toFixed(2),
    ),
    openInterestBillionsUsd: Number(
      finiteOr(
        data.openInterestBillionsUsd,
        FALLBACK_MARKET_OVERVIEW.openInterestBillionsUsd,
      ).toFixed(1),
    ),
    fearGreedValue,
    fearGreedLabelKr: rawLabel,
    futuresBullPct: rawFuturesBull,
    futuresBearPct: 100 - rawFuturesBull,
    btcChange24h: Number(
      finiteOr(data.btcChange24h, FALLBACK_MARKET_OVERVIEW.btcChange24h).toFixed(2),
    ),
    usdKrwRate: parsedUsdKrwRate,
    usdKrwChangeAmount: Number(
      finiteOr(data.usdKrwChangeAmount, FALLBACK_MARKET_OVERVIEW.usdKrwChangeAmount).toFixed(2),
    ),
    usdKrwChangePct: Number(
      finiteOr(data.usdKrwChangePct, FALLBACK_MARKET_OVERVIEW.usdKrwChangePct).toFixed(2),
    ),
    usdKrwHistory,
    updatedAt:
      typeof data.updatedAt === "string" && data.updatedAt.trim().length > 0
        ? data.updatedAt
        : FALLBACK_MARKET_OVERVIEW.updatedAt,
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

export async function fetchLiveMarketOverview(
  fetchImpl: typeof fetch = fetch,
): Promise<MarketOverviewData> {
  const [
    binanceResult,
    coingeckoGlobalResult,
    upbitResult,
    fxResult,
    derivativesResult,
    fngResult,
    takerRatioResult,
  ] = await Promise.allSettled([
    fetchJsonWithTimeout("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT", fetchImpl),
    fetchJsonWithTimeout("https://api.coingecko.com/api/v3/global", fetchImpl),
    fetchJsonWithTimeout("https://api.upbit.com/v1/ticker?markets=KRW-BTC", fetchImpl),
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

  // 1. Binance BTC Price & 24h Change (with Spot fallback)
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
      // Keep fallback if unreachable
    }
  }

  // 2. BTC Dominance & 24h Dominance Change (CoinGecko Global -> CoinPaprika fallback)
  let btcDominancePercent = FALLBACK_MARKET_OVERVIEW.btcDominancePercent;
  let btcDominanceChange24h = FALLBACK_MARKET_OVERVIEW.btcDominanceChange24h;
  let dominanceResolved = false;

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
      dominanceResolved = true;
      if (Number.isFinite(rawTotalChange) && Number.isFinite(btcChange24hPct)) {
        btcDominanceChange24h = computeBtcDominanceChange24h(
          rawDom,
          rawTotalChange,
          btcChange24hPct,
        );
      }
    }
  }

  if (!dominanceResolved) {
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
      // Keep fallback
    }
  }

  // 3. Kimchi Premium (Upbit KRW-BTC vs Binance BTCUSDT * USD/KRW)
  let upbitBtcKrw = Number.NaN;
  if (upbitResult.status === "fulfilled" && Array.isArray(upbitResult.value) && upbitResult.value[0]) {
    const first = upbitResult.value[0] as Record<string, unknown>;
    upbitBtcKrw = Number(first.trade_price);
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
      // Keep fallback
    }
  }

  const resolvedUsdKrwRate =
    Number.isFinite(usdKrwRate) && usdKrwRate > 0
      ? Number(usdKrwRate.toFixed(2))
      : FALLBACK_MARKET_OVERVIEW.usdKrwRate;

  // Fetch 14-day USD/KRW history from Frankfurter public API
  let usdKrwHistory = buildDeterministicUsdKrwHistory(resolvedUsdKrwRate);
  let usdKrwChangeAmount = FALLBACK_MARKET_OVERVIEW.usdKrwChangeAmount;
  let usdKrwChangePct = FALLBACK_MARKET_OVERVIEW.usdKrwChangePct;

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
      if (seriesValues.length >= 4) {
        const prior13 = seriesValues.slice(-13);
        while (prior13.length < 13) {
          prior13.unshift(prior13[0]);
        }
        usdKrwHistory = [...prior13, resolvedUsdKrwRate];
        const prevRef =
          Math.abs(resolvedUsdKrwRate - prior13[prior13.length - 1]) >= 0.01
            ? prior13[prior13.length - 1]
            : prior13[0];
        if (prevRef > 0) {
          usdKrwChangeAmount = Number((resolvedUsdKrwRate - prevRef).toFixed(2));
          usdKrwChangePct = Number((((resolvedUsdKrwRate - prevRef) / prevRef) * 100).toFixed(2));
        }
      }
    }
  } catch {
    // Keep deterministic 14-day history anchored to resolvedUsdKrwRate
  }

  const kimchiPremiumPercent =
    Number.isFinite(upbitBtcKrw) && Number.isFinite(btcUsd) && Number.isFinite(usdKrwRate)
      ? computeKimchiPremiumPercent(upbitBtcKrw, btcUsd, usdKrwRate)
      : FALLBACK_MARKET_OVERVIEW.kimchiPremiumPercent;

  // 4. 24h Futures Open Interest ($B)
  let openInterestBillionsUsd = FALLBACK_MARKET_OVERVIEW.openInterestBillionsUsd;
  let oiResolved = false;
  if (derivativesResult.status === "fulfilled" && Array.isArray(derivativesResult.value)) {
    const list = derivativesResult.value as Array<Record<string, unknown>>;
    const binanceFutures =
      list.find(item => item.id === "binance_futures") ?? list[0];
    const oiBtc = Number(binanceFutures?.open_interest_btc);
    const refBtcUsd = Number.isFinite(btcUsd) && btcUsd > 0 ? btcUsd : 90000;
    if (Number.isFinite(oiBtc) && oiBtc > 0) {
      openInterestBillionsUsd = Number(((oiBtc * refBtcUsd) / 1e9).toFixed(1));
      oiResolved = true;
    }
  }
  if (!oiResolved) {
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
      // Keep fallback
    }
  }

  // 5. Fear & Greed Index (Alternative.me)
  let fearGreedValue = FALLBACK_MARKET_OVERVIEW.fearGreedValue;
  let fearGreedLabelKr = FALLBACK_MARKET_OVERVIEW.fearGreedLabelKr;
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

  // 6. Binance Futures Taker Buy/Sell Ratio (fallback: Global Long/Short Account Ratio)
  let futuresBullPct = FALLBACK_MARKET_OVERVIEW.futuresBullPct;
  let ratioResolved = false;
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
      ratioResolved = true;
    } else if (Number.isFinite(buySellRatio) && buySellRatio > 0) {
      futuresBullPct = Math.max(
        5,
        Math.min(95, Math.round((buySellRatio / (1 + buySellRatio)) * 100)),
      );
      ratioResolved = true;
    }
  }
  if (!ratioResolved) {
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
      // Keep fallback
    }
  }

  const btcChange24h = Number.isFinite(btcChange24hPct)
    ? Number(btcChange24hPct.toFixed(2))
    : FALLBACK_MARKET_OVERVIEW.btcChange24h;

  return {
    btcDominancePercent,
    btcDominanceChange24h,
    kimchiPremiumPercent,
    openInterestBillionsUsd,
    fearGreedValue,
    fearGreedLabelKr,
    futuresBullPct,
    futuresBearPct: 100 - futuresBullPct,
    btcChange24h,
    usdKrwRate: resolvedUsdKrwRate,
    usdKrwChangeAmount,
    usdKrwChangePct,
    usdKrwHistory,
    updatedAt: new Date().toISOString(),
  };
}
