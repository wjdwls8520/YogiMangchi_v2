package com.yogimangchi.trading.marketdata.overview;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class MarketOverviewMath {

    public static final BigDecimal DEFAULT_BTC_DOMINANCE = new BigDecimal("56.4");
    public static final BigDecimal DEFAULT_BTC_DOMINANCE_CHANGE_24H = new BigDecimal("0.32");
    public static final BigDecimal DEFAULT_KIMCHI_PREMIUM = new BigDecimal("0.85");
    public static final BigDecimal DEFAULT_OPEN_INTEREST_BILLIONS = new BigDecimal("38.4");
    public static final int DEFAULT_FEAR_GREED_VALUE = 68;
    public static final String DEFAULT_FEAR_GREED_LABEL_KR = "탐욕";
    public static final int DEFAULT_FUTURES_BULL_PCT = 54;
    public static final BigDecimal DEFAULT_BTC_CHANGE_24H = new BigDecimal("1.85");
    public static final BigDecimal DEFAULT_USD_KRW_RATE = new BigDecimal("1384.50");
    public static final BigDecimal DEFAULT_USD_KRW_CHANGE_AMOUNT = new BigDecimal("5.80");
    public static final BigDecimal DEFAULT_USD_KRW_CHANGE_PCT = new BigDecimal("0.42");

    private static final BigDecimal HUNDRED = new BigDecimal("100");
    private static final BigDecimal BILLION = new BigDecimal("1000000000");
    private static final List<BigDecimal> DEFAULT_USD_KRW_OFFSETS = List.of(
            new BigDecimal("-16.3"), new BigDecimal("-14.0"), new BigDecimal("-15.4"),
            new BigDecimal("-12.1"), new BigDecimal("-9.5"), new BigDecimal("-10.7"),
            new BigDecimal("-8.3"), new BigDecimal("-5.6"), new BigDecimal("-7.0"),
            new BigDecimal("-4.4"), new BigDecimal("-2.1"), new BigDecimal("-3.5"),
            new BigDecimal("-0.9"), BigDecimal.ZERO
    );

    private MarketOverviewMath() {
    }

    public static BigDecimal computeBtcDominanceChange24h(
            BigDecimal currentDominancePercent,
            BigDecimal totalMarketCapChange24hPct,
            BigDecimal btcPriceChange24hPct
    ) {
        if (currentDominancePercent == null || totalMarketCapChange24hPct == null || btcPriceChange24hPct == null) {
            return DEFAULT_BTC_DOMINANCE_CHANGE_24H;
        }
        BigDecimal denom = BigDecimal.ONE.add(btcPriceChange24hPct.divide(HUNDRED, 10, RoundingMode.HALF_UP));
        if (denom.compareTo(BigDecimal.ZERO) <= 0) {
            return DEFAULT_BTC_DOMINANCE_CHANGE_24H;
        }
        BigDecimal numer = BigDecimal.ONE.add(totalMarketCapChange24hPct.divide(HUNDRED, 10, RoundingMode.HALF_UP));
        BigDecimal ratio = numer.divide(denom, 10, RoundingMode.HALF_UP);
        BigDecimal prevDominance = currentDominancePercent.multiply(ratio);
        return currentDominancePercent.subtract(prevDominance).setScale(2, RoundingMode.HALF_UP);
    }

    public static BigDecimal computeKimchiPremiumPercent(
            BigDecimal upbitBtcKrw,
            BigDecimal binanceBtcUsd,
            BigDecimal usdKrwRate
    ) {
        if (upbitBtcKrw == null || binanceBtcUsd == null || usdKrwRate == null
                || upbitBtcKrw.compareTo(BigDecimal.ZERO) <= 0
                || binanceBtcUsd.compareTo(BigDecimal.ZERO) <= 0
                || usdKrwRate.compareTo(BigDecimal.ZERO) <= 0) {
            return DEFAULT_KIMCHI_PREMIUM;
        }
        BigDecimal globalKrwPrice = binanceBtcUsd.multiply(usdKrwRate);
        if (globalKrwPrice.compareTo(BigDecimal.ZERO) <= 0) {
            return DEFAULT_KIMCHI_PREMIUM;
        }
        return upbitBtcKrw.divide(globalKrwPrice, 10, RoundingMode.HALF_UP)
                .subtract(BigDecimal.ONE)
                .multiply(HUNDRED)
                .setScale(2, RoundingMode.HALF_UP);
    }

    public static BigDecimal computeOpenInterestBillionsUsd(BigDecimal openInterestBtc, BigDecimal binanceBtcUsd) {
        if (openInterestBtc == null || binanceBtcUsd == null
                || openInterestBtc.compareTo(BigDecimal.ZERO) <= 0
                || binanceBtcUsd.compareTo(BigDecimal.ZERO) <= 0) {
            return DEFAULT_OPEN_INTEREST_BILLIONS;
        }
        return openInterestBtc.multiply(binanceBtcUsd)
                .divide(BILLION, 1, RoundingMode.HALF_UP);
    }

    public static String classifyFearGreedLabelKr(int value, String rawClassification) {
        if (rawClassification != null) {
            String normalized = rawClassification.strip().toLowerCase(Locale.ROOT);
            switch (normalized) {
                case "extreme fear" -> { return "극단적 공포"; }
                case "fear" -> { return "공포"; }
                case "neutral" -> { return "중립"; }
                case "greed" -> { return "탐욕"; }
                case "extreme greed" -> { return "극단적 탐욕"; }
                default -> { }
            }
        }
        if (value <= 24) return "극단적 공포";
        if (value <= 44) return "공포";
        if (value <= 55) return "중립";
        if (value <= 74) return "탐욕";
        return "극단적 탐욕";
    }

    public static int clampPercent(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    public static List<BigDecimal> buildDeterministicUsdKrwHistory(BigDecimal anchorRate) {
        BigDecimal safeAnchor = (anchorRate != null && anchorRate.compareTo(BigDecimal.ZERO) > 0)
                ? anchorRate.setScale(2, RoundingMode.HALF_UP)
                : DEFAULT_USD_KRW_RATE;
        List<BigDecimal> result = new ArrayList<>(DEFAULT_USD_KRW_OFFSETS.size());
        for (int i = 0; i < DEFAULT_USD_KRW_OFFSETS.size(); i++) {
            if (i == DEFAULT_USD_KRW_OFFSETS.size() - 1) {
                result.add(safeAnchor);
            } else {
                result.add(safeAnchor.add(DEFAULT_USD_KRW_OFFSETS.get(i)).setScale(1, RoundingMode.HALF_UP));
            }
        }
        return List.copyOf(result);
    }
}
