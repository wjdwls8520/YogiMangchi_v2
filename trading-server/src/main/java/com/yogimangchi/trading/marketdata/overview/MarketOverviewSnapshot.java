package com.yogimangchi.trading.marketdata.overview;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record MarketOverviewSnapshot(
        BigDecimal btcDominancePercent,
        BigDecimal btcDominanceChange24h,
        BigDecimal totalMarketCapChange24hPct,
        BigDecimal upbitBtcKrw,
        BigDecimal kimchiPremiumPercent,
        BigDecimal openInterestBtc,
        BigDecimal openInterestBillionsUsd,
        int fearGreedValue,
        String fearGreedLabelKr,
        int futuresBullPct,
        int futuresBearPct,
        BigDecimal btcChange24h,
        BigDecimal usdKrwRate,
        BigDecimal usdKrwChangeAmount,
        BigDecimal usdKrwChangePct,
        List<BigDecimal> usdKrwHistory,
        Instant updatedAt
) {

    public MarketOverviewSnapshot {
        usdKrwHistory = usdKrwHistory == null
                ? MarketOverviewMath.buildDeterministicUsdKrwHistory(usdKrwRate)
                : List.copyOf(usdKrwHistory);
    }

    public static MarketOverviewSnapshot fallback(Instant updatedAt) {
        return new MarketOverviewSnapshot(
                MarketOverviewMath.DEFAULT_BTC_DOMINANCE,
                MarketOverviewMath.DEFAULT_BTC_DOMINANCE_CHANGE_24H,
                null,
                null,
                MarketOverviewMath.DEFAULT_KIMCHI_PREMIUM,
                null,
                MarketOverviewMath.DEFAULT_OPEN_INTEREST_BILLIONS,
                MarketOverviewMath.DEFAULT_FEAR_GREED_VALUE,
                MarketOverviewMath.DEFAULT_FEAR_GREED_LABEL_KR,
                MarketOverviewMath.DEFAULT_FUTURES_BULL_PCT,
                100 - MarketOverviewMath.DEFAULT_FUTURES_BULL_PCT,
                MarketOverviewMath.DEFAULT_BTC_CHANGE_24H,
                MarketOverviewMath.DEFAULT_USD_KRW_RATE,
                MarketOverviewMath.DEFAULT_USD_KRW_CHANGE_AMOUNT,
                MarketOverviewMath.DEFAULT_USD_KRW_CHANGE_PCT,
                MarketOverviewMath.buildDeterministicUsdKrwHistory(MarketOverviewMath.DEFAULT_USD_KRW_RATE),
                updatedAt
        );
    }
}
