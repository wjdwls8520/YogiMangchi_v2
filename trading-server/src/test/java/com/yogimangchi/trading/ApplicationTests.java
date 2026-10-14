package com.yogimangchi.trading;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
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

    @Autowired private ObjectMapper mapper;

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
    void runtimeOpenApiPreservesTradingContractsAndDocumentsPublicMarketSummary() throws Exception {
        String actual = mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        var api = mapper.readTree(actual);
        var paths = api.path("paths");
        for (String path : List.of("/api/v1/symbols", "/api/v1/trading/status", "/api/v1/trading/accounts/guest",
                "/api/v1/trading/account/orders", "/api/v1/trading/account/orders/pending",
                "/api/v1/trading/account/orders/{orderId}/cancel", "/api/v1/trading/account/positions",
                "/api/v1/trading/account/positions/{positionId}/close", "/api/v1/trading/account/positions/{positionId}/close-orders",
                "/api/v1/trading/account/wallet", "/api/v1/trading/account/summary")) {
            assertThat(paths.has(path)).as(path).isTrue();
        }
        assertThat(paths.path("/api/v1/trading/account/orders").path("post").path("security").isEmpty()).isFalse();
        var operation = paths.path("/api/v1/market/tickers").path("get");
        assertThat(operation.path("security").isEmpty()).isTrue();
        var schema = operation.path("responses").path("200").path("content").path("application/json").path("schema");
        assertThat(schema.path("type").asText()).isEqualTo("array");
        assertThat(schema.path("items").path("$ref").asText()).endsWith("/MarketSummaryResponse");
        var properties = api.path("components").path("schemas").path("MarketSummaryResponse").path("properties");
        var fields = new HashSet<String>();
        properties.fieldNames().forEachRemaining(fields::add);
        assertThat(fields).containsExactlyInAnyOrder("tradingSymbolId", "symbol", "quoteAsset", "markPrice",
                "changePercent24h", "highPrice24h", "lowPrice24h", "quoteVolume24h", "status", "updatedAt");
        for (String field : List.of("markPrice", "changePercent24h", "highPrice24h", "lowPrice24h", "quoteVolume24h")) {
            assertThat((Iterable<com.fasterxml.jackson.databind.JsonNode>) properties.path(field).path("type"))
                    .as(field).extracting(com.fasterxml.jackson.databind.JsonNode::asText)
                    .containsExactlyInAnyOrder("string", "null");
        }
        assertThat(properties.path("tradingSymbolId").path("type").asText()).isEqualTo("integer");
        assertThat(properties.path("updatedAt").path("format").asText()).isEqualTo("date-time");
        assertThat(properties.path("status").path("enum").toString()).contains("FRESH", "STALE", "UNAVAILABLE");
    }

    @Test
    void generatedOpenApiDescribesGuestReadContract() throws Exception {
        String actual = mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        var document = mapper.readTree(actual);
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
