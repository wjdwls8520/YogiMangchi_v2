package com.yogimangchi.content.ops;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Bounded 30-slot in-memory ring buffer storing sanitized frontend runtime/error-boundary crashes.
 * Zero DB writes, zero cloud cost.
 */
@Component
public class ClientErrorBuffer {
    public static final int MAX_ENTRIES = 30;
    private static final Pattern BEARER_PATTERN = Pattern.compile("(?i)Bearer\\s+[A-Za-z0-9._~+/-]+=*");
    private static final Pattern EMAIL_PATTERN = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");

    public record ClientErrorEntry(
            Instant occurredAt,
            String route,
            String message,
            String stack,
            String digest,
            String userAgent,
            String requestId) { }

    private final Deque<ClientErrorEntry> entries = new ArrayDeque<>(MAX_ENTRIES);

    public synchronized ClientErrorEntry record(
            String route,
            String message,
            String stack,
            String digest,
            String userAgent,
            String requestId) {
        ClientErrorEntry entry = new ClientErrorEntry(
                Instant.now(),
                sanitize(route, 200),
                sanitize(message, 300),
                sanitizeMultiline(stack, 800),
                sanitize(digest, 128),
                sanitize(userAgent, 200),
                sanitize(requestId, 64));
        if (entries.size() >= MAX_ENTRIES) {
            entries.removeLast();
        }
        entries.addFirst(entry);
        return entry;
    }

    public synchronized List<ClientErrorEntry> recent() {
        return List.copyOf(new ArrayList<>(entries));
    }

    public synchronized void clear() {
        entries.clear();
    }

    private static String sanitize(String value, int maxLen) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String cleaned = scrubSecrets(value).replaceAll("[\\p{Cntrl}]", " ").strip();
        if (cleaned.isEmpty()) {
            return null;
        }
        return cleaned.length() > maxLen ? cleaned.substring(0, maxLen) : cleaned;
    }

    private static String sanitizeMultiline(String value, int maxLen) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String cleaned = scrubSecrets(value)
                .replace("\r\n", "\n")
                .replace('\r', '\n')
                .replaceAll("[\\p{Cntrl}&&[^\n]]", " ")
                .strip();
        if (cleaned.isEmpty()) {
            return null;
        }
        return cleaned.length() > maxLen ? cleaned.substring(0, maxLen) : cleaned;
    }

    private static String scrubSecrets(String input) {
        String scrubbed = BEARER_PATTERN.matcher(input).replaceAll("Bearer [REDACTED]");
        return EMAIL_PATTERN.matcher(scrubbed).replaceAll("[EMAIL_REDACTED]");
    }
}
