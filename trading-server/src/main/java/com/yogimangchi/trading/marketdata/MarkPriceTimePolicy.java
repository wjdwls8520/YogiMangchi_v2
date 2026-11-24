package com.yogimangchi.trading.marketdata;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

/** Stateless checks shared by consumers; clock observations never override freshness or event ordering. */
public final class MarkPriceTimePolicy {
    public static final Duration FRESH_FOR = Duration.ofSeconds(5);
    public static final Duration WARNING_THRESHOLD = Duration.ofSeconds(1);
    public static final Duration DEGRADED_THRESHOLD = Duration.ofSeconds(5);
    public static final Duration REJECT_THRESHOLD = Duration.ofSeconds(10);
    // receivedAt is a server-generated timestamp, not the provider's clock.
    public static final Duration MAX_RECEIPT_FUTURE = Duration.ofSeconds(1);

    public static final Policy STRICT = new Policy(
            true, WARNING_THRESHOLD, DEGRADED_THRESHOLD, REJECT_THRESHOLD, MAX_RECEIPT_FUTURE);
    public static final Policy UNATTENDED = new Policy(
            false, Duration.ofHours(12), Duration.ofHours(48), Duration.ofDays(365), Duration.ofMinutes(5));

    public enum ClockStatus { NORMAL, WARNING, DEGRADED, REJECTED, UNAVAILABLE }

    public record Policy(
            boolean skewCheckEnabled,
            Duration warningThreshold,
            Duration degradedThreshold,
            Duration rejectThreshold,
            Duration maxReceiptFuture) {
        public Policy {
            Objects.requireNonNull(warningThreshold, "warningThreshold");
            Objects.requireNonNull(degradedThreshold, "degradedThreshold");
            Objects.requireNonNull(rejectThreshold, "rejectThreshold");
            Objects.requireNonNull(maxReceiptFuture, "maxReceiptFuture");
        }

        public ClockStatus clockStatus(LatestMarkPrice price) {
            if (!skewCheckEnabled) {
                return ClockStatus.NORMAL;
            }
            Duration magnitude = Duration.between(price.receivedAt(), price.eventTime()).abs();
            if (magnitude.compareTo(rejectThreshold) > 0) return ClockStatus.REJECTED;
            if (magnitude.compareTo(degradedThreshold) > 0) return ClockStatus.DEGRADED;
            if (magnitude.compareTo(warningThreshold) > 0) return ClockStatus.WARNING;
            return ClockStatus.NORMAL;
        }

        public boolean receivedRecently(LatestMarkPrice price, Instant now) {
            return price.receivedAt().isAfter(now.minus(FRESH_FOR))
                    && !price.receivedAt().isAfter(now.plus(maxReceiptFuture));
        }

        public boolean isFreshAt(LatestMarkPrice price, Instant now) {
            return receivedRecently(price, now) && clockStatus(price) != ClockStatus.REJECTED;
        }

        public long redisRejectThresholdMillis() {
            return skewCheckEnabled ? rejectThreshold.toMillis() : -1L;
        }
    }

    private MarkPriceTimePolicy() { }

    public static ClockStatus clockStatus(LatestMarkPrice price) {
        return STRICT.clockStatus(price);
    }

    public static long skewMillis(LatestMarkPrice price) {
        Duration skew = Duration.between(price.receivedAt(), price.eventTime());
        try { return skew.toMillis(); }
        catch (ArithmeticException exception) { return skew.isNegative() ? Long.MIN_VALUE : Long.MAX_VALUE; }
    }

    public static boolean receivedRecently(LatestMarkPrice price, Instant now) {
        return STRICT.receivedRecently(price, now);
    }

    public static boolean isFreshAt(LatestMarkPrice price, Instant now) {
        return STRICT.isFreshAt(price, now);
    }
}
