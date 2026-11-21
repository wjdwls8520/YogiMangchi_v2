package com.yogimangchi.trading.ops;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Lightweight $0 operational webhook alerter with per-key cooldown.
 * Complete no-op when OPS_ALERT_WEBHOOK_URL is blank (zero outbound calls in local/test).
 */
@Service
public class OpsAlertService {
    private static final Logger log = LoggerFactory.getLogger(OpsAlertService.class);
    private static final int MAX_COOLDOWN_KEYS = 2048;

    private final URI webhookUri;
    private final Duration cooldown;
    private final Clock clock;
    private final ObjectMapper json;
    private final BiConsumer<URI, String> sender;
    private final ConcurrentHashMap<String, Instant> lastSentByKey = new ConcurrentHashMap<>();

    @Autowired
    public OpsAlertService(
            @Value("${trading.ops.alert-webhook-url:${OPS_ALERT_WEBHOOK_URL:}}") String webhookUrl,
            @Value("${trading.ops.alert-cooldown-seconds:300}") long cooldownSeconds,
            ObjectMapper json) {
        this(webhookUrl, Duration.ofSeconds(Math.max(1, cooldownSeconds)), Clock.systemUTC(), json, defaultSender());
    }

    OpsAlertService(String webhookUrl, Duration cooldown, Clock clock, ObjectMapper json, BiConsumer<URI, String> sender) {
        this.webhookUri = parseUri(webhookUrl);
        this.cooldown = cooldown;
        this.clock = clock;
        this.json = json;
        this.sender = sender;
    }

    public boolean isEnabled() {
        return webhookUri != null;
    }

    public boolean alert(String key, String severity, String title, Map<String, Object> details) {
        if (webhookUri == null || key == null || key.isBlank()) {
            return false;
        }
        Instant now = clock.instant();
        if (!acquireCooldownSlot(key, now)) {
            return false;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("service", "trading-server");
        body.put("key", key);
        body.put("severity", severity == null ? "WARN" : severity);
        body.put("title", title);
        body.put("details", details == null ? Map.of() : details);
        body.put("occurredAt", now.toString());
        try {
            String payload = json.writeValueAsString(body);
            sender.accept(webhookUri, payload);
            return true;
        } catch (JsonProcessingException | RuntimeException ex) {
            log.warn("[OpsAlert] failed to dispatch alert key={} cause={}", key, ex.getClass().getSimpleName());
            return false;
        }
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

    private static BiConsumer<URI, String> defaultSender() {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .build();
        return (uri, payload) -> {
            HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(3))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();
            client.sendAsync(request, HttpResponse.BodyHandlers.discarding())
                    .whenComplete((response, error) -> {
                        if (error != null) {
                            log.warn("[OpsAlert] webhook delivery failed cause={}", error.getClass().getSimpleName());
                        } else if (response.statusCode() >= 400) {
                            log.warn("[OpsAlert] webhook returned status={}", response.statusCode());
                        }
                    });
        };
    }
}
