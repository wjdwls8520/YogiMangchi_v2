package com.yogimangchi.trading.security;

import com.yogimangchi.trading.error.RateLimitedException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Bounded in-memory sliding-window rate limiter protecting public candle queries (per IP)
 * and authenticated order write endpoints (per account) against flood abuse.
 */
@Component
public class TradingEndpointRateLimiter {
    public static final int DEFAULT_MAX_TRACKED_KEYS = 20_000;
    public static final int DEFAULT_CANDLES_PER_MINUTE = 60;
    public static final int DEFAULT_ORDERS_PER_MINUTE = 120;

    private final boolean enabled;
    private final SlidingWindow candleLimiter;
    private final SlidingWindow orderLimiter;

    @Autowired
    public TradingEndpointRateLimiter(
            @Value("${trading.rate-limit.enabled:true}") boolean enabled,
            @Value("${trading.rate-limit.candles-per-minute:60}") int candlesPerMinute,
            @Value("${trading.rate-limit.orders-per-minute:120}") int ordersPerMinute) {
        this(enabled, candlesPerMinute, ordersPerMinute, Duration.ofMinutes(1), DEFAULT_MAX_TRACKED_KEYS, Clock.systemUTC());
    }

    public TradingEndpointRateLimiter(
            boolean enabled,
            int candlesPerMinute,
            int ordersPerMinute,
            Duration window,
            int maxTrackedKeys,
            Clock clock) {
        this.enabled = enabled;
        Duration effectiveWindow = window != null && !window.isZero() && !window.isNegative() ? window : Duration.ofMinutes(1);
        Clock effectiveClock = clock != null ? clock : Clock.systemUTC();
        int boundedKeys = Math.max(1, maxTrackedKeys);
        this.candleLimiter = new SlidingWindow(Math.max(1, candlesPerMinute), effectiveWindow, boundedKeys, effectiveClock);
        this.orderLimiter = new SlidingWindow(Math.max(1, ordersPerMinute), effectiveWindow, boundedKeys, effectiveClock);
    }

    public void checkCandleRequest(String remoteAddr) {
        if (!enabled) {
            return;
        }
        String key = (remoteAddr == null || remoteAddr.isBlank()) ? "unknown" : remoteAddr.strip();
        candleLimiter.check(key);
    }

    public void checkOrderWrite(Long accountId) {
        if (!enabled || accountId == null) {
            return;
        }
        orderLimiter.check("acct:" + accountId);
    }

    public void reset() {
        candleLimiter.reset();
        orderLimiter.reset();
    }

    private static final class SlidingWindow {
        private final int maxPerWindow;
        private final Duration window;
        private final int maxTrackedKeys;
        private final Clock clock;
        private final ConcurrentHashMap<String, Deque<Instant>> buckets = new ConcurrentHashMap<>();

        SlidingWindow(int maxPerWindow, Duration window, int maxTrackedKeys, Clock clock) {
            this.maxPerWindow = maxPerWindow;
            this.window = window;
            this.maxTrackedKeys = maxTrackedKeys;
            this.clock = clock;
        }

        void check(String key) {
            Instant now = clock.instant();
            Instant cutoff = now.minus(window);
            if (!buckets.containsKey(key) && buckets.size() >= maxTrackedKeys) {
                evict(cutoff);
            }
            long[] retryAfter = {0L};
            buckets.compute(key, (k, existing) -> {
                Deque<Instant> timestamps = existing == null ? new ArrayDeque<>(Math.min(maxPerWindow, 16)) : existing;
                while (!timestamps.isEmpty() && !timestamps.peekFirst().isAfter(cutoff)) {
                    timestamps.pollFirst();
                }
                if (timestamps.size() >= maxPerWindow) {
                    Instant oldest = timestamps.peekFirst();
                    Duration remaining = Duration.between(now, oldest.plus(window));
                    long seconds = remaining.getSeconds() + (remaining.getNano() > 0 ? 1L : 0L);
                    retryAfter[0] = Math.max(1L, seconds);
                    return timestamps;
                }
                timestamps.addLast(now);
                return timestamps;
            });
            if (retryAfter[0] > 0L) {
                throw new RateLimitedException(retryAfter[0]);
            }
        }

        void reset() {
            buckets.clear();
        }

        private void evict(Instant cutoff) {
            for (String existingKey : buckets.keySet()) {
                buckets.computeIfPresent(existingKey, (k, deque) -> {
                    while (!deque.isEmpty() && !deque.peekFirst().isAfter(cutoff)) {
                        deque.pollFirst();
                    }
                    return deque.isEmpty() ? null : deque;
                });
            }
            if (buckets.size() >= maxTrackedKeys) {
                int toDrop = Math.max(1, buckets.size() - maxTrackedKeys + 1);
                Iterator<Map.Entry<String, Deque<Instant>>> iterator = buckets.entrySet().iterator();
                while (iterator.hasNext() && toDrop > 0) {
                    iterator.next();
                    iterator.remove();
                    toDrop--;
                }
            }
        }
    }
}
