package com.yogimangchi.trading.marketdata.candle;

import com.yogimangchi.trading.binance.candle.BinanceCandleClient;
import com.yogimangchi.trading.binance.candle.BinanceCandleTargetLoader;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class CandlePaginationTests {
    private static final Instant NOW = Instant.parse("2026-10-15T00:10:30Z");
    private final BinanceSubscriptionTarget target = new BinanceSubscriptionTarget(1L, "BTC", "BTCUSDT", 1);
    private final BinanceCandleTargetLoader targets = mock(BinanceCandleTargetLoader.class);
    private final BinanceCandleClient provider = mock(BinanceCandleClient.class);
    private final RedisCandleCache cache = mock(RedisCandleCache.class);
    private final CandleService service = new CandleService(targets, provider, cache, Clock.fixed(NOW, ZoneOffset.UTC));

    @BeforeEach void setup() {
        when(targets.load(1)).thenReturn(target);
        when(cache.read(anyString(), any())).thenReturn(Optional.empty());
        when(cache.read(anyString(), any(), any())).thenReturn(Optional.empty());
    }

    @Test void latestThenOlderPagesAreAscendingWithoutAnyOverlap() {
        when(provider.load(target, CandleInterval.ONE_MINUTE)).thenReturn(rows(4, 5, 6));
        when(provider.load(target, CandleInterval.ONE_MINUTE, time(4))).thenReturn(rows(1, 2, 3, 4));
        when(provider.load(target, CandleInterval.ONE_MINUTE, time(1))).thenReturn(rows(0, 1));
        when(provider.load(target, CandleInterval.ONE_MINUTE, time(0))).thenReturn(List.of());

        var latest = service.find(1, "1m", 3);
        var older = service.find(1, "1m", 3, latest.get(0).openTime().toString());
        var oldest = service.find(1, "1m", 3, older.get(0).openTime().toString());
        assertThat(service.find(1, "1m", 3, oldest.get(0).openTime().toString())).isEmpty();
        assertThat(latest).containsExactlyElementsOf(rows(4, 5, 6));
        assertThat(older).containsExactlyElementsOf(rows(1, 2, 3));
        assertThat(oldest).containsExactlyElementsOf(rows(0));
        var combined = new ArrayList<CandleResponse>();
        combined.addAll(oldest); combined.addAll(older); combined.addAll(latest);
        assertThat(combined).extracting(CandleResponse::openTime).isSorted().doesNotHaveDuplicates();
        verify(provider, times(1)).load(target, CandleInterval.ONE_MINUTE, time(4));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "bad", "1760000000000", "2026-10-15", "2026-02-30T00:00:00Z",
            "1970-01-01T00:00:00Z", "1969-12-31T23:59:59Z", "9999-01-01T00:00:00Z",
            "2026-10-15T00:10:30.001Z", "2026-10-15T00:00:00.000001Z"})
    void invalidAndFutureCursorsFailBeforeDbCacheOrProvider(String before) {
        assertThatThrownBy(() -> service.find(1, "1m", 300, before)).isInstanceOfSatisfying(BusinessException.class,
                error -> assertThat(error.getCode()).isEqualTo(ErrorCode.INVALID_CANDLE_CURSOR));
        verifyNoInteractions(targets, cache, provider);
    }

    @Test void historicalCursorWithinCurrentBucketExcludesTheStillOpenCandle() {
        when(provider.load(target, CandleInterval.ONE_MINUTE, NOW)).thenReturn(rows(9, 10));
        assertThat(service.find(1, "1m", 300, NOW.toString())).containsExactlyElementsOf(rows(9));
        verify(cache).write(RedisCandleCache.key(target, CandleInterval.ONE_MINUTE, NOW), rows(9), NOW);
    }

    @Test void timestampOffsetsNormalizeToTheSameCacheIdentityAndDifferentLimitsShareThePage() {
        Instant before = time(3);
        String key = RedisCandleCache.key(target, CandleInterval.ONE_MINUTE, before);
        when(cache.read(key, CandleInterval.ONE_MINUTE, before)).thenReturn(Optional.of(rows(0, 1, 2)));
        assertThat(service.find(1, "1m", 1, "2026-10-15T09:03:00+09:00")).containsExactlyElementsOf(rows(2));
        assertThat(service.find(1, "1m", 3, before.toString())).containsExactlyElementsOf(rows(0, 1, 2));
        verify(cache, times(2)).read(key, CandleInterval.ONE_MINUTE, before);
        verifyNoInteractions(provider);
    }

    @Test void concurrentRequestsForOneHistoricalCursorShareOneProviderCall() throws Exception {
        Instant before = time(3);
        var release = new CountDownLatch(1);
        var barrier = new CyclicBarrier(8);
        when(targets.load(1)).thenAnswer(call -> { barrier.await(2, TimeUnit.SECONDS); return target; });
        when(provider.load(target, CandleInterval.ONE_MINUTE, before)).thenAnswer(call -> {
            release.await(2, TimeUnit.SECONDS); return rows(0, 1, 2);
        });
        var pool = Executors.newFixedThreadPool(8);
        var pending = new ArrayList<Future<List<CandleResponse>>>();
        try {
            for (int i = 0; i < 8; i++) {
                int limit = i % 3 + 1;
                pending.add(pool.submit(() -> service.find(1, "1m", limit, before.toString())));
            }
            await().during(Duration.ofMillis(100)).atMost(Duration.ofSeconds(1)).untilAsserted(() ->
                    verify(provider, times(1)).load(target, CandleInterval.ONE_MINUTE, before));
            release.countDown();
            for (int i = 0; i < pending.size(); i++) assertThat(pending.get(i).get(2, TimeUnit.SECONDS)).hasSize(i % 3 + 1);
            verify(provider, times(1)).load(target, CandleInterval.ONE_MINUTE, before);
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    private static Instant time(int index) { return CandleServiceTests.candle(index).openTime(); }
    private static List<CandleResponse> rows(int... indices) {
        return java.util.Arrays.stream(indices).mapToObj(CandleServiceTests::candle).toList();
    }
}
