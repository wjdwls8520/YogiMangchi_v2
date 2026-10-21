package com.yogimangchi.trading.tradingaccount;

import com.yogimangchi.trading.tradingaccount.security.TradingCredentials;
import com.yogimangchi.trading.tradingaccount.security.GuestCredentials;
import com.yogimangchi.trading.tradingaccount.security.TradingTokenFilter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.transaction.CannotCreateTransactionException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class TradingTokenFilterTests {
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
}
