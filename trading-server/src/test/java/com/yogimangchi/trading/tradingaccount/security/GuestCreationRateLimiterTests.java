package com.yogimangchi.trading.tradingaccount.security;

import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.error.RateLimitedException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GuestCreationRateLimiterTests {

    @Test
    void enforcesSlidingWindowPerIpAndRecoversAfterWindowElapses() {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-22T00:00:00Z"));
        Clock clock = new Clock() {
            @Override public ZoneId getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(ZoneId zone) { return this; }
            @Override public Instant instant() { return now.get(); }
        };

        GuestCreationRateLimiter limiter = new GuestCreationRateLimiter(true, 2, Duration.ofSeconds(60), 100, clock);

        assertThatCode(() -> limiter.check("10.0.0.1")).doesNotThrowAnyException();
        now.set(now.get().plusSeconds(10));
        assertThatCode(() -> limiter.check("10.0.0.1")).doesNotThrowAnyException();

        // 3rd request within window is rejected with Retry-After ~= 50s
        assertThatThrownBy(() -> limiter.check("10.0.0.1"))
                .isInstanceOfSatisfying(RateLimitedException.class, ex -> {
                    assertThat(ex.getCode()).isEqualTo(ErrorCode.RATE_LIMITED);
                    assertThat(ex.retryAfterSeconds()).isEqualTo(50L);
                });

        // Distinct IP is unaffected
        assertThatCode(() -> limiter.check("10.0.0.2")).doesNotThrowAnyException();

        // After first timestamp expires (t = 60s), one slot opens up
        now.set(Instant.parse("2026-11-22T00:01:00Z"));
        assertThatCode(() -> limiter.check("10.0.0.1")).doesNotThrowAnyException();
        assertThatThrownBy(() -> limiter.check("10.0.0.1"))
                .isInstanceOfSatisfying(RateLimitedException.class, ex ->
                        assertThat(ex.retryAfterSeconds()).isEqualTo(10L));
    }

    @Test
    void disabledLimiterAllowsUnlimitedRequestsAndBoundedMapEvictsUnderIpFlood() {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-22T00:00:00Z"));
        Clock clock = new Clock() {
            @Override public ZoneId getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(ZoneId zone) { return this; }
            @Override public Instant instant() { return now.get(); }
        };

        GuestCreationRateLimiter disabled = new GuestCreationRateLimiter(false, 1, Duration.ofSeconds(600), 10, clock);
        for (int i = 0; i < 20; i++) {
            assertThatCode(() -> disabled.check("127.0.0.1")).doesNotThrowAnyException();
        }

        GuestCreationRateLimiter bounded = new GuestCreationRateLimiter(true, 5, Duration.ofSeconds(600), 4, clock);
        for (int i = 0; i < 12; i++) {
            int idx = i;
            assertThatCode(() -> bounded.check("192.168.1." + idx)).doesNotThrowAnyException();
        }
        assertThat(bounded.trackedIpCount()).isLessThanOrEqualTo(4);
    }
}
