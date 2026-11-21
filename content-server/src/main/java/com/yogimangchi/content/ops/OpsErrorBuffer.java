package com.yogimangchi.content.ops;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import org.springframework.stereotype.Component;

/** Bounded in-memory ring buffer storing sanitized 5xx/409/503 API error summaries for admin diagnostics. */
@Component
public class OpsErrorBuffer {
    public static final int MAX_ENTRIES = 50;

    public record ErrorEntry(
            Instant occurredAt,
            int status,
            String code,
            String method,
            String uri,
            String requestId,
            String rootCause) { }

    private final Deque<ErrorEntry> entries = new ArrayDeque<>(MAX_ENTRIES);

    public synchronized void record(int status, String code, String method, String uri, String requestId, String rootCause) {
        if (status < 500 && status != 409 && status != 503) {
            return;
        }
        if (entries.size() >= MAX_ENTRIES) {
            entries.removeLast();
        }
        entries.addFirst(new ErrorEntry(
                Instant.now(),
                status,
                sanitize(code, 64),
                sanitize(method, 16),
                sanitizeUri(uri),
                sanitize(requestId, 64),
                sanitize(rootCause, 96)));
    }

    public synchronized List<ErrorEntry> recent() {
        return List.copyOf(new ArrayList<>(entries));
    }

    public synchronized void clear() {
        entries.clear();
    }

    private static String sanitize(String value, int maxLen) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String cleaned = value.replaceAll("[\\p{Cntrl}]", " ").strip();
        return cleaned.length() > maxLen ? cleaned.substring(0, maxLen) : cleaned;
    }

    private static String sanitizeUri(String uri) {
        if (uri == null || uri.isBlank()) {
            return null;
        }
        int queryIdx = uri.indexOf('?');
        String pathOnly = queryIdx >= 0 ? uri.substring(0, queryIdx) : uri;
        return sanitize(pathOnly, 160);
    }
}
