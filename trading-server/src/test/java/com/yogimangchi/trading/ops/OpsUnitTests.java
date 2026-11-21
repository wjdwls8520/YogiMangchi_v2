package com.yogimangchi.trading.ops;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class OpsUnitTests {

    @Test
    void opsAlertServiceIsCompleteNoOpWhenWebhookUrlIsBlank() {
        List<String> sent = new ArrayList<>();
        OpsAlertService disabled = new OpsAlertService(
                "   ", Duration.ofMinutes(5), Clock.systemUTC(), new ObjectMapper(), (uri, body) -> sent.add(body));
        assertThat(disabled.isEnabled()).isFalse();
        assertThat(disabled.alert("LEDGER_MISMATCH:1", "CRITICAL", "Mismatch", Map.of("accountId", 1L))).isFalse();
        assertThat(sent).isEmpty();
    }

    @Test
    void opsAlertServiceEnforcesPerKeyFiveMinuteCooldown() throws Exception {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-21T10:00:00Z"));
        Clock mutableClock = new Clock() {
            @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(java.time.ZoneId zone) { return this; }
            @Override public Instant instant() { return now.get(); }
        };
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

        // Advance 4 minutes 59 seconds -> still within 5-minute cooldown
        now.set(now.get().plusSeconds(299));
        assertThat(service.alert("LEDGER_MISMATCH:7", "CRITICAL", "Still cooling down", Map.of())).isFalse();
        assertThat(payloads).hasSize(2);

        // Advance 1 more second -> cooldown elapsed, allowed again
        now.set(now.get().plusSeconds(1));
        assertThat(service.alert("LEDGER_MISMATCH:7", "CRITICAL", "After cooldown", Map.of("accountId", 7L))).isTrue();
        assertThat(payloads).hasSize(3);

        var parsed = mapper.readTree(payloads.get(0));
        assertThat(parsed.path("service").asText()).isEqualTo("trading-server");
        assertThat(parsed.path("key").asText()).isEqualTo("LEDGER_MISMATCH:7");
        assertThat(parsed.path("severity").asText()).isEqualTo("CRITICAL");
    }

    @Test
    void opsErrorBufferBoundsAtFiftyNewestFirstAndStripsQueryStrings() {
        OpsErrorBuffer buffer = new OpsErrorBuffer();
        buffer.record(400, "INVALID_ORDER", "POST", "/api/v1/trading/account/orders", "req-ignored", "BAD");
        buffer.record(404, "ORDER_NOT_FOUND", "GET", "/api/v1/trading/account/orders/1", "req-ignored2", "NF");
        assertThat(buffer.recent()).isEmpty();

        for (int i = 1; i <= 60; i++) {
            int status = i % 3 == 0 ? 500 : (i % 2 == 0 ? 503 : 409);
            buffer.record(status, "CODE_" + i, "POST", "/api/v1/trading/account/orders?token=secret" + i, "req-" + i, "Cause" + i);
        }

        var entries = buffer.recent();
        assertThat(entries).hasSize(50);
        assertThat(entries.get(0).code()).isEqualTo("CODE_60");
        assertThat(entries.get(0).uri()).isEqualTo("/api/v1/trading/account/orders");
        assertThat(entries.get(49).code()).isEqualTo("CODE_11");
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
}
