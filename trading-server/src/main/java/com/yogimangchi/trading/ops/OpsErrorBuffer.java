package com.yogimangchi.trading.ops;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Bounded in-memory diagnostics ring buffer separating critical 5xx/503 errors from 409 business rejections.
 * Normal 409 business rejections (e.g. INSUFFICIENT_MARGIN, LEVERAGE_MISMATCH) can NEVER evict real 5xx entries.
 */
@Component
public class OpsErrorBuffer {
    public static final int MAX_ENTRIES = 50;
    private static final int MAX_ROLLING_TIMESTAMPS = 10_000;
    private static final Duration WINDOW_5M = Duration.ofMinutes(5);
    private static final Duration WINDOW_1H = Duration.ofHours(1);
    private static final String APP_PACKAGE_PREFIX = "com.yogimangchi.";

    public record ErrorEntry(
            Instant occurredAt,
            int status,
            String code,
            String method,
            String uri,
            String requestId,
            String rootCause,
            String topAppFrame) {
        public ErrorEntry(
                Instant occurredAt,
                int status,
                String code,
                String method,
                String uri,
                String requestId,
                String rootCause) {
            this(occurredAt, status, code, method, uri, requestId, rootCause, null);
        }
    }

    public record ErrorMetrics(
            long last5m5xx,
            long last1h5xx,
            long total5xx,
            long total429,
            long total409) { }

    private final Clock clock;
    private final Deque<ErrorEntry> criticalEntries = new ArrayDeque<>(MAX_ENTRIES);
    private final Deque<ErrorEntry> businessRejectEntries = new ArrayDeque<>(MAX_ENTRIES);
    private final Deque<Instant> criticalTimestamps1h = new ArrayDeque<>(256);
    private final AtomicLong sequence = new AtomicLong();
    private long errorsSinceStart;
    private long rateLimitedSinceStart;
    private long businessRejects409SinceStart;

    @Autowired
    public OpsErrorBuffer() {
        this(Clock.systemUTC());
    }

    OpsErrorBuffer(Clock clock) {
        this.clock = clock != null ? clock : Clock.systemUTC();
    }

    public synchronized void record(int status, String code, String method, String uri, String requestId, String rootCause) {
        record(status, code, method, uri, requestId, rootCause, null);
    }

    public synchronized void record(
            int status,
            String code,
            String method,
            String uri,
            String requestId,
            String rootCause,
            String topAppFrame) {
        Instant now = clock.instant();
        if (status == 429) {
            rateLimitedSinceStart++;
            return;
        }
        if (status == 409) {
            businessRejects409SinceStart++;
            if (businessRejectEntries.size() >= MAX_ENTRIES) {
                businessRejectEntries.removeLast();
            }
            businessRejectEntries.addFirst(new ErrorEntry(
                    now,
                    status,
                    sanitize(code, 64),
                    sanitize(method, 16),
                    sanitizeUri(uri),
                    sanitize(requestId, 64),
                    sanitize(rootCause, 96),
                    sanitize(topAppFrame, 128)));
            sequence.incrementAndGet();
            return;
        }
        if (status >= 500) {
            errorsSinceStart++;
            pruneOldTimestamps(now);
            if (criticalTimestamps1h.size() >= MAX_ROLLING_TIMESTAMPS) {
                criticalTimestamps1h.pollFirst();
            }
            criticalTimestamps1h.addLast(now);
            if (criticalEntries.size() >= MAX_ENTRIES) {
                criticalEntries.removeLast();
            }
            criticalEntries.addFirst(new ErrorEntry(
                    now,
                    status,
                    sanitize(code, 64),
                    sanitize(method, 16),
                    sanitizeUri(uri),
                    sanitize(requestId, 64),
                    sanitize(rootCause, 96),
                    sanitize(topAppFrame, 128)));
            sequence.incrementAndGet();
        }
    }

    /** Dedicated 50-slot critical buffer (5xx including 503). Immune to 409/429 noise. */
    public synchronized List<ErrorEntry> recentCritical() {
        return List.copyOf(new ArrayList<>(criticalEntries));
    }

    /** Dedicated 50-slot 409 business rejection buffer. */
    public synchronized List<ErrorEntry> recentBusinessRejects() {
        return List.copyOf(new ArrayList<>(businessRejectEntries));
    }

    /**
     * Backward-compatible combined view capped at 50 entries, ALWAYS retaining all critical 5xx entries
     * and filling only remaining slots with newest 409 business rejections.
     */
    public synchronized List<ErrorEntry> recent() {
        int remaining = Math.max(0, MAX_ENTRIES - criticalEntries.size());
        List<ErrorEntry> merged = new ArrayList<>(Math.min(MAX_ENTRIES, criticalEntries.size() + businessRejectEntries.size()));
        merged.addAll(criticalEntries);
        if (remaining > 0 && !businessRejectEntries.isEmpty()) {
            int added = 0;
            for (ErrorEntry entry : businessRejectEntries) {
                if (added++ >= remaining) break;
                merged.add(entry);
            }
            merged.sort(Comparator.comparing(ErrorEntry::occurredAt).reversed());
        }
        return List.copyOf(merged);
    }

    public synchronized ErrorMetrics metrics() {
        Instant now = clock.instant();
        pruneOldTimestamps(now);
        Instant cutoff5m = now.minus(WINDOW_5M);
        long count5m = 0L;
        for (Instant ts : criticalTimestamps1h) {
            if (!ts.isBefore(cutoff5m)) {
                count5m++;
            }
        }
        return new ErrorMetrics(
                count5m,
                criticalTimestamps1h.size(),
                errorsSinceStart,
                rateLimitedSinceStart,
                businessRejects409SinceStart);
    }

    public synchronized void clear() {
        criticalEntries.clear();
        businessRejectEntries.clear();
        criticalTimestamps1h.clear();
        errorsSinceStart = 0L;
        rateLimitedSinceStart = 0L;
        businessRejects409SinceStart = 0L;
    }

    public static String extractTopAppFrame(Throwable throwable) {
        if (throwable == null) {
            return null;
        }
        Throwable cursor = throwable;
        int depth = 0;
        while (cursor != null && depth < 16) {
            StackTraceElement[] trace = cursor.getStackTrace();
            if (trace != null) {
                for (StackTraceElement frame : trace) {
                    String className = frame.getClassName();
                    if (className != null
                            && className.startsWith(APP_PACKAGE_PREFIX)
                            && !className.contains("$$")) {
                        int lastDot = className.lastIndexOf('.');
                        String simpleClass = lastDot >= 0 ? className.substring(lastDot + 1) : className;
                        String methodName = frame.getMethodName();
                        int line = frame.getLineNumber();
                        String formatted = line > 0
                                ? simpleClass + "." + methodName + ":" + line
                                : simpleClass + "." + methodName;
                        return sanitize(formatted, 128);
                    }
                }
            }
            if (cursor.getCause() == cursor) {
                break;
            }
            cursor = cursor.getCause();
            depth++;
        }
        return null;
    }

    private void pruneOldTimestamps(Instant now) {
        Instant cutoff1h = now.minus(WINDOW_1H);
        while (!criticalTimestamps1h.isEmpty() && criticalTimestamps1h.peekFirst().isBefore(cutoff1h)) {
            criticalTimestamps1h.pollFirst();
        }
    }

    private static String sanitize(String value, int maxLen) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String cleaned = value.replaceAll("[\\p{Cntrl}]", " ").strip();
        return cleaned.length() > maxLen ? cleaned.substring(0, maxLen) : cleaned;
    }

    public static String sanitizeUri(String uri) {
        if (uri == null || uri.isBlank()) {
            return null;
        }
        int queryIdx = uri.indexOf('?');
        String pathOnly = queryIdx >= 0 ? uri.substring(0, queryIdx) : uri;
        return sanitize(pathOnly, 160);
    }
}
