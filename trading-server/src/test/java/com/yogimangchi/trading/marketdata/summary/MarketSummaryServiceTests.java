package com.yogimangchi.trading.marketdata.summary;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.MarketDataEvent;
import com.yogimangchi.trading.marketdata.ticker.MarketTicker;
import com.yogimangchi.trading.tradingsymbol.dto.TradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.service.TradingSymbolService;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class MarketSummaryServiceTests {
    private final Instant now = Instant.parse("2026-10-13T09:00:00Z");
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private final TradingSymbolService symbols = mock(TradingSymbolService.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked") private final ValueOperations<String, String> values = mock(ValueOperations.class);
    private final MarketSummaryService service = new MarketSummaryService(symbols, redis, mapper, Clock.fixed(now, ZoneOffset.UTC));

    @BeforeEach void setup() {
        when(symbols.findActiveSymbols()).thenReturn(List.of(new TradingSymbolResponse(91L, "PEPE", "Pepe", "USDT"),
                new TradingSymbolResponse(42L, "BTC", "Bitcoin", "USDT")));
        when(redis.opsForValue()).thenReturn(values);
    }

    @Test void combinesSharedSnapshotsWithoutProviderLeakageUsingOneReadAndExactStrings() throws Exception {
        respond(mark(91, now), "FRESH", ticker(91, now.minusSeconds(1)), null, null, null);
        var response = service.findActiveTickers();
        var pepe = response.get(0);
        assertThat(pepe.tradingSymbolId()).isEqualTo(91);
        assertThat(pepe.symbol()).isEqualTo("PEPE");
        assertThat(pepe.status().name()).isEqualTo("FRESH");
        assertThat(pepe.updatedAt()).isEqualTo(now.minusSeconds(1));
        var json = mapper.readTree(mapper.writeValueAsString(pepe));
        for (String field : List.of("markPrice", "changePercent24h", "highPrice24h", "lowPrice24h", "quoteVolume24h")) {
            assertThat(json.path(field).isTextual()).isTrue();
        }
        assertThat(json.path("tradingSymbolId").isIntegralNumber()).isTrue();
        assertThat(pepe.markPrice()).isEqualTo("0.000009800000000000000000123");
        assertThat(pepe.quoteVolume24h()).isEqualTo("1234567890.12");
        assertThat(mapper.writeValueAsString(pepe)).doesNotContain("provider", "1000PEPE", "lastPrice");
        assertThat(response.get(1).status().name()).isEqualTo("UNAVAILABLE");
        verify(values).multiGet(List.of("trading:market:v1:snapshot:91", "trading:market:v1:state:91", "trading:market:v1:ticker:91",
                "trading:market:v1:snapshot:42", "trading:market:v1:state:42", "trading:market:v1:ticker:42"));
    }

    @Test void missingMarkKeepsFreshTickerAndMissingTickerKeepsFreshMark() throws Exception {
        respond(null, null, ticker(91, now), mark(42, now), "FRESH", null);
        var response = service.findActiveTickers();
        assertThat(response.get(0).markPrice()).isNull();
        assertThat(response.get(0).highPrice24h()).isEqualTo("0.0000123");
        assertThat(response.get(1).markPrice()).isNotNull();
        assertThat(response.get(1).quoteVolume24h()).isNull();
        assertThat(response).allSatisfy(r -> assertThat(r.status().name()).isEqualTo("UNAVAILABLE"));
    }

    @Test void staleTickerNeverReturnsOldStatisticsButKeepsFreshMark() throws Exception {
        respond(mark(91, now), "FRESH", ticker(91, now.minusSeconds(10)), null, null, null);
        var response = service.findActiveTickers().get(0);
        assertThat(response.status().name()).isEqualTo("STALE");
        assertThat(response.highPrice24h()).isNull();
        assertThat(response.changePercent24h()).isNull();
        assertThat(response.markPrice()).isNotNull();
        assertThat(response.updatedAt()).isEqualTo(now);
    }

    @Test void staleMarkAndNonFreshStateCannotBeDisplayedAsCurrent() throws Exception {
        respond(mark(91, now.minusSeconds(5)), "FRESH", ticker(91, now), mark(42, now), "RECONNECTING", ticker(42, now));
        var response = service.findActiveTickers();
        assertThat(response.get(0).status().name()).isEqualTo("STALE");
        assertThat(response.get(1).status().name()).isEqualTo("UNAVAILABLE");
        assertThat(response).allSatisfy(r -> assertThat(r.markPrice()).isNull());
    }

    @Test void corruptOrWrongIdentityAffectsOnlyItsComponent() throws Exception {
        respond("{invalid", "FRESH", ticker(42, now), mark(42, now), "FRESH", ticker(42, now));
        var response = service.findActiveTickers();
        assertThat(response.get(0).updatedAt()).isNull();
        assertThat(response.get(0).markPrice()).isNull();
        assertThat(response.get(0).highPrice24h()).isNull();
        assertThat(response.get(1).status().name()).isEqualTo("FRESH");
        respond(mark(42, now), "FRESH", "{bad", null, null, null);
        assertThat(service.findActiveTickers().get(0).markPrice()).isNull();
    }

    @Test void redisFailureKeepsEntireActiveListWithNullsAndNoLocalFallback() throws Exception {
        when(values.multiGet(any())).thenThrow(new RedisConnectionFailureException("offline"));
        var response = service.findActiveTickers();
        assertThat(response).hasSize(2).allSatisfy(r -> {
            assertThat(r.status().name()).isEqualTo("UNAVAILABLE");
            assertThat(r.markPrice()).isNull(); assertThat(r.changePercent24h()).isNull(); assertThat(r.updatedAt()).isNull();
        });
        assertThat(mapper.readTree(mapper.writeValueAsString(response.get(0))).get("markPrice").isNull()).isTrue();
    }

    @Test void emptyActiveListDoesNotReadRedis() {
        when(symbols.findActiveSymbols()).thenReturn(List.of());
        assertThat(service.findActiveTickers()).isEmpty();
        verifyNoInteractions(values);
    }

    private void respond(String... snapshots) { when(values.multiGet(any())).thenReturn(Arrays.asList(snapshots)); }
    private String mark(long id, Instant event) throws Exception {
        return mapper.writeValueAsString(MarketDataEvent.price(new LatestMarkPrice(id,
                new BigDecimal("0.000009800000000000000000123"), event, now)));
    }
    private String ticker(long id, Instant event) throws Exception {
        return mapper.writeValueAsString(new MarketTicker(id, new BigDecimal("2.37"), new BigDecimal("0.0000123"),
                new BigDecimal("0.0000091"), new BigDecimal("1234567890.12"), event, now));
    }
}
