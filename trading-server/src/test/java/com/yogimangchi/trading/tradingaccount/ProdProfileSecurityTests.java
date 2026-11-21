package com.yogimangchi.trading.tradingaccount;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false","trading.member-auth.enabled=true",
        "TRADING_DB_URL=jdbc:postgresql://unused.invalid/test-only","TRADING_DB_USERNAME=test-only","TRADING_DB_PASSWORD=test-only",
        "TRADING_FLYWAY_USERNAME=test-only","TRADING_FLYWAY_PASSWORD=test-only",
        "TRADING_HTTP_ALLOWED_ORIGINS=https://app.test","TRADING_WS_ALLOWED_ORIGINS=https://app.test"})
@ActiveProfiles("prod") @AutoConfigureMockMvc @Import(PostgresTestConfiguration.class)
class ProdProfileSecurityTests {
    @DynamicPropertySource static void memberKeys(DynamicPropertyRegistry registry) {
        // Same disposable test issuer/key as the member-contract test; no real signing material.
        MemberJwtIntegrationTests.jwtSettings(registry);
    }
    @Autowired MockMvc mvc;
    @Autowired Environment environment;
    @Test void productionBlocksSwaggerButRetainsOnlyExistingPublicBusinessRoutes() throws Exception {
        mvc.perform(get("/v3/api-docs")).andExpect(status().isForbidden());
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/symbols")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/trading/account/events")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components").doesNotExist());
        assertThat(environment.getProperty("server.forward-headers-strategy")).isEqualTo("framework");
        assertThat(environment.getProperty("management.endpoint.health.show-details")).isEqualTo("never");
        assertThat(environment.getProperty("trading.ops.alert-cooldown-seconds")).isEqualTo("300");
    }
}
