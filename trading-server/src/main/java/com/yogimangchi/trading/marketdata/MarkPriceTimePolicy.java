package com.yogimangchi.trading.marketdata;

import java.time.Duration;
import java.time.Instant;

/** Stateless checks shared by consumers; clock observations never override freshness or event ordering. */
public final class MarkPriceTimePolicy {
    public static final Duration FRESH_FOR = Duration.ofSeconds(5);
    public static final Duration WARNING_THRESHOLD = Duration.ofSeconds(1);
    public static final Duration DEGRADED_THRESHOLD = Duration.ofSeconds(5);
    public static final Duration REJECT_THRESHOLD = Duration.ofSeconds(10);
    // receivedAt is a server-generated timestamp, not the provider's clock.
    public static final Duration MAX_RECEIPT_FUTURE = Duration.ofSeconds(1);

    public enum ClockStatus { NORMAL, WARNING, DEGRADED, REJECTED, UNAVAILABLE }

    private MarkPriceTimePolicy() { }

    public static ClockStatus clockStatus(LatestMarkPrice price) {
        Duration magnitude = Duration.between(price.receivedAt(), price.eventTime()).abs();
        if (magnitude.compareTo(REJECT_THRESHOLD) > 0) return ClockStatus.REJECTED;
        if (magnitude.compareTo(DEGRADED_THRESHOLD) > 0) return ClockStatus.DEGRADED;
        if (magnitude.compareTo(WARNING_THRESHOLD) > 0) return ClockStatus.WARNING;
        return ClockStatus.NORMAL;
    }

    public static long skewMillis(LatestMarkPrice price) {
        Duration skew = Duration.between(price.receivedAt(), price.eventTime());
        try { return skew.toMillis(); }
        catch (ArithmeticException exception) { return skew.isNegative() ? Long.MIN_VALUE : Long.MAX_VALUE; }
    }

    public static boolean receivedRecently(LatestMarkPrice price, Instant now) {
        return price.receivedAt().isAfter(now.minus(FRESH_FOR))
                && !price.receivedAt().isAfter(now.plus(MAX_RECEIPT_FUTURE));
    }

    public static boolean isFreshAt(LatestMarkPrice price, Instant now) {
        return receivedRecently(price, now) && clockStatus(price) != ClockStatus.REJECTED;
    }
}
