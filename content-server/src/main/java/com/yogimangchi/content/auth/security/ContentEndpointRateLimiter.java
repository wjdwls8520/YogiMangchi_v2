package com.yogimangchi.content.auth.security;

import com.yogimangchi.content.error.RateLimitedException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Bounded in-memory sliding-window rate limiter (max 50,000 tracked keys with TTL eviction)
 * plus concurrent per-IP SSE connection cap (max 5 concurrent connections per IP).
 */
@Component
public class ContentEndpointRateLimiter {
    public static final int DEFAULT_MAX_TRACKED_KEYS = 50_000;
    public static final int DEFAULT_MAX_SSE_PER_IP = 12;

    private final boolean enabled;
    private final SlidingWindow csrfLimiter;
    private final SlidingWindow authLimiter;
    private final SlidingWindow newsInteractionLimiter;
    private final SlidingWindow communityWriteLimiter;
    private final SlidingWindow supportWriteLimiter;
    private final SlidingWindow profileWriteLimiter;
    private final SlidingWindow clientErrorLimiter;
    private final int maxSsePerIp;
    private final int maxTrackedKeys;
    private final ConcurrentHashMap<String, AtomicInteger> activeSseByIp = new ConcurrentHashMap<>();

    @Autowired
    public ContentEndpointRateLimiter(
            @Value("${content.rate-limit.enabled:true}") boolean enabled,
            @Value("${content.rate-limit.csrf-per-minute:60}") int csrfPerMinute,
            @Value("${content.rate-limit.auth-per-minute:120}") int authPerMinute,
            @Value("${content.rate-limit.news-interaction-per-minute:120}") int newsPerMinute,
            @Value("${content.rate-limit.community-write-per-minute:60}") int communityWritePerMinute,
            @Value("${content.rate-limit.support-write-per-minute:30}") int supportWritePerMinute,
            @Value("${content.rate-limit.profile-write-per-minute:30}") int profileWritePerMinute,
            @Value("${content.rate-limit.client-errors-per-minute:20}") int clientErrorsPerMinute,
            @Value("${content.rate-limit.max-sse-per-ip:12}") int maxSsePerIp) {
        this(enabled, csrfPerMinute, authPerMinute, newsPerMinute, communityWritePerMinute,
                supportWritePerMinute, profileWritePerMinute, clientErrorsPerMinute, maxSsePerIp,
                Duration.ofMinutes(1), DEFAULT_MAX_TRACKED_KEYS, Clock.systemUTC());
    }

    public ContentEndpointRateLimiter(
            boolean enabled,
            int csrfPerMinute,
            int authPerMinute,
            int newsPerMinute,
            int communityWritePerMinute,
            int supportWritePerMinute,
            int profileWritePerMinute,
            int clientErrorsPerMinute,
            int maxSsePerIp,
            Duration window,
            int maxTrackedKeys,
            Clock clock) {
        this.enabled = enabled;
        Duration effectiveWindow = window != null && !window.isZero() && !window.isNegative()
                ? window
                : Duration.ofMinutes(1);
        Clock effectiveClock = clock != null ? clock : Clock.systemUTC();
        this.maxTrackedKeys = Math.max(1, maxTrackedKeys);
        this.maxSsePerIp = Math.max(1, maxSsePerIp);
        this.csrfLimiter = new SlidingWindow(Math.max(1, csrfPerMinute), effectiveWindow, this.maxTrackedKeys, effectiveClock);
        this.authLimiter = new SlidingWindow(Math.max(1, authPerMinute), effectiveWindow, this.maxTrackedKeys, effectiveClock);
        this.newsInteractionLimiter = new SlidingWindow(Math.max(1, newsPerMinute), effectiveWindow, this.maxTrackedKeys, effectiveClock);
        this.communityWriteLimiter = new SlidingWindow(Math.max(1, communityWritePerMinute), effectiveWindow, this.maxTrackedKeys, effectiveClock);
        this.supportWriteLimiter = new SlidingWindow(Math.max(1, supportWritePerMinute), effectiveWindow, this.maxTrackedKeys, effectiveClock);
        this.profileWriteLimiter = new SlidingWindow(Math.max(1, profileWritePerMinute), effectiveWindow, this.maxTrackedKeys, effectiveClock);
        this.clientErrorLimiter = new SlidingWindow(Math.max(1, clientErrorsPerMinute), effectiveWindow, this.maxTrackedKeys, effectiveClock);
    }

    public void checkCsrf(String remoteAddr) {
        if (!enabled) return;
        csrfLimiter.check("ip:" + normalizeIp(remoteAddr));
    }

    public void checkAuthWrite(String remoteAddr) {
        if (!enabled) return;
        authLimiter.check("ip:" + normalizeIp(remoteAddr));
    }

    public void checkNewsInteraction(String remoteAddr) {
        if (!enabled) return;
        newsInteractionLimiter.check("ip:" + normalizeIp(remoteAddr));
    }

    public void checkCommunityWrite(Long memberId, String remoteAddr) {
        if (!enabled) return;
        String key = (memberId != null && memberId > 0) ? ("m:" + memberId) : ("ip:" + normalizeIp(remoteAddr));
        communityWriteLimiter.check(key);
    }

    public void checkSupportWrite(Long memberId, String remoteAddr) {
        if (!enabled) return;
        String key = (memberId != null && memberId > 0) ? ("m:" + memberId) : ("ip:" + normalizeIp(remoteAddr));
        supportWriteLimiter.check(key);
    }

    public void checkProfileWrite(Long memberId, String remoteAddr) {
        if (!enabled) return;
        String key = (memberId != null && memberId > 0) ? ("m:" + memberId) : ("ip:" + normalizeIp(remoteAddr));
        profileWriteLimiter.check(key);
    }

    public void checkClientError(String remoteAddr) {
        if (!enabled) return;
        clientErrorLimiter.check("ip:" + normalizeIp(remoteAddr));
    }

    /**
     * Acquires one concurrent SSE slot for the given IP (max 5 concurrent connections per IP).
     * Caller MUST bind the returned Runnable to the SseEmitter's lifecycle or run it on error.
     */
    public Runnable acquireSseSlot(String remoteAddr) {
        if (!enabled) {
            return () -> { };
        }
        String key = normalizeIp(remoteAddr);
        if (!activeSseByIp.containsKey(key) && activeSseByIp.size() >= maxTrackedKeys) {
            activeSseByIp.entrySet().removeIf(e -> e.getValue().get() <= 0);
        }
        boolean[] granted = {false};
        activeSseByIp.compute(key, (k, counter) -> {
            AtomicInteger c = counter == null ? new AtomicInteger(0) : counter;
            if (c.get() >= maxSsePerIp) {
                return c;
            }
            c.incrementAndGet();
            granted[0] = true;
            return c;
        });
        if (!granted[0]) {
            throw new RateLimitedException(5L);
        }
        AtomicBoolean released = new AtomicBoolean(false);
        return () -> {
            if (released.compareAndSet(false, true)) {
                activeSseByIp.computeIfPresent(key, (k, c) -> c.decrementAndGet() <= 0 ? null : c);
            }
        };
    }

    public void bindSseRelease(SseEmitter emitter, Runnable release) {
        if (emitter == null || release == null) {
            return;
        }
        emitter.onCompletion(release);
        emitter.onTimeout(release);
        emitter.onError(e -> release.run());
    }

    public int activeSseConnectionsForIp(String remoteAddr) {
        AtomicInteger counter = activeSseByIp.get(normalizeIp(remoteAddr));
        return counter == null ? 0 : Math.max(0, counter.get());
    }

    public void reset() {
        csrfLimiter.reset();
        authLimiter.reset();
        newsInteractionLimiter.reset();
        communityWriteLimiter.reset();
        supportWriteLimiter.reset();
        profileWriteLimiter.reset();
        clientErrorLimiter.reset();
        activeSseByIp.clear();
    }

    private static String normalizeIp(String remoteAddr) {
        if (remoteAddr == null || remoteAddr.isBlank()) {
            return "unknown";
        }
        String cleaned = remoteAddr.strip();
        return cleaned.length() > 64 ? cleaned.substring(0, 64) : cleaned;
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
