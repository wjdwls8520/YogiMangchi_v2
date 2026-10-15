package com.yogimangchi.trading.marketdata.summary;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.MarketDataEvent;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.marketdata.ticker.MarketTicker;
import com.yogimangchi.trading.marketdata.ticker.RedisTickerStore;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"binance.mark-price.enabled=false", "binance.order-book.enabled=false"})
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
@Transactional
class MarketSummaryIntegrationTests {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private EntityManager em;
    @Autowired private StringRedisTemplate redis;
    private long writtenId;

    @AfterEach void clearOwnSnapshots() {
        if (writtenId > 0) redis.delete(List.of(RedisTickerStore.snapshotKey(writtenId),
                RedisMarketDataBridge.snapshotKey(writtenId), RedisMarketDataBridge.stateKey(writtenId)));
    }

    @Test void publicApiReturnsAllTwelveActiveIdentitiesEvenWithoutPrices() throws Exception {
        String json = mvc.perform(get("/api/v1/market/tickers")).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(12)).andReturn().getResponse().getContentAsString();
        var rows = mapper.readTree(json);
        for (var row : rows) {
            assertThat(row.path("tradingSymbolId").isIntegralNumber()).isTrue();
            assertThat(row.path("quoteAsset").asText()).isEqualTo("USDT");
            assertThat(row.path("status").asText()).isEqualTo("UNAVAILABLE");
            assertThat(row.get("markPrice").isNull()).isTrue();
            assertThat(row.get("updatedAt").isNull()).isTrue();
            assertThat(row.size()).isEqualTo(10);
        }
        assertThat(rows.findValuesAsText("symbol")).contains("BTC", "PEPE", "SHIB");
        mvc.perform(get("/api/v1/market/private")).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/market/tickers")).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/trading/account/wallet")).andExpect(status().isUnauthorized());
    }

    @Test void readsRealSharedRedisAndHidesInactiveSymbolsWithoutDeletingIdentity() throws Exception {
        var symbol = em.createQuery("from TradingSymbol where symbol = 'PEPE'", TradingSymbol.class).getSingleResult();
        writtenId = symbol.getId();
        Instant now = Instant.now();
        redis.opsForValue().set(RedisMarketDataBridge.snapshotKey(writtenId), mapper.writeValueAsString(
                MarketDataEvent.price(new LatestMarkPrice(writtenId, new BigDecimal("0.0000098"), now, now))), Duration.ofSeconds(5));
        redis.opsForValue().set(RedisMarketDataBridge.stateKey(writtenId), "FRESH", Duration.ofSeconds(5));
        redis.opsForValue().set(RedisTickerStore.snapshotKey(writtenId), mapper.writeValueAsString(
                new MarketTicker(writtenId, new BigDecimal("-2.37"), new BigDecimal("0.0000123"),
                        new BigDecimal("0.0000091"), new BigDecimal("1234567890.12"), now, now)), Duration.ofSeconds(10));
        mvc.perform(get("/api/v1/market/tickers"))
                .andExpect(jsonPath("$[?(@.symbol == 'PEPE')].status").value("FRESH"))
                .andExpect(jsonPath("$[?(@.symbol == 'PEPE')].markPrice").value("0.0000098"))
                .andExpect(jsonPath("$[?(@.symbol == 'PEPE')].quoteVolume24h").value("1234567890.12"));
        symbol.deactivate(); em.flush();
        mvc.perform(get("/api/v1/market/tickers")).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(11)).andExpect(jsonPath("$[?(@.symbol == 'PEPE')]").isEmpty());
        assertThat(em.find(TradingSymbol.class, writtenId).getStatus().name()).isEqualTo("INACTIVE");
    }
}
