package com.yogimangchi.trading.binance.candle;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.marketdata.candle.*;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;
import jakarta.persistence.EntityManager;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = "binance.mark-price.enabled=false")
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
@Transactional
class CandleIntegrationTests {
    @Autowired MockMvc mvc;
    @Autowired EntityManager em;
    @Autowired ObjectMapper mapper;
    @Autowired BinanceCandleTargetLoader loader;
    @Autowired RedisCandleCache cache;
    @Autowired StringRedisTemplate redis;
    @MockitoBean BinanceCandleClient provider;
    private final Set<String> keys = new HashSet<>();

    @BeforeEach void setup() {
        when(provider.load(any(), any())).thenAnswer(call -> {
            BinanceSubscriptionTarget target = call.getArgument(0);
            CandleInterval interval = call.getArgument(1);
            keys.add(RedisCandleCache.key(target, interval));
            return new BinanceCandleParser(mapper).parse("[" + BinanceCandleParserTests.row(BinanceCandleParserTests.OPEN, interval.millis()) + "]", target, interval);
        });
    }
    @AfterEach void cleanupOwnKeys() { if (!keys.isEmpty()) redis.delete(keys); }

    @Test void dbMappingIsNormalizedAndSharedCacheAvoidsAnotherProviderCall() throws Exception {
        var symbol = find("PEPE");
        mvc.perform(get("/api/v1/market/candles").param("tradingSymbolId", symbol.getId().toString()).param("interval", "24h"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].open").value("0.0000123"))
                .andExpect(jsonPath("$[0].closeTime").value("2026-10-15T23:59:59.999Z"));
        var target = loader.load(symbol.getId());
        assertThat(target.providerSymbol()).isEqualTo("1000PEPEUSDT");
        assertThat(target.providerUnitMultiplier()).isEqualTo(1000);
        var anotherNode = new CandleService(loader, provider, new RedisCandleCache(redis, mapper));
        assertThat(anotherNode.find(symbol.getId(), "24h", 1).get(0).close()).isEqualTo("0.0000145");
        verify(provider, times(1)).load(target, CandleInterval.ONE_DAY);
    }
    @Test void cachedPricesNeverBypassInactiveOrMissingSymbolChecks() throws Exception {
        var symbol = find("BTC");
        mvc.perform(get("/api/v1/market/candles").param("tradingSymbolId", symbol.getId().toString()).param("interval", "1m")).andExpect(status().isOk());
        symbol.deactivate(); em.flush();
        mvc.perform(get("/api/v1/market/candles").param("tradingSymbolId", symbol.getId().toString()).param("interval", "1m"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SYMBOL_NOT_AVAILABLE"));
        mvc.perform(get("/api/v1/market/candles").param("tradingSymbolId", Long.toString(Long.MAX_VALUE)).param("interval", "1m"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("TRADING_SYMBOL_NOT_FOUND"));
        verify(provider, times(1)).load(any(), any());
    }
    private TradingSymbol find(String symbol) {
        return em.createQuery("from TradingSymbol where symbol = :symbol", TradingSymbol.class).setParameter("symbol", symbol).getSingleResult();
    }
}
