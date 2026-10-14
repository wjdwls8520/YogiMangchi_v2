package com.yogimangchi.trading;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.context.ApplicationContext;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = "binance.mark-price.enabled=false")
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
class ApplicationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ApplicationContext context;

    @Test
    void defaultUserIsNotGenerated() {
        assertThat(context.getBeansOfType(UserDetailsService.class)).isEmpty();
    }

    @Test
    void externalBinanceConnectionIsDisabledInAutomatedTests() {
        assertThat(context.getBeansOfType(
                com.yogimangchi.trading.binance.markprice.BinanceMarkPriceClient.class)).isEmpty();
    }

    @Test
    void openApiAndSwaggerAreAvailable() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openapi").exists());
        mockMvc.perform(get("/swagger-ui/index.html"))
                .andExpect(status().isOk());
    }

    @Test
    void generatedOpenApiDescribesGuestReadContract() throws Exception {
        String actual = mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        var document = new ObjectMapper().readTree(actual);
        var paths = document.path("paths");
        var schemas = document.path("components").path("schemas");
        var guest = paths.path("/api/v1/trading/accounts/guest").path("post");
        assertThat(guest.path("security").isMissingNode() || guest.path("security").isEmpty()).isTrue();
        assertThat(guest.at("/responses/201/content/application~1json/schema/$ref").asText())
                .isEqualTo("#/components/schemas/GuestAccountResponse");
        for (String endpoint : new String[]{"summary", "wallet", "positions", "orders", "orders/pending"}) {
            var operation = paths.path("/api/v1/trading/account/" + endpoint).path("get");
            assertThat(operation.path("responses").has("200")).as(endpoint).isTrue();
            assertThat(operation.at("/security/0/guestBearer").isArray()).as(endpoint).isTrue();
        }
        assertThat(document.at("/components/securitySchemes/guestBearer/scheme").asText()).isEqualTo("bearer");
        assertThat(schemas.at("/AccountSummaryResponse/properties/wallet/$ref").asText())
                .isEqualTo("#/components/schemas/WalletResponse");
        assertThat(schemas.at("/AccountSummaryResponse/properties/positions/items/$ref").asText())
                .isEqualTo("#/components/schemas/PositionResponse");
        for (String field : new String[]{"balance", "usedMargin", "reservedMargin", "realizedPnl", "unrealizedPnl", "equity", "availableBalance"}) {
            assertThat(schemas.at("/WalletResponse/properties/" + field + "/type").asText()).as(field).isEqualTo("string");
        }
        assertThat(paths.path("/api/v1/trading/account/orders").path("get").path("parameters").toString())
                .contains("beforeId", "limit");
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/orders", "/login", "/logout"})
    void applicationRequestsAreDeniedWithoutLoginEndpoints(String path) throws Exception {
        mockMvc.perform(get(path)).andExpect(status().isForbidden());
    }
}
