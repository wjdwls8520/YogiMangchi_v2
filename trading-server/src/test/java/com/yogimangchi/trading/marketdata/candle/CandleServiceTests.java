package com.yogimangchi.trading.marketdata.candle;

import com.yogimangchi.trading.binance.candle.BinanceCandleClient;
import com.yogimangchi.trading.binance.candle.BinanceCandleTargetLoader;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.ArrayList;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class CandleServiceTests {
    private final BinanceCandleTargetLoader targets = mock(BinanceCandleTargetLoader.class);
    private final BinanceCandleClient provider = mock(BinanceCandleClient.class);
    private final RedisCandleCache cache = mock(RedisCandleCache.class);
    private final CandleService service = new CandleService(targets, provider, cache);
    private final BinanceSubscriptionTarget target = new BinanceSubscriptionTarget(1L, "BTC", "BTCUSDT", 1L);
    private final List<CandleResponse> rows = List.of(candle(0), candle(1), candle(2));

    @BeforeEach void setup() {
        when(targets.load(1)).thenReturn(target);
        when(cache.read(anyString(), any())).thenReturn(Optional.empty());
        when(provider.load(target, CandleInterval.ONE_MINUTE)).thenReturn(rows);
    }

    @ParameterizedTest @CsvSource({"0,1m,300", "1,10m,300", "1,1d,300", "1,1m,0", "1,1m,501"})
    void validationPrecedesDbCacheAndProvider(long id, String interval, int limit) {
        assertThatThrownBy(() -> service.find(id, interval, limit)).isInstanceOfSatisfying(BusinessException.class,
                failure -> assertThat(failure.getCode()).isEqualTo(ErrorCode.INVALID_CANDLE_REQUEST));
        verifyNoInteractions(targets, cache, provider);
    }
    @Test void cacheHitUsesLatestRequestedTailAndNeverCallsProvider() {
        when(cache.read(anyString(), any())).thenReturn(Optional.of(rows));
        assertThat(service.find(1, "1m", 2)).containsExactly(rows.get(1), rows.get(2));
        verify(targets).load(1); verifyNoInteractions(provider);
    }
    @Test void concurrentDifferentLimitsShareOneProviderRequest() throws Exception {
        var release = new CountDownLatch(1);
        var barrier = new CyclicBarrier(8);
        when(targets.load(1)).thenAnswer(call -> { barrier.await(2, TimeUnit.SECONDS); return target; });
        when(provider.load(target, CandleInterval.ONE_MINUTE)).thenAnswer(call -> { release.await(2, TimeUnit.SECONDS); return rows; });
        var pool = Executors.newFixedThreadPool(8);
        var futures = new ArrayList<Future<List<CandleResponse>>>();
        try {
            for (int i = 0; i < 8; i++) {
                int limit = i % 3 + 1;
                futures.add(pool.submit(() -> service.find(1, "1m", limit)));
            }
            await().during(Duration.ofMillis(100)).atMost(Duration.ofSeconds(1)).untilAsserted(() ->
                    verify(provider, times(1)).load(target, CandleInterval.ONE_MINUTE));
            release.countDown();
            for (int i = 0; i < 8; i++) assertThat(futures.get(i).get(2, TimeUnit.SECONDS)).hasSize(i % 3 + 1);
            verify(provider, times(1)).load(target, CandleInterval.ONE_MINUTE);
        } finally { release.countDown(); pool.shutdownNow(); }
    }
    @Test void failuresAreNotCachedAndLaterRequestsCanRecover() {
        when(provider.load(target, CandleInterval.ONE_MINUTE)).thenThrow(new BusinessException(ErrorCode.CANDLE_PROVIDER_FAILURE)).thenReturn(rows);
        assertThatThrownBy(() -> service.find(1, "1m", 300)).isInstanceOf(BusinessException.class);
        verify(cache, never()).write(any(), any(), any());
        assertThat(service.find(1, "1m", 300)).hasSize(3);
    }
    @Test void redisFailureDoesNotBecomeUncachedBinanceTraffic() {
        when(cache.read(anyString(), any())).thenThrow(new BusinessException(ErrorCode.CANDLE_UNAVAILABLE));
        assertThatThrownBy(() -> service.find(1, "1m", 300)).isInstanceOfSatisfying(BusinessException.class,
                failure -> assertThat(failure.getCode()).isEqualTo(ErrorCode.CANDLE_UNAVAILABLE));
        verifyNoInteractions(provider);
    }
    @Test void mappingAndUnitChangesHaveDifferentCacheIdentity() {
        String key = RedisCandleCache.key(target, CandleInterval.ONE_MINUTE);
        assertThat(RedisCandleCache.key(new BinanceSubscriptionTarget(1L, "BTC", "NEWBTCUSDT", 1), CandleInterval.ONE_MINUTE)).isNotEqualTo(key);
        assertThat(RedisCandleCache.key(new BinanceSubscriptionTarget(1L, "BTC", "BTCUSDT", 1000), CandleInterval.ONE_MINUTE)).isNotEqualTo(key);
    }
    static CandleResponse candle(int index) {
        Instant start = Instant.parse("2026-10-15T00:00:00Z").plusSeconds(index * 60L);
        return new CandleResponse(start, start.plusMillis(59999), "10.000000000000001", "12", "9", "11");
    }
}
