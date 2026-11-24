package com.yogimangchi.trading.tradingaccount.security;

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
 * Bounded in-memory sliding-window IP rate limiter for POST /api/v1/trading/accounts/guest.
 * Uses request.getRemoteAddr() (resolved safely by Spring's ForwardedHeaderFilter behind trusted proxies).
 */
@Component
public class GuestCreationRateLimiter {
    public static final int DEFAULT_MAX_TRACKED_IPS = 10_000;

    private final boolean enabled;
    private final int maxPerWindow;
    private final Duration window;
    private final int maxTrackedIps;
    private final Clock clock;
    private final ConcurrentHashMap<String, Deque<Instant>> buckets = new ConcurrentHashMap<>();

    @Autowired
    public GuestCreationRateLimiter(
            @Value("${trading.guest-creation.rate-limit-enabled:true}") boolean enabled,
            @Value("${trading.guest-creation.max-per-window:10}") int maxPerWindow,
            @Value("${trading.guest-creation.window-seconds:600}") long windowSeconds) {
        this(enabled, maxPerWindow, Duration.ofSeconds(Math.max(1L, windowSeconds)), DEFAULT_MAX_TRACKED_IPS, Clock.systemUTC());
    }

    public GuestCreationRateLimiter(
            boolean enabled,
            int maxPerWindow,
            Duration window,
            int maxTrackedIps,
            Clock clock) {
        this.enabled = enabled;
        this.maxPerWindow = Math.max(1, maxPerWindow);
        this.window = window != null && !window.isZero() && !window.isNegative() ? window : Duration.ofSeconds(600);
        this.maxTrackedIps = Math.max(1, maxTrackedIps);
        this.clock = clock != null ? clock : Clock.systemUTC();
    }

    public void check(String remoteAddr) {
        if (!enabled) {
            return;
        }
        String key = (remoteAddr == null || remoteAddr.isBlank()) ? "unknown" : remoteAddr.strip();
        Instant now = clock.instant();
        Instant cutoff = now.minus(window);

        if (!buckets.containsKey(key) && buckets.size() >= maxTrackedIps) {
            evictIfNeeded(cutoff);
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

    int trackedIpCount() {
        return buckets.size();
    }

    public void reset() {
        buckets.clear();
    }

    private void evictIfNeeded(Instant cutoff) {
        for (String existingKey : buckets.keySet()) {
            buckets.computeIfPresent(existingKey, (k, deque) -> {
                while (!deque.isEmpty() && !deque.peekFirst().isAfter(cutoff)) {
                    deque.pollFirst();
                }
                return deque.isEmpty() ? null : deque;
            });
        }
        // Hard upper bound against distributed IP-flood memory exhaustion.
        if (buckets.size() >= maxTrackedIps) {
            int toDrop = Math.max(1, buckets.size() - maxTrackedIps + 1);
            Iterator<Map.Entry<String, Deque<Instant>>> iterator = buckets.entrySet().iterator();
            while (iterator.hasNext() && toDrop > 0) {
                iterator.next();
                iterator.remove();
                toDrop--;
            }
        }
    }
}
