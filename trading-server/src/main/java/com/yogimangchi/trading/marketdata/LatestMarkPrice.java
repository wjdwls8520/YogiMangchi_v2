package com.yogimangchi.trading.marketdata;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;

/** Price in USDT per one domain asset unit, never per provider contract unit. */
public record LatestMarkPrice(Long tradingSymbolId, BigDecimal domainMarkPrice,
                              Instant eventTime, Instant receivedAt) {
    public LatestMarkPrice {
        if (tradingSymbolId == null || tradingSymbolId <= 0
                || domainMarkPrice == null || domainMarkPrice.signum() <= 0) {
            throw new IllegalArgumentException("A valid internal symbol ID and positive domain price are required");
        }
        Objects.requireNonNull(eventTime, "eventTime");
        Objects.requireNonNull(receivedAt, "receivedAt");
    }
}
