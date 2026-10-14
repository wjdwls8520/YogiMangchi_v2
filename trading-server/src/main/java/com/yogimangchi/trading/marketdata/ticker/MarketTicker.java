package com.yogimangchi.trading.marketdata.ticker;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;

/** Rolling 24h display statistics. Prices are per domain asset; volume remains quote-asset volume. */
public record MarketTicker(long tradingSymbolId, BigDecimal changePercent24h, BigDecimal highPrice24h,
                           BigDecimal lowPrice24h, BigDecimal quoteVolume24h,
                           Instant eventTime, Instant receivedAt) {
    public static final Duration FRESHNESS = Duration.ofSeconds(10);

    public MarketTicker {
        if (tradingSymbolId <= 0 || changePercent24h == null || highPrice24h == null || lowPrice24h == null
                || quoteVolume24h == null || eventTime == null || receivedAt == null
                || highPrice24h.signum() <= 0 || lowPrice24h.signum() <= 0
                || highPrice24h.compareTo(lowPrice24h) < 0 || quoteVolume24h.signum() < 0
                || changePercent24h.compareTo(BigDecimal.valueOf(-100)) < 0) {
            throw new IllegalArgumentException("Invalid market ticker");
        }
    }

    public boolean isFreshAt(Instant now) {
        return eventTime.isAfter(now.minus(FRESHNESS)) && receivedAt.isAfter(now.minus(FRESHNESS))
                && !eventTime.isAfter(now.plusSeconds(1)) && !receivedAt.isAfter(now.plusSeconds(1));
    }
}
