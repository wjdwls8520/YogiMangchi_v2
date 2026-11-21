package com.yogimangchi.trading.ops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.ApiExceptionHandler;
import com.yogimangchi.trading.error.RateLimitedException;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.MarkPriceTimePolicy;
import com.yogimangchi.trading.security.TradingEndpointRateLimiter;
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OpsUnitTests {

    @Test
    void opsAlertServiceIsCompleteNoOpWhenWebhookUrlIsBlank() {
        List<String> sent = new ArrayList<>();
        OpsAlertService disabled = new OpsAlertService(
                "   ", Duration.ofMinutes(5), Clock.systemUTC(), new ObjectMapper(), (uri, body) -> sent.add(body));
        assertThat(disabled.isEnabled()).isFalse();
        assertThat(disabled.alert("LEDGER_MISMATCH:1", "CRITICAL", "Mismatch", Map.of("accountId", 1L))).isFalse();
        assertThat(sent).isEmpty();
        var testRes = disabled.sendTestAlert(1L);
        assertThat(testRes.enabled()).isFalse();
        assertThat(testRes.dispatched()).isFalse();
        assertThat(testRes.status()).isEqualTo("DISABLED");
    }

    @Test
    void opsAlertServiceEnforcesPerKeyFiveMinuteCooldown() throws Exception {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-21T10:00:00Z"));
        Clock mutableClock = fixedMutableClock(now);
        List<String> payloads = new ArrayList<>();
        ObjectMapper mapper = new ObjectMapper();
        OpsAlertService service = new OpsAlertService(
                "https://alerts.example.test/webhook",
                Duration.ofMinutes(5),
                mutableClock,
                mapper,
                (URI uri, String body) -> payloads.add(body));

        assertThat(service.isEnabled()).isTrue();
        assertThat(service.alert("LEDGER_MISMATCH:7", "CRITICAL", "Mismatch", Map.of("accountId", 7L))).isTrue();
        assertThat(service.alert("LEDGER_MISMATCH:7", "CRITICAL", "Mismatch again", Map.of("accountId", 7L))).isFalse();
        assertThat(service.alert("RISK_HELD:7", "CRITICAL", "Held", Map.of("accountId", 7L))).isTrue();
        assertThat(payloads).hasSize(2);

        now.set(now.get().plusSeconds(299));
        assertThat(service.alert("LEDGER_MISMATCH:7", "CRITICAL", "Still cooling down", Map.of())).isFalse();
        assertThat(payloads).hasSize(2);

        now.set(now.get().plusSeconds(1));
        assertThat(service.alert("LEDGER_MISMATCH:7", "CRITICAL", "After cooldown", Map.of("accountId", 7L))).isTrue();
        assertThat(payloads).hasSize(3);

        var parsed = mapper.readTree(payloads.get(0));
        assertThat(parsed.path("service").asText()).isEqualTo("trading-server");
        assertThat(parsed.path("key").asText()).isEqualTo("LEDGER_MISMATCH:7");
        assertThat(parsed.path("severity").asText()).isEqualTo("CRITICAL");
        assertThat(parsed.path("content").asText()).contains("[CRITICAL]", "[trading-server]", "Mismatch");
        assertThat(parsed.path("text").asText()).contains("[CRITICAL]", "[trading-server]", "Mismatch");
    }

    @Test
    void opsAlertServiceFormatsDiscordSlackTelegramPayloadsAndRecordsBoundedDispatchHistory() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-21T12:00:00Z"));
        Clock clock = fixedMutableClock(now);

        // 1. Discord webhook: non-empty "content" + structured "embeds"
        List<String> discordPayloads = new ArrayList<>();
        OpsAlertService discord = new OpsAlertService(
                "https://discord.com/api/webhooks/123456/secret-token",
                Duration.ofSeconds(1), clock, mapper, "",
                (uri, body) -> {
                    discordPayloads.add(body);
                    return CompletableFuture.completedFuture(new OpsAlertService.DispatchResult(204, true, null));
                });
        assertThat(discord.format()).isEqualTo(OpsAlertService.WebhookFormat.DISCORD);
        assertThat(discord.alert("trading-5xx:/api/v1/test", "CRITICAL", "API 500 error", Map.of("uri", "/api/v1/test"))).isTrue();
        var discordJson = mapper.readTree(discordPayloads.get(0));
        assertThat(discordJson.path("content").asText()).contains("[CRITICAL]", "[trading-server]", "API 500 error");
        assertThat(discordJson.path("embeds").isArray()).isTrue();
        assertThat(discordJson.path("embeds").get(0).path("title").asText()).contains("API 500 error");

        // 2. Slack webhook: non-empty "text"
        List<String> slackPayloads = new ArrayList<>();
        OpsAlertService slack = new OpsAlertService(
                "https://hooks.slack.com/services/T000/B000/XXX",
                Duration.ofSeconds(1), clock, mapper, "",
                (uri, body) -> {
                    slackPayloads.add(body);
                    return CompletableFuture.completedFuture(new OpsAlertService.DispatchResult(200, true, null));
                });
        assertThat(slack.format()).isEqualTo(OpsAlertService.WebhookFormat.SLACK);
        assertThat(slack.alert("slack-key", "WARN", "High heap", Map.of("heapUsagePercent", 91.2))).isTrue();
        var slackJson = mapper.readTree(slackPayloads.get(0));
        assertThat(slackJson.path("text").asText()).contains("[WARN]", "[trading-server]", "High heap", "91.2");

        // 3. Telegram webhook: non-empty "text" + chat_id
        List<String> telegramPayloads = new ArrayList<>();
        OpsAlertService telegram = new OpsAlertService(
                "https://api.telegram.org/bot123456:token/sendMessage",
                Duration.ofSeconds(1), clock, mapper, "-100123456",
                (uri, body) -> {
                    telegramPayloads.add(body);
                    return CompletableFuture.completedFuture(new OpsAlertService.DispatchResult(200, true, null));
                });
        assertThat(telegram.format()).isEqualTo(OpsAlertService.WebhookFormat.TELEGRAM);
        assertThat(telegram.alert("tg-key", "CRITICAL", "Redis down", Map.of("reason", "timeout"))).isTrue();
        var tgJson = mapper.readTree(telegramPayloads.get(0));
        assertThat(tgJson.path("text").asText()).contains("[CRITICAL]", "Redis down");
        assertThat(tgJson.path("chat_id").asText()).isEqualTo("-100123456");

        // 4. Bounded 10-slot dispatch ring buffer records HTTP failures too + test alert bypasses cooldown
        OpsAlertService ring = new OpsAlertService(
                "https://discordapp.com/api/webhooks/999/tok",
                Duration.ofMinutes(5), clock, mapper, "",
                (uri, body) -> {
                    boolean fail = body.contains("FAIL_KEY");
                    return CompletableFuture.completedFuture(fail
                            ? new OpsAlertService.DispatchResult(400, false, "HTTP 400 Bad Request")
                            : new OpsAlertService.DispatchResult(204, true, null));
                });
        for (int i = 1; i <= 12; i++) {
            ring.alert("KEY_" + i, "WARN", i == 12 ? "FAIL_KEY_TITLE" : ("Title " + i), Map.of("i", i));
        }
        assertThat(ring.recentDispatches()).hasSize(OpsAlertService.MAX_DISPATCH_HISTORY);
        assertThat(ring.recentDispatches().get(0).key()).isEqualTo("KEY_12");
        assertThat(ring.recentDispatches().get(0).httpStatus()).isEqualTo(400);
        assertThat(ring.recentDispatches().get(0).success()).isFalse();
        assertThat(ring.recentDispatches().get(0).errorSummary()).contains("400");
        assertThat(ring.telemetry().lastStatus()).contains("HTTP_400");

        var testResp = ring.sendTestAlert(42L);
        assertThat(testResp.enabled()).isTrue();
        assertThat(testResp.dispatched()).isTrue();
        assertThat(testResp.success()).isTrue();
        assertThat(testResp.httpStatus()).isEqualTo(204);
        assertThat(ring.recentDispatches().get(0).key()).isEqualTo("ADMIN_TEST_ALERT");
        assertThat(ring.telemetry().lastStatus()).isEqualTo("OK (204)");
    }

    @Test
    void opsErrorBufferSeparates5xxFrom409NoiseCapturesTopAppFrameAndTracksRollingMetrics() {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-21T10:00:00Z"));
        OpsErrorBuffer buffer = new OpsErrorBuffer(fixedMutableClock(now));
        buffer.record(400, "INVALID_ORDER", "POST", "/api/v1/trading/account/orders", "req-ignored", "BAD");
        buffer.record(404, "ORDER_NOT_FOUND", "GET", "/api/v1/trading/account/orders/1", "req-ignored2", "NF");
        assertThat(buffer.recent()).isEmpty();
        assertThat(buffer.recentCritical()).isEmpty();

        // Record a real 500 with an application stack frame
        RuntimeException appEx = new RuntimeException("boom");
        String topFrame = OpsErrorBuffer.extractTopAppFrame(appEx);
        assertThat(topFrame).startsWith("OpsUnitTests.");
        buffer.record(500, "INTERNAL_ERROR", "POST", "/api/v1/trading/account/orders?token=secret", "req-500", "RuntimeException", topFrame);

        // Flood 80 business 409 rejections and 15 429 rate-limit rejections
        for (int i = 1; i <= 80; i++) {
            buffer.record(409, "INSUFFICIENT_MARGIN_" + i, "POST", "/api/v1/trading/account/orders?foo=bar", "req-409-" + i, "INSUFFICIENT_MARGIN");
        }
        for (int i = 1; i <= 15; i++) {
            buffer.record(429, "RATE_LIMITED", "GET", "/api/v1/market/candles", "req-429-" + i, "RATE_LIMITED");
        }

        // Real 500 is NEVER evicted by 80 409s!
        assertThat(buffer.recentCritical()).hasSize(1);
        assertThat(buffer.recentCritical().get(0).code()).isEqualTo("INTERNAL_ERROR");
        assertThat(buffer.recentCritical().get(0).uri()).isEqualTo("/api/v1/trading/account/orders");
        assertThat(buffer.recentCritical().get(0).topAppFrame()).isEqualTo(topFrame);
        assertThat(buffer.recent()).hasSize(50);
        assertThat(buffer.recent()).anyMatch(e -> "INTERNAL_ERROR".equals(e.code()) && e.status() == 500);

        var metricsNow = buffer.metrics();
        assertThat(metricsNow.last5m5xx()).isEqualTo(1L);
        assertThat(metricsNow.last1h5xx()).isEqualTo(1L);
        assertThat(metricsNow.total5xx()).isEqualTo(1L);
        assertThat(metricsNow.total429()).isEqualTo(15L);
        assertThat(metricsNow.total409()).isEqualTo(80L);

        // Advance 6 minutes -> 5m window drops to 0, 1h window remains 1
        now.set(now.get().plusSeconds(360));
        var metrics6m = buffer.metrics();
        assertThat(metrics6m.last5m5xx()).isZero();
        assertThat(metrics6m.last1h5xx()).isEqualTo(1L);
        assertThat(metrics6m.total5xx()).isEqualTo(1L);

        // Advance past 1 hour -> 1h window drops to 0, total5xx stays 1
        now.set(now.get().plusSeconds(3600));
        var metrics2h = buffer.metrics();
        assertThat(metrics2h.last1h5xx()).isZero();
        assertThat(metrics2h.total5xx()).isEqualTo(1L);
    }

    @Test
    void opsResourceWatchdogAlertsOnHighHeapAndHikariPoolStarvation() {
        List<String> payloads = new ArrayList<>();
        OpsAlertService alertService = new OpsAlertService(
                "https://alerts.example.test/webhook",
                Duration.ofMinutes(5), Clock.systemUTC(), new ObjectMapper(),
                (uri, body) -> payloads.add(body));

        MemoryMXBean memoryBean = mock(MemoryMXBean.class);
        when(memoryBean.getHeapMemoryUsage()).thenReturn(new MemoryUsage(0, 900L * 1024 * 1024, 950L * 1024 * 1024, 1000L * 1024 * 1024));

        HikariDataSource hikari = mock(HikariDataSource.class);
        HikariPoolMXBean pool = mock(HikariPoolMXBean.class);
        when(hikari.getHikariPoolMXBean()).thenReturn(pool);
        when(hikari.getMaximumPoolSize()).thenReturn(10);
        when(pool.getThreadsAwaitingConnection()).thenReturn(3);
        when(pool.getActiveConnections()).thenReturn(10);
        when(pool.getIdleConnections()).thenReturn(0);
        when(pool.getTotalConnections()).thenReturn(10);

        @SuppressWarnings("unchecked")
        ObjectProvider<DataSource> dsProvider = mock(ObjectProvider.class);
        when(dsProvider.getIfAvailable()).thenReturn(hikari);

        OpsResourceWatchdog watchdog = new OpsResourceWatchdog(alertService, dsProvider, memoryBean, true);
        watchdog.checkNow();

        assertThat(payloads).hasSize(2);
        assertThat(payloads).anyMatch(p -> p.contains("jvm-heap-high"));
        assertThat(payloads).anyMatch(p -> p.contains("hikari-pool-starvation"));
    }

    @Test
    void tradingEndpointRateLimiterEnforcesPerIpCandleAndPerAccountOrderLimits() {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-21T10:00:00Z"));
        TradingEndpointRateLimiter limiter = new TradingEndpointRateLimiter(
                true, 3, 2, Duration.ofMinutes(1), 100, fixedMutableClock(now));

        limiter.checkCandleRequest("10.0.0.1");
        limiter.checkCandleRequest("10.0.0.1");
        limiter.checkCandleRequest("10.0.0.1");
        assertThatThrownBy(() -> limiter.checkCandleRequest("10.0.0.1"))
                .isInstanceOf(RateLimitedException.class);
        // Different IP is unaffected
        limiter.checkCandleRequest("10.0.0.2");

        limiter.checkOrderWrite(100L);
        limiter.checkOrderWrite(100L);
        assertThatThrownBy(() -> limiter.checkOrderWrite(100L))
                .isInstanceOf(RateLimitedException.class);
        // Different account is unaffected
        limiter.checkOrderWrite(200L);

        // After window expires, requests pass again
        now.set(now.get().plusSeconds(61));
        limiter.checkCandleRequest("10.0.0.1");
        limiter.checkOrderWrite(100L);
    }

    @Test
    void requestIdMdcFilterSetsHeaderPropagatesValidIdAndCleansMdc() throws Exception {
        RequestIdMdcFilter filter = new RequestIdMdcFilter();

        MockHttpServletRequest req1 = new MockHttpServletRequest("GET", "/api/v1/trading/status");
        MockHttpServletResponse res1 = new MockHttpServletResponse();
        AtomicReference<String> seenInChain = new AtomicReference<>();
        filter.doFilter(req1, res1, (r, s) -> seenInChain.set(MDC.get(RequestIdMdcFilter.MDC_KEY)));
        assertThat(seenInChain.get()).isNotBlank().hasSize(16);
        assertThat(res1.getHeader(RequestIdMdcFilter.HEADER_NAME)).isEqualTo(seenInChain.get());
        assertThat(MDC.get(RequestIdMdcFilter.MDC_KEY)).isNull();

        MockHttpServletRequest req2 = new MockHttpServletRequest("GET", "/api/v1/trading/status");
        req2.addHeader(RequestIdMdcFilter.HEADER_NAME, "trace-valid_12345");
        MockHttpServletResponse res2 = new MockHttpServletResponse();
        filter.doFilter(req2, res2, (r, s) -> seenInChain.set(MDC.get(RequestIdMdcFilter.MDC_KEY)));
        assertThat(seenInChain.get()).isEqualTo("trace-valid_12345");
        assertThat(res2.getHeader(RequestIdMdcFilter.HEADER_NAME)).isEqualTo("trace-valid_12345");
        assertThat(MDC.get(RequestIdMdcFilter.MDC_KEY)).isNull();

        MockHttpServletRequest req3 = new MockHttpServletRequest("GET", "/api/v1/trading/status");
        req3.addHeader(RequestIdMdcFilter.HEADER_NAME, "bad\r\ninjection");
        MockHttpServletResponse res3 = new MockHttpServletResponse();
        filter.doFilter(req3, res3, (r, s) -> seenInChain.set(MDC.get(RequestIdMdcFilter.MDC_KEY)));
        assertThat(seenInChain.get()).doesNotContain("bad", "\r", "\n").hasSize(16);
        assertThat(MDC.get(RequestIdMdcFilter.MDC_KEY)).isNull();
    }

    @Test
    void apiExceptionHandlerAlertsWithPerUriCooldownKeyAndCapturesTopAppFrame() {
        List<String> payloads = new ArrayList<>();
        OpsAlertService alertService = new OpsAlertService(
                "https://alerts.example.test/webhook",
                Duration.ofMinutes(5), Clock.systemUTC(), new ObjectMapper(),
                (uri, body) -> payloads.add(body));
        OpsErrorBuffer buffer = new OpsErrorBuffer();

        @SuppressWarnings("unchecked")
        ObjectProvider<OpsErrorBuffer> bufProvider = mock(ObjectProvider.class);
        when(bufProvider.getIfAvailable()).thenReturn(buffer);
        @SuppressWarnings("unchecked")
        ObjectProvider<OpsAlertService> alertProvider = mock(ObjectProvider.class);
        when(alertProvider.getIfAvailable()).thenReturn(alertService);

        ApiExceptionHandler handler = new ApiExceptionHandler(bufProvider, alertProvider);
        try {
            // Two different URIs must each trigger their own alert (per-URI cooldown, NOT one global key!)
            RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(
                    new MockHttpServletRequest("POST", "/api/v1/trading/account/orders")));
            handler.handleUnexpectedException(new IllegalStateException("order boom"));

            RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(
                    new MockHttpServletRequest("GET", "/api/v1/trading/account/wallet")));
            handler.handleUnexpectedException(new IllegalStateException("wallet boom"));

            // Same URI again within cooldown is suppressed
            handler.handleUnexpectedException(new IllegalStateException("wallet boom 2"));

            // DB pool failure triggers 503 alert with per-URI key
            RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(
                    new MockHttpServletRequest("GET", "/api/v1/trading/account/summary")));
            var dbProblem = handler.handleDataAccessUnavailable(new DataAccessResourceFailureException("pool exhausted"));
            assertThat(dbProblem.getStatus()).isEqualTo(503);
        } finally {
            RequestContextHolder.resetRequestAttributes();
        }

        assertThat(payloads).hasSize(3);
        assertThat(payloads.get(0)).contains("trading-5xx:/api/v1/trading/account/orders");
        assertThat(payloads.get(1)).contains("trading-5xx:/api/v1/trading/account/wallet");
        assertThat(payloads.get(2)).contains("trading-503:/api/v1/trading/account/summary");
        assertThat(buffer.recentCritical()).hasSize(4);
        assertThat(buffer.recentCritical().get(0).topAppFrame()).startsWith("OpsUnitTests.");
    }

    @Test
    void latestPriceStoreAlertsOnClockTransitionToDegradedAndRejected() {
        Instant base = Instant.parse("2026-11-21T12:00:00Z");
        Clock fixedClock = Clock.fixed(base, ZoneOffset.UTC);
        List<String> payloads = new ArrayList<>();
        OpsAlertService alertService = new OpsAlertService(
                "https://alerts.example.test/webhook",
                Duration.ofMinutes(5), fixedClock, new ObjectMapper(),
                (uri, body) -> payloads.add(body));
        @SuppressWarnings("unchecked")
        ObjectProvider<OpsAlertService> alertProvider = mock(ObjectProvider.class);
        when(alertProvider.getIfAvailable()).thenReturn(alertService);

        MarkPriceTimePolicy.Policy strictPolicy = new MarkPriceTimePolicy.Policy(
                true, Duration.ofSeconds(10), Duration.ofSeconds(30), Duration.ofSeconds(120), Duration.ofMinutes(5));
        LatestPriceStore store = new LatestPriceStore(fixedClock, event -> { }, strictPolicy, alertProvider);
        store.beginSubscription(Set.of(1L));

        // Normal price: no alert
        assertThat(store.update(new LatestMarkPrice(1L, new BigDecimal("1000"), base, base))).isTrue();
        assertThat(payloads).isEmpty();

        // Skew 45s -> DEGRADED alert
        assertThat(store.update(new LatestMarkPrice(1L, new BigDecimal("1001"), base.plusSeconds(45), base))).isTrue();
        assertThat(payloads).hasSize(1);
        assertThat(payloads.get(0)).contains("market-clock:DEGRADED:1");

        // Skew 180s -> REJECTED alert
        assertThat(store.update(new LatestMarkPrice(1L, new BigDecimal("1002"), base.plusSeconds(180), base))).isFalse();
        assertThat(payloads).hasSize(2);
        assertThat(payloads.get(1)).contains("market-clock:REJECTED:1");
    }

    private static Clock fixedMutableClock(AtomicReference<Instant> ref) {
        return new Clock() {
            @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(java.time.ZoneId zone) { return this; }
            @Override public Instant instant() { return ref.get(); }
        };
    }
}
