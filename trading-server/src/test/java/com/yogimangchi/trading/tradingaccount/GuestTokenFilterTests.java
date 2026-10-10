package com.yogimangchi.trading.tradingaccount;

import com.yogimangchi.trading.tradingaccount.security.GuestCredentialService;
import com.yogimangchi.trading.tradingaccount.security.GuestCredentials;
import com.yogimangchi.trading.tradingaccount.security.GuestTokenFilter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.transaction.CannotCreateTransactionException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class GuestTokenFilterTests {
    @Test
    void unavailableDatabaseReturnsSanitized503EvenWhenTransactionCannotStart() throws Exception {
        GuestCredentialService credentials = mock(GuestCredentialService.class);
        String token = GuestCredentials.issue();
        when(credentials.authenticate(token)).thenThrow(new CannotCreateTransactionException("private connection secret"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/trading/account/wallet");
        request.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse response = new MockHttpServletResponse();
        new GuestTokenFilter(credentials).doFilter(request, response, (req, res) -> { throw new AssertionError("Unavailable credentials must not proceed"); });
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getContentAsString()).contains("AUTHENTICATION_UNAVAILABLE").doesNotContain("private", token);
    }
}
