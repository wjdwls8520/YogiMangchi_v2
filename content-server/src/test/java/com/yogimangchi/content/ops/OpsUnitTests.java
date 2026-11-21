package com.yogimangchi.content.ops;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class OpsUnitTests {

    @Test
    void opsErrorBufferBoundsAt50EntriesStripsQueryStringsAndFiltersNonTrackedStatuses() {
        OpsErrorBuffer buffer = new OpsErrorBuffer();
        buffer.record(400, "INVALID_REQUEST", "GET", "/api/v1/test?secret=1", "req-400", "IllegalArgumentException");
        assertThat(buffer.recent()).isEmpty();

        for (int i = 0; i < 60; i++) {
            buffer.record(500, "INTERNAL_ERROR", "POST", "/api/v1/community/posts?token=abc" + i, "req-" + i, "RuntimeException");
        }
        buffer.record(409, "MEMBER_BUSY", "POST", "/api/v1/auth/refresh", "req-lock", "CannotAcquireLockException");
        buffer.record(503, "SERVICE_TEMPORARILY_UNAVAILABLE", "GET", "/api/v1/members/me", "req-db", "DataAccessResourceFailureException");

        List<OpsErrorBuffer.ErrorEntry> recent = buffer.recent();
        assertThat(recent).hasSize(OpsErrorBuffer.MAX_ENTRIES);
        assertThat(recent.get(0).status()).isEqualTo(503);
        assertThat(recent.get(1).status()).isEqualTo(409);
        assertThat(recent.get(2).uri()).isEqualTo("/api/v1/community/posts");
        assertThat(recent.get(2).uri()).doesNotContain("token=");
    }

    @Test
    void opsAlertServiceIsNoOpWhenBlankAndRespectsCooldownWhenConfigured() {
        ObjectMapper json = new ObjectMapper();
        List<String> sent = new ArrayList<>();

        OpsAlertService disabled = new OpsAlertService(
                "   ", Duration.ofMinutes(5), Clock.systemUTC(), json, (uri, payload) -> sent.add(payload));
        assertThat(disabled.isEnabled()).isFalse();
        assertThat(disabled.alert("db-down", "ERROR", "DB Down", Map.of("x", 1))).isFalse();
        assertThat(sent).isEmpty();

        Instant[] now = {Instant.parse("2026-11-21T10:00:00Z")};
        Clock mutableClock = new Clock() {
            @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(java.time.ZoneId zone) { return this; }
            @Override public Instant instant() { return now[0]; }
        };

        List<URI> sentUris = new ArrayList<>();
        OpsAlertService enabled = new OpsAlertService(
                "https://hooks.example.test/ops",
                Duration.ofMinutes(5),
                mutableClock,
                json,
                (uri, payload) -> {
                    sentUris.add(uri);
                    sent.add(payload);
                });
        assertThat(enabled.isEnabled()).isTrue();
        assertThat(enabled.alert("s3-fail", "ERROR", "S3 failure", Map.of("taskId", 1))).isTrue();
        assertThat(enabled.alert("s3-fail", "ERROR", "S3 failure repeat", Map.of("taskId", 2))).isFalse();
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)).contains("\"service\":\"content-server\"");

        now[0] = now[0].plusSeconds(301);
        assertThat(enabled.alert("s3-fail", "ERROR", "S3 failure after cooldown", Map.of("taskId", 3))).isTrue();
        assertThat(sent).hasSize(2);
        assertThat(sentUris).allMatch(u -> u.toString().equals("https://hooks.example.test/ops"));
    }
}
