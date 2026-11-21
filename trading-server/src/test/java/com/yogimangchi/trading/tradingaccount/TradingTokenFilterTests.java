package com.yogimangchi.trading.tradingaccount;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.ops.OpsAlertService;
import com.yogimangchi.trading.ops.OpsErrorBuffer;
import com.yogimangchi.trading.ops.RequestIdMdcFilter;
import com.yogimangchi.trading.tradingaccount.security.MemberSuspendedException;
import com.yogimangchi.trading.tradingaccount.security.TradingCredentials;
import com.yogimangchi.trading.tradingaccount.security.GuestCredentials;
import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import com.yogimangchi.trading.tradingaccount.security.TradingTokenFilter;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.CannotCreateTransactionException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class TradingTokenFilterTests {
    private static final ObjectMapper JSON = new ObjectMapper();

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test void multipleAuthorizationHeadersAreRejectedBeforeAnyCredentialLookup() throws Exception {
        var credentials=mock(TradingCredentials.class);
        var request=new MockHttpServletRequest("GET","/api/v1/trading/account/wallet");
        request.addHeader("Authorization","Bearer one"); request.addHeader("Authorization","Bearer two");
        var response=new MockHttpServletResponse();
        new TradingTokenFilter(credentials).doFilter(request,response,(req,res) -> { throw new AssertionError("Ambiguous identity must not proceed"); });
        assertThat(response.getStatus()).isEqualTo(401); verifyNoInteractions(credentials);
    }
    @Test
    void unavailableDatabaseReturnsSanitized503EvenWhenTransactionCannotStart() throws Exception {
        TradingCredentials credentials = mock(TradingCredentials.class);
        String token = GuestCredentials.issue();
        when(credentials.authenticate(token)).thenThrow(new CannotCreateTransactionException("private connection secret"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/trading/account/wallet");
        request.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse response = new MockHttpServletResponse();
        new TradingTokenFilter(credentials).doFilter(request, response, (req, res) -> { throw new AssertionError("Unavailable credentials must not proceed"); });
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getContentAsString()).contains("AUTHENTICATION_UNAVAILABLE").doesNotContain("private", token);
    }

    @Test
    void unauthorizedProblemJsonIncludesRequestIdFromMdcAndHeaderFallback() throws Exception {
        TradingCredentials credentials = mock(TradingCredentials.class);
        when(credentials.authenticate(anyString())).thenReturn(Optional.empty());

        MockHttpServletRequest mdcRequest = new MockHttpServletRequest("GET", "/api/v1/trading/account/wallet");
        mdcRequest.addHeader("Authorization", "Bearer invalid.jwt.token");
        MockHttpServletResponse mdcResponse = new MockHttpServletResponse();
        MDC.put(RequestIdMdcFilter.MDC_KEY, "mdc-req-12345678");
        try {
            new TradingTokenFilter(credentials).doFilter(mdcRequest, mdcResponse, (req, res) -> {
                throw new AssertionError("Invalid token must not proceed");
            });
        } finally {
            MDC.remove(RequestIdMdcFilter.MDC_KEY);
        }
        assertThat(mdcResponse.getStatus()).isEqualTo(401);
        var mdcBody = JSON.readTree(mdcResponse.getContentAsString());
        assertThat(mdcBody.path("code").asText()).isEqualTo("INVALID_ACCESS_TOKEN");
        assertThat(mdcBody.path("requestId").asText()).isEqualTo("mdc-req-12345678");

        MockHttpServletRequest headerRequest = new MockHttpServletRequest("GET", "/api/v1/trading/account/wallet");
        headerRequest.addHeader("Authorization", "Bearer invalid-guest-token");
        headerRequest.addHeader("X-Request-Id", "hdr-req-87654321");
        MockHttpServletResponse headerResponse = new MockHttpServletResponse();
        new TradingTokenFilter(credentials).doFilter(headerRequest, headerResponse, (req, res) -> {
            throw new AssertionError("Invalid token must not proceed");
        });
        assertThat(headerResponse.getStatus()).isEqualTo(401);
        var headerBody = JSON.readTree(headerResponse.getContentAsString());
        assertThat(headerBody.path("code").asText()).isEqualTo("INVALID_GUEST_CREDENTIAL");
        assertThat(headerBody.path("requestId").asText()).isEqualTo("hdr-req-87654321");
    }

    @Test
    void dbOutageGrantsDegradedAdminAccessOnlyForOpsSummaryAndActuatorMetricsAndBuffersOther503s() throws Exception {
        TradingCredentials credentials = mock(TradingCredentials.class);
        OpsErrorBuffer errorBuffer = new OpsErrorBuffer();
        OpsAlertService alerts = mock(OpsAlertService.class);
        String adminJwt = "header.admin.sig";
        String memberJwt = "header.member.sig";

        when(credentials.authenticate(adminJwt)).thenThrow(new CannotCreateTransactionException("db down"));
        when(credentials.authenticate(memberJwt)).thenThrow(new CannotCreateTransactionException("db down"));
        when(credentials.authenticateDegradedAdmin(adminJwt)).thenReturn(
                Optional.of(new TradingPrincipal(null, Instant.now().plusSeconds(300), 99L, List.of("MEMBER", "ADMIN"))));
        when(credentials.authenticateDegradedAdmin(memberJwt)).thenReturn(Optional.empty());

        TradingTokenFilter filter = new TradingTokenFilter(credentials, errorBuffer, alerts);

        // 1. Admin calling GET /api/v1/trading/admin/ops/summary during DB outage succeeds with degraded ROLE_ADMIN!
        MockHttpServletRequest opsReq = new MockHttpServletRequest("GET", "/api/v1/trading/admin/ops/summary");
        opsReq.addHeader("Authorization", "Bearer " + adminJwt);
        MockHttpServletResponse opsRes = new MockHttpServletResponse();
        AtomicBoolean chainCalled = new AtomicBoolean(false);
        filter.doFilter(opsReq, opsRes, (req, res) -> {
            chainCalled.set(true);
            var auth = SecurityContextHolder.getContext().getAuthentication();
            assertThat(auth).isNotNull();
            assertThat(auth.getAuthorities()).extracting("authority").contains("ROLE_ADMIN");
        });
        assertThat(chainCalled).isTrue();
        SecurityContextHolder.clearContext();

        // 2. Non-admin member calling /admin/ops/summary during DB outage is rejected with 503 and recorded in buffer + alert
        MockHttpServletRequest nonAdminReq = new MockHttpServletRequest("GET", "/api/v1/trading/admin/ops/summary");
        nonAdminReq.addHeader("Authorization", "Bearer " + memberJwt);
        MockHttpServletResponse nonAdminRes = new MockHttpServletResponse();
        filter.doFilter(nonAdminReq, nonAdminRes, (req, res) -> { throw new AssertionError("Must not proceed"); });
        assertThat(nonAdminRes.getStatus()).isEqualTo(503);
        assertThat(errorBuffer.recentCritical()).hasSize(1);
        assertThat(errorBuffer.recentCritical().get(0).code()).isEqualTo("AUTHENTICATION_UNAVAILABLE");
        verify(alerts, atLeastOnce()).alert(eq("trading-auth-503:/api/v1/trading/admin/ops/summary"), eq("CRITICAL"), anyString(), anyMap());

        // 3. Suspended member receives 403 MEMBER_SUSPENDED
        String suspendedJwt = "header.suspended.sig";
        when(credentials.authenticate(suspendedJwt)).thenThrow(new MemberSuspendedException(55L));
        MockHttpServletRequest suspReq = new MockHttpServletRequest("POST", "/api/v1/trading/account/orders");
        suspReq.addHeader("Authorization", "Bearer " + suspendedJwt);
        MockHttpServletResponse suspRes = new MockHttpServletResponse();
        filter.doFilter(suspReq, suspRes, (req, res) -> { throw new AssertionError("Suspended must not proceed"); });
        assertThat(suspRes.getStatus()).isEqualTo(403);
        assertThat(JSON.readTree(suspRes.getContentAsString()).path("code").asText()).isEqualTo("MEMBER_SUSPENDED");
    }
}
