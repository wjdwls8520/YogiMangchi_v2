package com.yogimangchi.content.ops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.security.ContentEndpointRateLimiter;
import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.error.RateLimitedException;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OpsUnitTests {

    @Test
    void opsErrorBufferIsolates5xxCriticalSlotsFrom409NoiseTracksRollingMetricsAndExtractsAppFrames() {
        Instant[] now = {Instant.parse("2026-11-22T00:00:00Z")};
        Clock mutableClock = mutableClock(now);
        OpsErrorBuffer buffer = new OpsErrorBuffer(mutableClock);

        // Non-tracked 400 is ignored
        buffer.record(400, "INVALID_REQUEST", "GET", "/api/v1/test?secret=1", "req-400", "IllegalArgumentException");
        assertThat(buffer.recentCritical()).isEmpty();
        assertThat(buffer.recent()).isEmpty();

        // Record 1 critical 500 + 80 business 409s -> the 500 MUST NEVER be evicted!
        buffer.record(500, "INTERNAL_ERROR", "POST", "/api/v1/community/posts?token=abc", "req-500", "NullPointerException", "CommunityService.createPost:595");
        for (int i = 0; i < 80; i++) {
            buffer.record(409, "REPORT_ALREADY_RESOLVED", "PUT", "/api/v1/community/posts/1/reports", "req-409-" + i, "REPORT_ALREADY_RESOLVED");
        }
        buffer.record(429, "RATE_LIMITED", "POST", "/api/v1/ops/client-errors", "req-429", "RateLimitedException");
        buffer.record(503, "SERVICE_TEMPORARILY_UNAVAILABLE", "GET", "/api/v1/members/me", "req-503", "DataAccessResourceFailureException", "ActiveMemberFilter.doFilterInternal:62");

        List<OpsErrorBuffer.ErrorEntry> critical = buffer.recentCritical();
        assertThat(critical).hasSize(2);
        assertThat(critical.get(0).status()).isEqualTo(503);
        assertThat(critical.get(1).status()).isEqualTo(500);
        assertThat(critical.get(1).uri()).isEqualTo("/api/v1/community/posts");
        assertThat(critical.get(1).topAppFrame()).isEqualTo("CommunityService.createPost:595");

        assertThat(buffer.recentBusinessRejects()).hasSize(OpsErrorBuffer.MAX_ENTRIES);

        OpsErrorBuffer.ErrorMetrics metrics = buffer.metrics();
        assertThat(metrics.last5m5xx()).isEqualTo(2);
        assertThat(metrics.last1h5xx()).isEqualTo(2);
        assertThat(metrics.total5xx()).isEqualTo(2);
        assertThat(metrics.total429()).isEqualTo(1);
        assertThat(metrics.total409()).isEqualTo(80);

        // Advance clock by 6 minutes: last5m5xx drops to 0 while last1h5xx stays 2
        now[0] = now[0].plus(Duration.ofMinutes(6));
        OpsErrorBuffer.ErrorMetrics after6m = buffer.metrics();
        assertThat(after6m.last5m5xx()).isZero();
        assertThat(after6m.last1h5xx()).isEqualTo(2);
        assertThat(after6m.total5xx()).isEqualTo(2);

        // Extract com.yogimangchi.* app frames
        RuntimeException synthetic = new RuntimeException("boom");
        List<String> frames = OpsErrorBuffer.extractTopAppFrames(synthetic, 5);
        assertThat(frames).isNotEmpty();
        assertThat(frames.get(0)).startsWith("OpsUnitTests.");
    }

    @Test
    void opsAlertServiceAutoFormatsDiscordSlackTelegramGenericTracksRecentDispatchesAndRespectsCooldown() throws Exception {
        ObjectMapper json = new ObjectMapper();
        List<String> sent = new ArrayList<>();

        OpsAlertService disabled = new OpsAlertService(
                "   ", Duration.ofMinutes(5), Clock.systemUTC(), json, (uri, payload) -> sent.add(payload));
        assertThat(disabled.isEnabled()).isFalse();
        assertThat(disabled.alert("db-down", "ERROR", "DB Down", Map.of("x", 1))).isFalse();
        assertThat(disabled.sendTestAlert(1L).enabled()).isFalse();
        assertThat(disabled.telemetry().configured()).isFalse();
        assertThat(sent).isEmpty();

        Instant[] now = {Instant.parse("2026-11-22T01:00:00Z")};
        Clock mutableClock = mutableClock(now);

        // 1. Discord formatting
        List<String> discordPayloads = new ArrayList<>();
        OpsAlertService discord = new OpsAlertService(
                "https://discord.com/api/webhooks/12345/abcdef",
                Duration.ofMinutes(5),
                mutableClock,
                json,
                "",
                (uri, payload) -> {
                    discordPayloads.add(payload);
                    return CompletableFuture.completedFuture(new OpsAlertService.DispatchResult(204, true, null));
                });
        assertThat(discord.format()).isEqualTo(OpsAlertService.WebhookFormat.DISCORD);
        assertThat(discord.alert("content-500:/api/v1/test", "CRITICAL", "Content 500", Map.of("requestId", "req-1"))).isTrue();
        assertThat(discord.alert("content-500:/api/v1/test", "CRITICAL", "Duplicate within cooldown", Map.of())).isFalse();
        assertThat(discordPayloads).hasSize(1);
        JsonNode discordJson = json.readTree(discordPayloads.get(0));
        assertThat(discordJson.path("content").asText()).contains("[CRITICAL]").contains("[content-server]");
        assertThat(discordJson.path("embeds").isArray()).isTrue();
        assertThat(discordJson.path("embeds").get(0).path("fields").toString()).contains("content-server");

        // Test alert bypasses cooldown & appends to 10-slot dispatch history
        var testResp = discord.sendTestAlert(42L);
        assertThat(testResp.dispatched()).isTrue();
        assertThat(testResp.success()).isTrue();
        assertThat(testResp.httpStatus()).isEqualTo(204);
        assertThat(testResp.format()).isEqualTo("DISCORD");
        assertThat(discord.telemetry().recentDispatches()).hasSize(2);
        assertThat(discord.telemetry().targetType()).isEqualTo("DISCORD");

        // 2. Slack formatting (text + attachments)
        List<String> slackPayloads = new ArrayList<>();
        OpsAlertService slack = new OpsAlertService(
                "https://hooks.slack.com/services/T000/B000/XXXX",
                Duration.ofMinutes(5),
                mutableClock,
                json,
                "",
                (uri, payload) -> {
                    slackPayloads.add(payload);
                    return CompletableFuture.completedFuture(new OpsAlertService.DispatchResult(200, true, null));
                });
        assertThat(slack.format()).isEqualTo(OpsAlertService.WebhookFormat.SLACK);
        assertThat(slack.alert("slack-key", "WARN", "RSS batch failed", Map.of("feedCount", 5))).isTrue();
        JsonNode slackJson = json.readTree(slackPayloads.get(0));
        assertThat(slackJson.path("text").asText()).contains("[content-server]");
        assertThat(slackJson.path("attachments").isArray()).isTrue();
        assertThat(slackJson.path("attachments").get(0).path("color").asText()).isEqualTo("warning");

        // 3. Telegram formatting (chat_id + text)
        List<String> tgPayloads = new ArrayList<>();
        OpsAlertService telegram = new OpsAlertService(
                "https://api.telegram.org/bot12345:token/sendMessage",
                Duration.ofMinutes(5),
                mutableClock,
                json,
                "-100999888",
                (uri, payload) -> {
                    tgPayloads.add(payload);
                    return CompletableFuture.completedFuture(new OpsAlertService.DispatchResult(200, true, null));
                });
        assertThat(telegram.format()).isEqualTo(OpsAlertService.WebhookFormat.TELEGRAM);
        assertThat(telegram.alert("tg-key", "ERROR", "Suspension stuck", Map.of("memberId", 7))).isTrue();
        JsonNode tgJson = json.readTree(tgPayloads.get(0));
        assertThat(tgJson.path("chat_id").asText()).isEqualTo("-100999888");
        assertThat(tgJson.path("text").asText()).contains("Suspension stuck");

        // 4. Generic formatting & cooldown expiry
        List<URI> sentUris = new ArrayList<>();
        OpsAlertService generic = new OpsAlertService(
                "https://hooks.example.test/ops",
                Duration.ofMinutes(5),
                mutableClock,
                json,
                (uri, payload) -> {
                    sentUris.add(uri);
                    sent.add(payload);
                });
        assertThat(generic.format()).isEqualTo(OpsAlertService.WebhookFormat.GENERIC);
        assertThat(generic.alert("s3-fail", "ERROR", "S3 failure", Map.of("taskId", 1))).isTrue();
        assertThat(generic.alert("s3-fail", "ERROR", "S3 failure repeat", Map.of("taskId", 2))).isFalse();
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)).contains("\"service\":\"content-server\"").contains("\"content\":").contains("\"text\":");

        now[0] = now[0].plusSeconds(301);
        assertThat(generic.alert("s3-fail", "ERROR", "S3 failure after cooldown", Map.of("taskId", 3))).isTrue();
        assertThat(sent).hasSize(2);
        assertThat(sentUris).allMatch(u -> u.toString().equals("https://hooks.example.test/ops"));
    }

    @Test
    void opsResourceWatchdogFiresAlertWhenHeapExceeds85Percent() {
        ObjectMapper json = new ObjectMapper();
        List<String> payloads = new ArrayList<>();
        OpsAlertService alerts = new OpsAlertService(
                "https://hooks.example.test/ops",
                Duration.ofMinutes(5),
                Clock.systemUTC(),
                json,
                (uri, payload) -> payloads.add(payload));

        MemoryMXBean highHeap = mock(MemoryMXBean.class);
        when(highHeap.getHeapMemoryUsage()).thenReturn(new MemoryUsage(0, 900L * 1024 * 1024, 950L * 1024 * 1024, 1000L * 1024 * 1024));
        OpsResourceWatchdog watchdog = new OpsResourceWatchdog(alerts, null, highHeap, true);
        watchdog.checkNow();

        assertThat(payloads).hasSize(1);
        assertThat(payloads.get(0)).contains("jvm-heap-high");
    }

    @Test
    void magicByteValidationRejectsSpoofedVideosSvgHtmlAndEnforces3MbGifCapEvenWhenRenamedJpg() {
        CommunityS3Service s3 = new CommunityS3Service(
                false, "http://localhost:8080", ".gradle/local-runtime/test-magic-uploads",
                "", "", "", "ap-northeast-2", null, null, null);

        // 1. MP4 video bytes renamed to .jpg with image/jpeg Content-Type -> REJECTED 400
        byte[] mp4Header = new byte[]{0x00, 0x00, 0x00, 0x18, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0};
        var spoofedVideo = new MockMultipartFile("files", "clip.jpg", "image/jpeg", mp4Header);
        assertThatThrownBy(() -> s3.validateImageFile(spoofedVideo))
                .isInstanceOf(AuthFailure.class)
                .satisfies(ex -> assertThat(((AuthFailure) ex).code()).isEqualTo("FILE_TYPE_NOT_ALLOWED"));

        // 2. SVG payload renamed to .png -> REJECTED 400
        var spoofedSvg = new MockMultipartFile("files", "xss.png", "image/png",
                "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> s3.validateImageFile(spoofedSvg))
                .isInstanceOf(AuthFailure.class)
                .satisfies(ex -> assertThat(((AuthFailure) ex).code()).isEqualTo("FILE_TYPE_NOT_ALLOWED"));

        // 3. HTML/JS renamed to .webp -> REJECTED 400
        var spoofedHtml = new MockMultipartFile("files", "evil.webp", "image/webp",
                "<!DOCTYPE html><html><script>alert(1)</script></html>".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> s3.validateImageFile(spoofedHtml))
                .isInstanceOf(AuthFailure.class)
                .satisfies(ex -> assertThat(((AuthFailure) ex).code()).isEqualTo("FILE_TYPE_NOT_ALLOWED"));

        // 4. 3.5MB GIF renamed to .jpg with image/jpeg header -> MUST be caught by detected GIF magic bytes & rejected with GIF_FILE_TOO_LARGE!
        byte[] renamedBigGif = new byte[3 * 1024 * 1024 + 512 * 1024];
        System.arraycopy(new byte[]{'G', 'I', 'F', '8', '9', 'a'}, 0, renamedBigGif, 0, 6);
        var spoofedGifAsJpg = new MockMultipartFile("files", "tricky.jpg", "image/jpeg", renamedBigGif);
        assertThatThrownBy(() -> s3.validateImageFile(spoofedGifAsJpg))
                .isInstanceOf(AuthFailure.class)
                .satisfies(ex -> assertThat(((AuthFailure) ex).code()).isEqualTo("GIF_FILE_TOO_LARGE"));

        // 5. Small GIF renamed to .jpg -> stored & served using canonical image/gif MIME & .gif key (never trusts client header!)
        byte[] smallGif = new byte[]{'G', 'I', 'F', '8', '9', 'a', 1, 0, 1, 0, 0, 0, 0};
        var smallGifRenamedJpg = new MockMultipartFile("files", "meme.jpg", "image/jpeg", smallGif);
        var uploaded = s3.validateAndUploadProfileImage(smallGifRenamedJpg);
        try {
            assertThat(uploaded.contentType()).isEqualTo("image/gif");
            assertThat(uploaded.key()).endsWith(".gif");
            var readBack = s3.readLocalMedia(uploaded.key());
            assertThat(readBack).isNotNull();
            assertThat(readBack.contentType()).isEqualTo("image/gif");
            // Path traversal attempt must return null
            assertThat(s3.readLocalMedia("member/profile/../../etc/passwd")).isNull();
        } finally {
            s3.deleteByKeyQuietly(uploaded.key());
        }
    }

    @Test
    void contentEndpointRateLimiterEnforcesSlidingWindowsAndMax5ConcurrentSsePerIp() {
        Instant[] now = {Instant.parse("2026-11-22T02:00:00Z")};
        ContentEndpointRateLimiter limiter = new ContentEndpointRateLimiter(
                true, 2, 2, 2, 2, 2, 2, 2, 5,
                Duration.ofMinutes(1), 100, mutableClock(now));

        limiter.checkCsrf("198.51.100.1");
        limiter.checkCsrf("198.51.100.1");
        assertThatThrownBy(() -> limiter.checkCsrf("198.51.100.1"))
                .isInstanceOf(RateLimitedException.class)
                .satisfies(ex -> assertThat(((RateLimitedException) ex).retryAfterSeconds()).isGreaterThanOrEqualTo(1L));

        // After 61s window expires, requests are allowed again
        now[0] = now[0].plusSeconds(61);
        limiter.checkCsrf("198.51.100.1");

        // Concurrent SSE cap: 5 slots succeed, 6th throws RateLimitedException, releasing 1 frees slot!
        List<Runnable> releases = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            releases.add(limiter.acquireSseSlot("198.51.100.2"));
        }
        assertThat(limiter.activeSseConnectionsForIp("198.51.100.2")).isEqualTo(5);
        assertThatThrownBy(() -> limiter.acquireSseSlot("198.51.100.2"))
                .isInstanceOf(RateLimitedException.class);
        releases.get(0).run();
        assertThat(limiter.activeSseConnectionsForIp("198.51.100.2")).isEqualTo(4);
        Runnable sixth = limiter.acquireSseSlot("198.51.100.2");
        assertThat(limiter.activeSseConnectionsForIp("198.51.100.2")).isEqualTo(5);
        sixth.run();
        releases.forEach(Runnable::run);
        assertThat(limiter.activeSseConnectionsForIp("198.51.100.2")).isZero();
    }

    @Test
    void clientErrorBufferCapsAt30SlotsAndScrubsBearerTokensAndEmails() {
        ClientErrorBuffer buffer = new ClientErrorBuffer();
        for (int i = 0; i < 40; i++) {
            buffer.record("/trading", "Crash #" + i + " Bearer eyJhbGciOiJSUzI1NiJ9.secret.sig user@example.com",
                    "at App (app.tsx:10)", "d-" + i, "Mozilla/5.0", "req-" + i);
        }
        List<ClientErrorBuffer.ClientErrorEntry> recent = buffer.recent();
        assertThat(recent).hasSize(ClientErrorBuffer.MAX_ENTRIES);
        assertThat(recent.get(0).message()).contains("Crash #39").doesNotContain("eyJhbGci").doesNotContain("user@example.com");
    }

    private static Clock mutableClock(Instant[] now) {
        return new Clock() {
            @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(ZoneId zone) { return this; }
            @Override public Instant instant() { return now[0]; }
        };
    }
}
