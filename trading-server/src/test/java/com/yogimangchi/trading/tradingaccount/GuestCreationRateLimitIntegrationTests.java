package com.yogimangchi.trading.tradingaccount;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.security.GuestCreationRateLimiter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "binance.mark-price.enabled=false",
        "binance.order-book.enabled=false",
        "trading.guest-creation.rate-limit-enabled=true",
        "trading.guest-creation.max-per-window=3",
        "trading.guest-creation.window-seconds=600"
})
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
class GuestCreationRateLimitIntegrationTests {

    @Autowired private MockMvc mvc;
    @Autowired private GuestCreationRateLimiter rateLimiter;

    @BeforeEach
    void resetLimiter() {
        rateLimiter.reset();
    }

    @Test
    void guestCreationEndpointReturns429RateLimitedWithRetryAfterAndRequestIdPerRemoteIp() throws Exception {
        for (int i = 0; i < 3; i++) {
            mvc.perform(post("/api/v1/trading/accounts/guest")
                            .with(req -> {
                                req.setRemoteAddr("203.0.113.10");
                                return req;
                            }))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.accessToken").isNotEmpty());
        }

        // 4th request from same IP -> 429 RATE_LIMITED + Retry-After + requestId matching X-Request-Id
        var rejected = mvc.perform(post("/api/v1/trading/accounts/guest")
                        .header("X-Request-Id", "guest-rl-12345678")
                        .with(req -> {
                            req.setRemoteAddr("203.0.113.10");
                            return req;
                        }))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("X-Request-Id", "guest-rl-12345678"))
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"))
                .andExpect(jsonPath("$.requestId").value("guest-rl-12345678"))
                .andReturn();

        long retryAfter = Long.parseLong(rejected.getResponse().getHeader("Retry-After"));
        assertThat(retryAfter).isBetween(1L, 600L);

        // Different IP is still allowed to create a guest account
        mvc.perform(post("/api/v1/trading/accounts/guest")
                        .with(req -> {
                            req.setRemoteAddr("203.0.113.11");
                            return req;
                        }))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accessToken").isNotEmpty());
    }
}
