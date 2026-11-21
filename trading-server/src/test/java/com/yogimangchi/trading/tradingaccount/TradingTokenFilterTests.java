package com.yogimangchi.trading.tradingaccount;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.ops.RequestIdMdcFilter;
import com.yogimangchi.trading.tradingaccount.security.TradingCredentials;
import com.yogimangchi.trading.tradingaccount.security.GuestCredentials;
import com.yogimangchi.trading.tradingaccount.security.TradingTokenFilter;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.transaction.CannotCreateTransactionException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class TradingTokenFilterTests {
    private static final ObjectMapper JSON = new ObjectMapper();

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
}
