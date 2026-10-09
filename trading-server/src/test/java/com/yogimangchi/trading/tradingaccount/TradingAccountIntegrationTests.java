package com.yogimangchi.trading.tradingaccount;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.security.GuestCredentials;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = "binance.mark-price.enabled=false")
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
@Transactional
class TradingAccountIntegrationTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager entities;
    @Autowired LatestPriceStore prices;

    @AfterEach
    void clearPriceAvailability() { prices.markUnavailable(); }

    @Test
    void guestCreationPersistsOnlyHashAndReturnsPrivateInitialWallet() throws Exception {
        JsonNode guest = guest();
        String token = guest.path("accessToken").asText();
        long id = guest.path("accountId").asLong();
        assertThat(token).matches("guest_[A-Za-z0-9_-]{43}");
        assertThat(jdbc.queryForObject("select credential_hash from trading.trading_account where id = ?", String.class, id))
                .isEqualTo(GuestCredentials.hash(token)).doesNotContain(token);
        assertThat(Instant.parse(guest.path("expiresAt").asText())).isAfter(Instant.now().plusSeconds(6 * 86400));
        mvc.perform(get("/api/v1/trading/account/summary").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.accountId").value(id))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.wallet.balance").value("10000.000000000000000000"))
                .andExpect(jsonPath("$.wallet.availableBalance").value("10000.000000000000000000"))
                .andExpect(jsonPath("$.wallet.reservedMargin").value("0.000000000000000000"))
                .andExpect(jsonPath("$.positions").isEmpty())
                .andExpect(jsonPath("$.credentialHash").doesNotExist())
                .andExpect(jsonPath("$.accessToken").doesNotExist());
    }

    @Test
    void missingForgedAndExpiredCredentialsAreRejectedWithoutSession() throws Exception {
        mvc.perform(get("/api/v1/trading/account/wallet"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("GUEST_CREDENTIAL_REQUIRED"));
        mvc.perform(get("/api/v1/trading/account/wallet").header("Authorization", "Bearer " + GuestCredentials.issue()))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("INVALID_GUEST_CREDENTIAL"));
        JsonNode guest = guest();
        jdbc.update("update trading.trading_account set credential_expires_at = now() - interval '1 second' where id = ?", guest.path("accountId").asLong());
        entities.clear();
        mvc.perform(get("/api/v1/trading/account/wallet").header("Authorization", "Bearer " + guest.path("accessToken").asText()))
                .andExpect(status().isUnauthorized()).andExpect(header().doesNotExist("Set-Cookie"));
    }

    @Test
    void callerCannotSelectAnotherAccountAndUnknownBusinessRoutesStayClosed() throws Exception {
        JsonNode first = guest();
        JsonNode other = guest();
        long symbolId = symbolId("BTC");
        Position position = Position.open(first.path("accountId").asLong(), symbolId, Position.Side.LONG,
                BigDecimal.ONE, new BigDecimal("100"), 10, Instant.now());
        entities.persist(position);
        entities.find(Wallet.class, first.path("accountId").asLong()).openMargin(position.getMargin());
        entities.flush();
        mvc.perform(get("/api/v1/trading/account/positions").param("accountId", first.path("accountId").asText())
                        .header("Authorization", "Bearer " + other.path("accessToken").asText()))
                .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        mvc.perform(get("/api/v1/trading/accounts/" + first.path("accountId").asLong())
                        .header("Authorization", "Bearer " + other.path("accessToken").asText()))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/trading/account/positions").header("Authorization", "Bearer " + first.path("accessToken").asText()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].accountId").doesNotExist());
    }

    @Test
    void unavailablePriceDoesNotTurnUnrealizedLossOrEquityIntoZero() throws Exception {
        JsonNode guest = guest();
        long id = guest.path("accountId").asLong();
        long symbolId = symbolId("PEPE");
        Position position = Position.open(id, symbolId, Position.Side.LONG, new BigDecimal("1000000"),
                new BigDecimal("0.00001"), 2, Instant.now());
        entities.persist(position);
        entities.find(Wallet.class, id).openMargin(position.getMargin());
        entities.flush();
        String auth = "Bearer " + guest.path("accessToken").asText();
        prices.beginSubscription(Set.of(symbolId));
        mvc.perform(get("/api/v1/trading/account/summary").header("Authorization", auth))
                .andExpect(jsonPath("$.wallet.valuationStatus").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.wallet.availableBalance").doesNotExist())
                .andExpect(jsonPath("$.wallet.equity").doesNotExist())
                .andExpect(jsonPath("$.positions[0].unrealizedPnl").doesNotExist());
        Instant now = Instant.now();
        assertThat(prices.update(new LatestMarkPrice(symbolId, new BigDecimal("0.000009"), now, now))).isTrue();
        mvc.perform(get("/api/v1/trading/account/summary").header("Authorization", auth))
                .andExpect(jsonPath("$.wallet.valuationStatus").value("FRESH"))
                .andExpect(jsonPath("$.wallet.unrealizedPnl").value("-1.000000000000000000"))
                .andExpect(jsonPath("$.wallet.equity").value("9999.000000000000000000"))
                .andExpect(jsonPath("$.wallet.availableBalance").value("9994.000000000000000000"));
        prices.markUnavailable();
        mvc.perform(get("/api/v1/trading/account/positions").header("Authorization", auth))
                .andExpect(jsonPath("$[0].priceStatus").value("UNAVAILABLE"))
                .andExpect(jsonPath("$[0].markPrice").doesNotExist());
    }

    @Test
    void corsAcceptsConfiguredReactOriginAndRejectsOthers() throws Exception {
        mvc.perform(options("/api/v1/trading/account/wallet").header("Origin", "http://localhost:5173")
                        .header("Access-Control-Request-Method", "GET").header("Access-Control-Request-Headers", "Authorization"))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
        mvc.perform(options("/api/v1/trading/account/wallet").header("Origin", "https://untrusted.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden());
    }

    @Test
    void postgresRejectsClosedPositionWithoutExitPrice() throws Exception {
        JsonNode guest = guest();
        Position position = Position.open(guest.path("accountId").asLong(), symbolId("BTC"), Position.Side.LONG,
                BigDecimal.ONE, new BigDecimal("100"), 10, Instant.now());
        entities.persist(position);
        entities.flush();
        assertThatThrownBy(() -> jdbc.update("update trading.position set status = 'CLOSED', closed_at = now(), exit_price = null where id = ?", position.getId()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private JsonNode guest() throws Exception {
        return json.readTree(mvc.perform(post("/api/v1/trading/accounts/guest"))
                .andExpect(status().isCreated()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().doesNotExist("Set-Cookie")).andReturn().getResponse().getContentAsString());
    }

    private long symbolId(String symbol) {
        return jdbc.queryForObject("select id from trading.trading_symbol where symbol = ?", Long.class, symbol);
    }
}
