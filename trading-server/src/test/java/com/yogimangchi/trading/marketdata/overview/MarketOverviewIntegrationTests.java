package com.yogimangchi.trading.marketdata.overview;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.MarketDataEvent;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.marketdata.ticker.MarketTicker;
import com.yogimangchi.trading.marketdata.ticker.RedisTickerStore;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;
import com.yogimangchi.trading.tradingsymbol.service.TradingSymbolService;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "binance.mark-price.enabled=false",
        "binance.order-book.enabled=false",
        "marketdata.overview.enabled=false"
})
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
@Transactional
class MarketOverviewIntegrationTests {

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private EntityManager em;
    @Autowired private StringRedisTemplate redis;
    @Autowired private RedisMarketOverviewStore store;
    @Autowired private TradingSymbolService symbols;

    private long btcSymbolId;

    @AfterEach
    void cleanupRedisKeys() {
        redis.delete(RedisMarketOverviewStore.OVERVIEW_KEY);
        if (btcSymbolId > 0) {
            redis.delete(List.of(
                    RedisMarketDataBridge.snapshotKey(btcSymbolId),
                    RedisMarketDataBridge.stateKey(btcSymbolId),
                    RedisTickerStore.snapshotKey(btcSymbolId)
            ));
        }
    }

    @Test
    void returnsUnavailableFallbackWhenRedisEmptyAndForbidsPost() throws Exception {
        redis.delete(RedisMarketOverviewStore.OVERVIEW_KEY);

        mvc.perform(get("/api/v1/market/overview"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.usdKrwRate").value("1384.50"))
                .andExpect(jsonPath("$.usdKrwHistory.length()").value(14))
                .andExpect(jsonPath("$.updatedAt").isEmpty());

        mvc.perform(post("/api/v1/market/overview"))
                .andExpect(status().isForbidden());
    }

    @Test
    void collectorWritesRealTimeOverviewIntoRedisAndServiceOverlaysLiveBtcMarkPrice() throws Exception {
        TradingSymbol btc = em.createQuery("from TradingSymbol where symbol = 'BTC'", TradingSymbol.class)
                .getSingleResult();
        btcSymbolId = btc.getId();
        Instant now = Instant.now();

        // 1. Seed sub-second live BTC Mark Price ($75,000) & 24h Ticker (-2.00%) in shared Redis
        redis.opsForValue().set(
                RedisMarketDataBridge.snapshotKey(btcSymbolId),
                mapper.writeValueAsString(MarketDataEvent.price(
                        new LatestMarkPrice(btcSymbolId, new BigDecimal("75000.00"), now, now)
                )),
                Duration.ofSeconds(5)
        );
        redis.opsForValue().set(RedisMarketDataBridge.stateKey(btcSymbolId), "FRESH", Duration.ofSeconds(5));
        redis.opsForValue().set(
                RedisTickerStore.snapshotKey(btcSymbolId),
                mapper.writeValueAsString(new MarketTicker(
                        btcSymbolId,
                        new BigDecimal("-2.00"),
                        new BigDecimal("77000.00"),
                        new BigDecimal("73500.00"),
                        new BigDecimal("980000000.00"),
                        now,
                        now
                )),
                Duration.ofSeconds(10)
        );

        Map<URI, String> mockedResponses = Map.of(
                MarketOverviewCollector.YAHOO_KRW_URI, """
                        {"chart":{"result":[{"meta":{"regularMarketPrice":1344.20,"chartPreviousClose":1340.50,"fulldayChange":3.70,"fulldayChangePercent":0.28},
                        "indicators":{"quote":[{"close":[1325.1,1326.0,1328.4,1331.2,1333.5,1330.8,1334.0,1336.5,1338.1,1339.9,1342.0,1341.2,1340.5,1344.2]}]}}]}}
                        """,
                MarketOverviewCollector.UPBIT_BTC_KRW_URI, """
                        [{"market":"KRW-BTC","trade_price":102091990.0}]
                        """,
                MarketOverviewCollector.COINGECKO_GLOBAL_URI, """
                        {"data":{"market_cap_percentage":{"btc":59.74},"market_cap_change_percentage_24h_usd":-3.50}}
                        """,
                MarketOverviewCollector.COINGECKO_DERIVATIVES_URI, """
                        [{"id":"binance_futures","open_interest_btc":400000.0}]
                        """,
                MarketOverviewCollector.ALTERNATIVE_FNG_URI, """
                        {"data":[{"value":"32","value_classification":"Fear"}]}
                        """,
                MarketOverviewCollector.BINANCE_TAKER_RATIO_URI, """
                        [{"buyVol":"310.0","sellVol":"190.0","buySellRatio":"1.6316"}]
                        """
        );

        ScheduledExecutorService exec = Executors.newSingleThreadScheduledExecutor();
        try {
            MarketOverviewCollector collector = new MarketOverviewCollector(
                    symbols,
                    redis,
                    store,
                    mapper,
                    uri -> Optional.ofNullable(mockedResponses.get(uri)),
                    exec,
                    Clock.systemUTC(),
                    5000L
            );
            collector.collectOnce();

            // Verify snapshot persisted in shared Redis
            String rawRedisJson = redis.opsForValue().get(RedisMarketOverviewStore.OVERVIEW_KEY);
            assertThat(rawRedisJson).isNotBlank();

            // 102,091,990 / (75,000 * 1,344.20 = 100,815,000) - 1 = +1.27%
            // 400,000 BTC * $75,000 = $30.0B
            mvc.perform(get("/api/v1/market/overview"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("FRESH"))
                    .andExpect(jsonPath("$.btcDominancePercent").value("59.7"))
                    .andExpect(jsonPath("$.kimchiPremiumPercent").value("1.27"))
                    .andExpect(jsonPath("$.openInterestBillionsUsd").value("30.0"))
                    .andExpect(jsonPath("$.fearGreedValue").value(32))
                    .andExpect(jsonPath("$.fearGreedLabelKr").value("공포"))
                    .andExpect(jsonPath("$.futuresBullPct").value(62))
                    .andExpect(jsonPath("$.futuresBearPct").value(38))
                    .andExpect(jsonPath("$.btcChange24h").value("-2.00"))
                    .andExpect(jsonPath("$.usdKrwRate").value("1344.20"))
                    .andExpect(jsonPath("$.usdKrwChangeAmount").value("3.70"))
                    .andExpect(jsonPath("$.usdKrwChangePct").value("0.28"))
                    .andExpect(jsonPath("$.usdKrwHistory.length()").value(14))
                    .andExpect(jsonPath("$.usdKrwHistory[13]").value("1344.20"));

            // 2. When live BTC Mark Price in Redis moves sub-second to $76,000, GET /api/v1/market/overview immediately reflects new Kimchi Premium & OI!
            Instant nextNow = Instant.now();
            redis.opsForValue().set(
                    RedisMarketDataBridge.snapshotKey(btcSymbolId),
                    mapper.writeValueAsString(MarketDataEvent.price(
                            new LatestMarkPrice(btcSymbolId, new BigDecimal("76000.00"), nextNow, nextNow)
                    )),
                    Duration.ofSeconds(5)
            );

            // 102,091,990 / (76,000 * 1,344.20 = 102,159,200) - 1 = -0.07%
            // 400,000 BTC * $76,000 = $30.4B
            mvc.perform(get("/api/v1/market/overview"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("FRESH"))
                    .andExpect(jsonPath("$.kimchiPremiumPercent").value("-0.07"))
                    .andExpect(jsonPath("$.openInterestBillionsUsd").value("30.4"));
        } finally {
            exec.shutdownNow();
        }
    }
}
