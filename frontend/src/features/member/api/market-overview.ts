export interface MarketOverviewData {
  btcDominancePercent: number;
  btcDominanceChange24h: number;
  kimchiPremiumPercent: number;
  openInterestBillionsUsd: number;
  fearGreedValue: number;
  fearGreedLabelKr: string;
  updatedAt: string;
}

export const FALLBACK_MARKET_OVERVIEW: MarketOverviewData = {
  btcDominancePercent: 56.4,
  btcDominanceChange24h: 0.32,
  kimchiPremiumPercent: 0.85,
  openInterestBillionsUsd: 38.4,
  fearGreedValue: 68,
  fearGreedLabelKr: "탐욕",
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
  if (fxResult.status === "fulfilled" && fxResult.value && typeof fxResult.value === "object") {
    const rates = (fxResult.value as { rates?: Record<string, unknown> }).rates;
    usdKrwRate = Number(rates?.KRW);
  }
  if (!Number.isFinite(usdKrwRate) || usdKrwRate <= 0) {
    try {
      const frankfurter = (await fetchJsonWithTimeout(
        "https://api.frankfurter.app/latest?from=USD&to=KRW",
        fetchImpl,
      )) as { rates?: Record<string, unknown> };
      usdKrwRate = Number(frankfurter?.rates?.KRW);
    } catch {
      // Keep fallback
    }
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

  return {
    btcDominancePercent,
    btcDominanceChange24h,
    kimchiPremiumPercent,
    openInterestBillionsUsd,
    fearGreedValue,
    fearGreedLabelKr,
    updatedAt: new Date().toISOString(),
  };
}
