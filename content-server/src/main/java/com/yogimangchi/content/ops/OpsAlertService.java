package com.yogimangchi.content.ops;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.BiFunction;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Lightweight $0 operational webhook alerter with per-key cooldown, provider-aware payload
 * formatting (Discord, Slack, Telegram, Generic), and a bounded 10-slot dispatch history buffer.
 * Complete no-op when OPS_ALERT_WEBHOOK_URL is blank (zero outbound calls in local/test).
 */
@Service
public class OpsAlertService {
    private static final Logger log = LoggerFactory.getLogger(OpsAlertService.class);
    private static final int MAX_COOLDOWN_KEYS = 2048;
    public static final int MAX_DISPATCH_HISTORY = 10;

    public enum WebhookFormat { DISCORD, SLACK, TELEGRAM, GENERIC }

    public record DispatchResult(int httpStatus, boolean success, String errorSummary) { }

    public record DispatchAttempt(
            Instant timestamp,
            String key,
            String severity,
            String title,
            int httpStatus,
            boolean success,
            String errorSummary) { }

    public record AlertTelemetry(
            boolean configured,
            boolean enabled,
            String targetType,
            Instant lastSentAt,
            String lastStatus,
            List<DispatchAttempt> recentDispatches) { }

    public record TestAlertResponse(
            boolean enabled,
            boolean dispatched,
            boolean success,
            int httpStatus,
            String format,
            String status,
            String errorSummary,
            Instant occurredAt) { }

    private final URI webhookUri;
    private final WebhookFormat webhookFormat;
    private final String telegramChatId;
    private final Duration cooldown;
    private final Clock clock;
    private final ObjectMapper json;
    private final BiFunction<URI, String, CompletableFuture<DispatchResult>> sender;
    private final ConcurrentHashMap<String, Instant> lastSentByKey = new ConcurrentHashMap<>();
    private final Deque<DispatchAttempt> dispatchHistory = new ArrayDeque<>(MAX_DISPATCH_HISTORY);

    @Autowired
    public OpsAlertService(
            @Value("${content.ops.alert-webhook-url:${OPS_ALERT_WEBHOOK_URL:}}") String webhookUrl,
            @Value("${content.ops.alert-cooldown-seconds:${OPS_ALERT_COOLDOWN_SECONDS:300}}") long cooldownSeconds,
            @Value("${content.ops.alert-telegram-chat-id:${OPS_ALERT_TELEGRAM_CHAT_ID:}}") String telegramChatId,
            ObjectMapper json) {
        this(webhookUrl, Duration.ofSeconds(Math.max(1, cooldownSeconds)), Clock.systemUTC(), json,
                telegramChatId, defaultAsyncSender());
    }

    OpsAlertService(String webhookUrl, Duration cooldown, Clock clock, ObjectMapper json, BiConsumer<URI, String> sender) {
        this(webhookUrl, cooldown, clock, json, "", wrapLegacySender(sender));
    }

    OpsAlertService(
            String webhookUrl,
            Duration cooldown,
            Clock clock,
            ObjectMapper json,
            String telegramChatId,
            BiFunction<URI, String, CompletableFuture<DispatchResult>> sender) {
        this.webhookUri = parseUri(webhookUrl);
        this.webhookFormat = detectFormat(this.webhookUri);
        this.telegramChatId = telegramChatId == null ? "" : telegramChatId.strip();
        this.cooldown = cooldown;
        this.clock = clock;
        this.json = json;
        this.sender = sender;
    }

    public boolean isEnabled() {
        return webhookUri != null;
    }

    public WebhookFormat format() {
        return webhookFormat;
    }

    public boolean alert(String key, String severity, String title, Map<String, Object> details) {
        if (webhookUri == null || key == null || key.isBlank()) {
            return false;
        }
        Instant now = clock.instant();
        if (!acquireCooldownSlot(key, now)) {
            return false;
        }
        String sev = normalizeSeverity(severity);
        String safeTitle = sanitize(title, 200);
        try {
            String payload = buildPayload(key, sev, safeTitle, details == null ? Map.of() : details, now);
            CompletableFuture<DispatchResult> future = sender.apply(webhookUri, payload);
            if (future != null) {
                future.whenComplete((result, error) -> {
                    DispatchResult effective = resolveResult(result, error);
                    recordAttempt(new DispatchAttempt(
                            now, sanitize(key, 128), sev, safeTitle,
                            effective.httpStatus(), effective.success(), sanitize(effective.errorSummary(), 180)));
                });
            }
            return true;
        } catch (JsonProcessingException | RuntimeException ex) {
            String err = ex.getClass().getSimpleName();
            log.warn("[OpsAlert] failed to dispatch alert key={} cause={}", key, err);
            recordAttempt(new DispatchAttempt(now, sanitize(key, 128), sev, safeTitle, 0, false, err));
            return false;
        }
    }

    public TestAlertResponse sendTestAlert(Long adminMemberId) {
        Instant now = clock.instant();
        if (webhookUri == null) {
            return new TestAlertResponse(
                    false, false, false, 0, "NONE", "DISABLED",
                    "OPS_ALERT_WEBHOOK_URL is not configured", now);
        }
        String key = "ADMIN_TEST_ALERT";
        String severity = "INFO";
        String title = "Content Server operational test alert";
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("source", "admin-ops");
        details.put("triggeredBy", "member:" + (adminMemberId != null ? adminMemberId : 0L));
        details.put("format", webhookFormat.name());
        try {
            String payload = buildPayload(key, severity, title, details, now);
            CompletableFuture<DispatchResult> future = sender.apply(webhookUri, payload);
            DispatchResult effective;
            try {
                DispatchResult raw = future != null ? future.get(4, TimeUnit.SECONDS) : new DispatchResult(200, true, null);
                effective = resolveResult(raw, null);
            } catch (Exception ex) {
                if (ex instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                }
                effective = resolveResult(null, ex);
            }
            String errSummary = sanitize(effective.errorSummary(), 180);
            recordAttempt(new DispatchAttempt(
                    now, key, severity, title, effective.httpStatus(), effective.success(), errSummary));
            String statusText = effective.success()
                    ? "OK (" + effective.httpStatus() + ")"
                    : "FAILED" + (effective.httpStatus() > 0 ? " (HTTP " + effective.httpStatus() + ")" : "");
            return new TestAlertResponse(
                    true, true, effective.success(), effective.httpStatus(),
                    webhookFormat.name(), statusText, errSummary, now);
        } catch (JsonProcessingException | RuntimeException ex) {
            String err = ex.getClass().getSimpleName();
            recordAttempt(new DispatchAttempt(now, key, severity, title, 0, false, err));
            return new TestAlertResponse(true, false, false, 0, webhookFormat.name(), "FAILED", err, now);
        }
    }

    public synchronized AlertTelemetry telemetry() {
        List<DispatchAttempt> history = List.copyOf(new ArrayList<>(dispatchHistory));
        if (webhookUri == null) {
            return new AlertTelemetry(false, false, "NONE", null, "DISABLED", history);
        }
        if (history.isEmpty()) {
            return new AlertTelemetry(true, true, webhookFormat.name(), null, "IDLE", history);
        }
        DispatchAttempt latest = history.get(0);
        String status;
        if (latest.success()) {
            status = "OK (" + latest.httpStatus() + ")";
        } else if (latest.httpStatus() > 0) {
            status = "HTTP_" + latest.httpStatus()
                    + (latest.errorSummary() != null ? ": " + latest.errorSummary() : "");
        } else {
            status = "ERROR" + (latest.errorSummary() != null ? ": " + latest.errorSummary() : "");
        }
        return new AlertTelemetry(true, true, webhookFormat.name(), latest.timestamp(), status, history);
    }

    public synchronized List<DispatchAttempt> recentDispatches() {
        return List.copyOf(new ArrayList<>(dispatchHistory));
    }

    String buildPayload(String key, String severity, String title, Map<String, Object> details, Instant now)
            throws JsonProcessingException {
        String detailsText = formatDetailsLine(details);
        String summaryText = buildSummaryText(severity, title, detailsText, 1900);

        Map<String, Object> body = new LinkedHashMap<>();
        switch (webhookFormat) {
            case DISCORD -> {
                body.put("content", summaryText);
                Map<String, Object> embed = new LinkedHashMap<>();
                embed.put("title", "[" + severity + "] " + (title == null ? "Alert" : title));
                if (!detailsText.isEmpty()) {
                    embed.put("description", truncate(detailsText, 1800));
                }
                embed.put("color", discordColor(severity));
                embed.put("timestamp", now.toString());
                List<Map<String, Object>> fields = new ArrayList<>();
                fields.add(Map.of("name", "service", "value", "content-server", "inline", true));
                fields.add(Map.of("name", "key", "value", truncate(key, 256), "inline", true));
                if (details != null) {
                    int count = 0;
                    for (Map.Entry<String, Object> entry : details.entrySet()) {
                        if (count++ >= 8) break;
                        fields.add(Map.of(
                                "name", truncate(String.valueOf(entry.getKey()), 128),
                                "value", truncate(String.valueOf(entry.getValue()), 256),
                                "inline", true));
                    }
                }
                embed.put("fields", fields);
                body.put("embeds", List.of(embed));
            }
            case SLACK -> {
                body.put("text", summaryText);
                Map<String, Object> attachment = new LinkedHashMap<>();
                attachment.put("color", slackColor(severity));
                attachment.put("title", "[" + severity + "] " + (title == null ? "Alert" : title));
                if (!detailsText.isEmpty()) {
                    attachment.put("text", truncate(detailsText, 1800));
                }
                List<Map<String, Object>> fields = new ArrayList<>();
                fields.add(Map.of("title", "service", "value", "content-server", "short", true));
                fields.add(Map.of("title", "key", "value", truncate(key, 128), "short", true));
                if (details != null) {
                    int count = 0;
                    for (Map.Entry<String, Object> entry : details.entrySet()) {
                        if (count++ >= 8) break;
                        fields.add(Map.of(
                                "title", truncate(String.valueOf(entry.getKey()), 128),
                                "value", truncate(String.valueOf(entry.getValue()), 256),
                                "short", true));
                    }
                }
                attachment.put("fields", fields);
                attachment.put("ts", now.getEpochSecond());
                body.put("attachments", List.of(attachment));
            }
            case TELEGRAM -> {
                body.put("text", summaryText);
                if (!telegramChatId.isEmpty() && !hasQueryParam(webhookUri, "chat_id")) {
                    body.put("chat_id", telegramChatId);
                }
            }
            case GENERIC -> {
                body.put("content", summaryText);
                body.put("text", summaryText);
                body.put("service", "content-server");
                body.put("key", key);
                body.put("severity", severity);
                body.put("title", title);
                body.put("details", details == null ? Map.of() : details);
                body.put("occurredAt", now.toString());
            }
        }
        return json.writeValueAsString(body);
    }

    private synchronized void recordAttempt(DispatchAttempt attempt) {
        if (dispatchHistory.size() >= MAX_DISPATCH_HISTORY) {
            dispatchHistory.removeLast();
        }
        dispatchHistory.addFirst(attempt);
    }

    private boolean acquireCooldownSlot(String key, Instant now) {
        if (lastSentByKey.size() > MAX_COOLDOWN_KEYS) {
            Instant cutoff = now.minus(cooldown);
            lastSentByKey.entrySet().removeIf(entry -> entry.getValue().isBefore(cutoff));
        }
        boolean[] allowed = {false};
        lastSentByKey.compute(key, (k, previous) -> {
            if (previous == null || !now.isBefore(previous.plus(cooldown))) {
                allowed[0] = true;
                return now;
            }
            return previous;
        });
        return allowed[0];
    }

    private static WebhookFormat detectFormat(URI uri) {
        if (uri == null) {
            return WebhookFormat.GENERIC;
        }
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase(Locale.ROOT);
        if ((host.equals("discord.com") || host.endsWith(".discord.com")
                || host.equals("discordapp.com") || host.endsWith(".discordapp.com"))
                && path.contains("/api/webhooks")) {
            return WebhookFormat.DISCORD;
        }
        if (host.equals("hooks.slack.com") || (host.endsWith(".slack.com") && path.contains("/services/"))) {
            return WebhookFormat.SLACK;
        }
        if (host.equals("api.telegram.org")) {
            return WebhookFormat.TELEGRAM;
        }
        return WebhookFormat.GENERIC;
    }

    private static boolean hasQueryParam(URI uri, String param) {
        if (uri == null || uri.getRawQuery() == null) {
            return false;
        }
        for (String pair : uri.getRawQuery().split("&")) {
            int eq = pair.indexOf('=');
            String name = eq >= 0 ? pair.substring(0, eq) : pair;
            if (param.equals(name)) {
                return true;
            }
        }
        return false;
    }

    private static String buildSummaryText(String severity, String title, String detailsText, int maxLen) {
        String header = "[" + severity + "] [content-server] " + (title == null || title.isBlank() ? "Alert" : title);
        String combined = detailsText.isEmpty() ? header : (header + "\n" + detailsText);
        return truncate(combined, maxLen);
    }

    private static String formatDetailsLine(Map<String, Object> details) {
        if (details == null || details.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Object> entry : details.entrySet()) {
            if (sb.length() > 0) {
                sb.append(" | ");
            }
            sb.append(entry.getKey()).append('=').append(entry.getValue());
        }
        return sb.toString();
    }

    private static int discordColor(String severity) {
        return switch (severity) {
            case "CRITICAL", "ERROR" -> 0xE53935;
            case "WARN" -> 0xFB8C00;
            default -> 0x1E88E5;
        };
    }

    private static String slackColor(String severity) {
        return switch (severity) {
            case "CRITICAL", "ERROR" -> "danger";
            case "WARN" -> "warning";
            default -> "#1E88E5";
        };
    }

    private static String normalizeSeverity(String severity) {
        if (severity == null || severity.isBlank()) {
            return "WARN";
        }
        return severity.strip().toUpperCase(Locale.ROOT);
    }

    private static DispatchResult resolveResult(DispatchResult result, Throwable error) {
        if (error != null) {
            Throwable cause = error.getCause() != null ? error.getCause() : error;
            return new DispatchResult(0, false, cause.getClass().getSimpleName());
        }
        if (result == null) {
            return new DispatchResult(0, false, "NO_RESPONSE");
        }
        return result;
    }

    private static URI parseUri(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            URI parsed = URI.create(raw.strip());
            String scheme = parsed.getScheme();
            if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                return parsed;
            }
            log.warn("[OpsAlert] ignoring non-http webhook scheme");
            return null;
        } catch (IllegalArgumentException ex) {
            log.warn("[OpsAlert] ignoring invalid webhook URI");
            return null;
        }
    }

    private static BiFunction<URI, String, CompletableFuture<DispatchResult>> wrapLegacySender(BiConsumer<URI, String> legacy) {
        return (uri, payload) -> {
            try {
                legacy.accept(uri, payload);
                return CompletableFuture.completedFuture(new DispatchResult(200, true, null));
            } catch (RuntimeException ex) {
                return CompletableFuture.completedFuture(new DispatchResult(0, false, ex.getClass().getSimpleName()));
            }
        };
    }

    private static BiFunction<URI, String, CompletableFuture<DispatchResult>> defaultAsyncSender() {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .build();
        return (uri, payload) -> {
            HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(3))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();
            return client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                    .handle((response, error) -> {
                        if (error != null) {
                            Throwable cause = error.getCause() != null ? error.getCause() : error;
                            log.warn("[OpsAlert] webhook delivery failed cause={}", cause.getClass().getSimpleName());
                            return new DispatchResult(0, false, cause.getClass().getSimpleName());
                        }
                        int status = response.statusCode();
                        boolean ok = status >= 200 && status < 300;
                        if (!ok) {
                            String bodySnippet = sanitize(response.body(), 140);
                            log.warn("[OpsAlert] webhook returned status={} body={}", status, bodySnippet);
                            return new DispatchResult(status, false, bodySnippet != null ? bodySnippet : ("HTTP " + status));
                        }
                        return new DispatchResult(status, true, null);
                    });
        };
    }

    private static String sanitize(String value, int maxLen) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String cleaned = value.replaceAll("[\\p{Cntrl}]", " ").strip();
        return cleaned.length() > maxLen ? cleaned.substring(0, maxLen) : cleaned;
    }

    private static String truncate(String value, int maxLen) {
        if (value == null) {
            return "";
        }
        return value.length() > maxLen ? value.substring(0, maxLen) : value;
    }
}
