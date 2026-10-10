package com.yogimangchi.trading.tradingsymbol;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolProvider;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import jakarta.persistence.EntityManager;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "binance.mark-price.enabled=false")
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
@Transactional
class TradingSymbolIntegrationTests {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private EntityManager entityManager;
    @Autowired private Flyway flyway;

    @Test
    void migrationSeedsExactlyTwelveVerifiedMappings() {
        Map<String, String> expected = Map.ofEntries(
                Map.entry("BTC", "BTCUSDT"), Map.entry("ETH", "ETHUSDT"),
                Map.entry("XRP", "XRPUSDT"), Map.entry("BNB", "BNBUSDT"),
                Map.entry("SOL", "SOLUSDT"), Map.entry("ADA", "ADAUSDT"),
                Map.entry("LINK", "LINKUSDT"), Map.entry("AVAX", "AVAXUSDT"),
                Map.entry("SUI", "SUIUSDT"), Map.entry("DOGE", "DOGEUSDT"),
                Map.entry("PEPE", "1000PEPEUSDT"), Map.entry("SHIB", "1000SHIBUSDT"));

        var symbols = entityManager.createQuery("from TradingSymbol", TradingSymbol.class).getResultList();
        assertThat(symbols).hasSize(12);
        assertThat(symbols).extracting(TradingSymbol::getId).doesNotHaveDuplicates().doesNotContainNull();
        assertThat(symbols).allSatisfy(symbol -> {
            assertThat(symbol.getId()).isPositive();
            assertThat(symbol.getProviderSymbol()).isEqualTo(expected.get(symbol.getSymbol()));
            assertThat(symbol.getQuoteAsset()).isEqualTo("USDT");
            assertThat(symbol.getProvider()).isEqualTo(TradingSymbolProvider.BINANCE);
            assertThat(symbol.getStatus()).isEqualTo(TradingSymbolStatus.ACTIVE);
            assertThat(symbol.getProviderUnitMultiplier()).isEqualTo(
                    Set.of("PEPE", "SHIB").contains(symbol.getSymbol()) ? 1000L : 1L);
        });
        assertThat(jdbc.queryForList("select version from trading.flyway_schema_history where type = 'SQL' order by installed_rank", String.class))
                .containsExactly("1", "2", "3", "4", "5", "6");
    }

    @Test
    void anonymousApiReturnsOnlyPublicFieldsInStableOrder() throws Exception {
        String body = mockMvc.perform(get("/api/v1/symbols"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(12))
                .andReturn().getResponse().getContentAsString();
        JsonNode symbols = objectMapper.readTree(body);
        for (JsonNode symbol : symbols) {
            Set<String> fields = new HashSet<>();
            symbol.fieldNames().forEachRemaining(fields::add);
            assertThat(fields).containsExactlyInAnyOrder("id", "symbol", "name", "quoteAsset", "displaySymbol");
            assertThat(symbol.get("displaySymbol").asText()).isEqualTo(symbol.get("symbol").asText() + " / USDT");
        }
        assertThat(symbols.findValuesAsText("symbol")).containsExactly(
                "ADA", "AVAX", "BNB", "BTC", "DOGE", "ETH", "LINK", "PEPE", "SHIB", "SOL", "SUI", "XRP");
    }

    @Test
    void inactivationHidesSymbolWithoutDeletingItsIdentity() throws Exception {
        TradingSymbol symbol = findSymbol("BTC");
        Long id = symbol.getId();
        symbol.deactivate();
        entityManager.flush();
        entityManager.clear();

        mockMvc.perform(get("/api/v1/symbols"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(11))
                .andExpect(jsonPath("$[?(@.symbol == 'BTC')]").isEmpty());
        assertThat(entityManager.find(TradingSymbol.class, id).getStatus()).isEqualTo(TradingSymbolStatus.INACTIVE);
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_symbol", Long.class)).isEqualTo(12);
    }

    @Test
    void providerMappingChangeKeepsInternalIdAndPublicSymbol() throws Exception {
        TradingSymbol symbol = findSymbol("PEPE");
        Long id = symbol.getId();
        symbol.changeProviderMapping("TESTPEPEUSDT", 1L);
        entityManager.flush();
        entityManager.clear();

        TradingSymbol reloaded = entityManager.find(TradingSymbol.class, id);
        assertThat(reloaded.getSymbol()).isEqualTo("PEPE");
        assertThat(reloaded.getProviderSymbol()).isEqualTo("TESTPEPEUSDT");
        assertThat(reloaded.getProviderUnitMultiplier()).isEqualTo(1L);
        mockMvc.perform(get("/api/v1/symbols"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.symbol == 'PEPE')].id").value(org.hamcrest.Matchers.contains(id.intValue())))
                .andExpect(jsonPath("$[*].providerSymbol").doesNotExist());
    }

    @Test
    void registeredSymbolIsInactiveUntilActivatedAndListIsDbManaged() throws Exception {
        TradingSymbol symbol = TradingSymbol.register("Test Coin", "TEST", "USDT", TradingSymbolProvider.BINANCE, "TESTUSDT", 1L);
        entityManager.persist(symbol);
        entityManager.flush();
        assertThat(symbol.getId()).isPositive();
        assertThat(symbol.getStatus()).isEqualTo(TradingSymbolStatus.INACTIVE);
        mockMvc.perform(get("/api/v1/symbols")).andExpect(jsonPath("$.length()").value(12));

        symbol.activate();
        entityManager.flush();
        mockMvc.perform(get("/api/v1/symbols"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(13))
                .andExpect(jsonPath("$[?(@.symbol == 'TEST')].displaySymbol").value(org.hamcrest.Matchers.contains("TEST / USDT")));
    }

    @Test
    void noActiveSymbolsReturnsEmptyArray() throws Exception {
        jdbc.update("update trading.trading_symbol set status = 'INACTIVE'");
        mockMvc.perform(get("/api/v1/symbols"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "('Duplicate pair', 'BTC', 'USDT', 'BINANCE', 'NEWBTCUSDT', 'ACTIVE')",
            "('Duplicate provider', 'NEWBTC', 'USDT', 'BINANCE', 'BTCUSDT', 'ACTIVE')",
            "('Invalid quote', 'TEST', 'USDC', 'BINANCE', 'TESTUSDC', 'ACTIVE')",
            "('Invalid status', 'TEST', 'USDT', 'BINANCE', 'TESTUSDT', 'DELETED')"
    })
    void databaseRejectsInvalidOrDuplicateSymbolData(String values) {
        assertThatThrownBy(() -> jdbc.update("insert into trading.trading_symbol (name, symbol, quote_asset, provider, provider_symbol, status, provider_unit_multiplier) values " + values.replace(")", ", 1)")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @ParameterizedTest
    @ValueSource(longs = {0, -1, 3})
    void invalidMappingCannotPartiallyChangeProviderSymbol(long multiplier) {
        TradingSymbol pepe = findSymbol("PEPE");
        assertThatThrownBy(() -> pepe.changeProviderMapping("NEWPEPEUSDT", multiplier))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(pepe.getProviderSymbol()).isEqualTo("1000PEPEUSDT");
        assertThat(pepe.getProviderUnitMultiplier()).isEqualTo(1000L);
    }

    @ParameterizedTest
    @ValueSource(longs = {0, -1})
    void databaseRejectsNonPositiveMultiplier(long multiplier) {
        assertThatThrownBy(() -> jdbc.update(
                "update trading.trading_symbol set provider_unit_multiplier = ? where symbol = 'BTC'", multiplier))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void reapplyingMigrationDoesNotDuplicateSeedsOrResetOperationalChanges() {
        Long id = jdbc.queryForObject("select id from trading.trading_symbol where symbol = 'PEPE'", Long.class);
        try {
            jdbc.update("update trading.trading_symbol set status = 'INACTIVE', provider_symbol = 'TESTPEPEUSDT' where id = ?", id);
            assertThat(flyway.migrate().migrationsExecuted).isZero();
            assertThat(jdbc.queryForObject("select count(*) from trading.trading_symbol", Long.class)).isEqualTo(12);
            assertThat(jdbc.queryForMap("select symbol, status, provider_symbol from trading.trading_symbol where id = ?", id))
                    .containsEntry("symbol", "PEPE")
                    .containsEntry("status", "INACTIVE")
                    .containsEntry("provider_symbol", "TESTPEPEUSDT");
        } finally {
            jdbc.update("update trading.trading_symbol set status = 'ACTIVE', provider_symbol = '1000PEPEUSDT' where id = ?", id);
        }
    }

    private TradingSymbol findSymbol(String symbol) {
        return entityManager.createQuery("from TradingSymbol where symbol = :symbol", TradingSymbol.class)
                .setParameter("symbol", symbol).getSingleResult();
    }
}
