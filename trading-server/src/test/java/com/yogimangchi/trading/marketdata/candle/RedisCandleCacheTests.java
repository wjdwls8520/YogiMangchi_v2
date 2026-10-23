package com.yogimangchi.trading.marketdata.candle;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.testcontainers.containers.GenericContainer;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class RedisCandleCacheTests {
    private static final GenericContainer<?> container = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private final String key = RedisCandleCache.key(new BinanceSubscriptionTarget(1L, "BTC", "BTCUSDT", 1), CandleInterval.ONE_MINUTE);
    private LettuceConnectionFactory connections;
    private StringRedisTemplate redis;
    private RedisCandleCache cache;
    @BeforeAll static void startRedis() { container.start(); }
    @AfterAll static void stopRedis() { container.stop(); }
    @BeforeEach void setup() {
        connections = new LettuceConnectionFactory(new RedisStandaloneConfiguration(container.getHost(), container.getMappedPort(6379)),
                LettuceClientConfiguration.builder().commandTimeout(Duration.ofMillis(300)).shutdownTimeout(Duration.ZERO).build());
        connections.afterPropertiesSet(); connections.start();
        redis = new StringRedisTemplate(connections);
        try (var connection = connections.getConnection()) { connection.serverCommands().flushDb(); }
        cache = new RedisCandleCache(redis, mapper);
    }
    @AfterEach void stop() { connections.destroy(); }

    @Test void independentReadersShareCacheAndExpiredDataIsNotReturned() {
        var rows = List.of(CandleServiceTests.candle(0));
        cache.write(key, rows, Instant.now());
        assertThat(new RedisCandleCache(redis, mapper).read(key, CandleInterval.ONE_MINUTE)).contains(rows);
        assertThat(redis.getExpire(key, TimeUnit.MILLISECONDS)).isPositive().isLessThanOrEqualTo(15000);
        redis.expire(key, Duration.ofMillis(1));
        await().atMost(Duration.ofSeconds(2)).until(() -> cache.read(key, CandleInterval.ONE_MINUTE).isEmpty());
    }
    @Test void providerWaitDoesNotRestartAFullCacheLifetime() {
        cache.write(key, List.of(CandleServiceTests.candle(0)), Instant.now().minusSeconds(3));
        assertThat(redis.getExpire(key, TimeUnit.MILLISECONDS)).isPositive().isLessThanOrEqualTo(12000);
    }
    @Test void latestAndEachHistoricalCursorAreSeparateShortLivedEntriesSharedAcrossReaders() {
        var target = new BinanceSubscriptionTarget(1L, "BTC", "BTCUSDT", 1);
        Instant now = Instant.parse("2026-10-15T00:10:00Z");
        Instant before = CandleServiceTests.candle(3).openTime();
        Instant olderBefore = CandleServiceTests.candle(2).openTime();
        String historical = RedisCandleCache.key(target, CandleInterval.ONE_MINUTE, before);
        String older = RedisCandleCache.key(target, CandleInterval.ONE_MINUTE, olderBefore);
        String empty = RedisCandleCache.key(target, CandleInterval.ONE_MINUTE, CandleServiceTests.candle(0).openTime());
        assertThat(List.of(key, historical, older, empty)).doesNotHaveDuplicates();
        var clock = java.time.Clock.fixed(now, java.time.ZoneOffset.UTC);
        var writer = new RedisCandleCache(redis, mapper, clock);
        var reader = new RedisCandleCache(redis, mapper, clock);
        var historicalRows = List.of(CandleServiceTests.candle(1), CandleServiceTests.candle(2));
        writer.write(key, List.of(CandleServiceTests.candle(3)), now);
        writer.write(historical, historicalRows, now);
        writer.write(older, List.of(CandleServiceTests.candle(1)), now);
        writer.write(empty, List.of(), now);
        assertThat(reader.read(key, CandleInterval.ONE_MINUTE)).contains(List.of(CandleServiceTests.candle(3)));
        assertThat(reader.read(historical, CandleInterval.ONE_MINUTE, before)).contains(historicalRows);
        assertThat(reader.read(older, CandleInterval.ONE_MINUTE, olderBefore)).contains(List.of(CandleServiceTests.candle(1)));
        assertThat(reader.read(empty, CandleInterval.ONE_MINUTE, CandleServiceTests.candle(0).openTime())).contains(List.of());
        assertThat(redis.getExpire(historical, TimeUnit.MILLISECONDS)).isPositive().isLessThanOrEqualTo(15000);
        redis.expire(historical, Duration.ofMillis(1));
        await().atMost(Duration.ofSeconds(2)).until(() -> reader.read(historical, CandleInterval.ONE_MINUTE, before).isEmpty());
        assertThat(reader.read(older, CandleInterval.ONE_MINUTE, olderBefore)).isPresent();
    }
    @Test void aCachedHistoricalPageCannotContainTheCursorOrAStillOpenCandle() {
        Instant now = Instant.parse("2026-10-15T00:02:30Z");
        var fixed = new RedisCandleCache(redis, mapper, java.time.Clock.fixed(now, java.time.ZoneOffset.UTC));
        var candle = CandleServiceTests.candle(2);
        fixed.write(key, List.of(candle), now);
        assertThat(fixed.read(key, CandleInterval.ONE_MINUTE, candle.openTime())).isEmpty();
        assertThat(fixed.read(key, CandleInterval.ONE_MINUTE, now)).isEmpty();
    }
    @Test void inProgressCandleCannotRemainCachedIntoTheNextBucket() {
        var candle = CandleServiceTests.candle(0);
        Instant before = candle.closeTime().plusMillis(1).minusSeconds(2);
        var writer = new RedisCandleCache(redis, mapper, java.time.Clock.fixed(before, java.time.ZoneOffset.UTC));
        writer.write(key, List.of(candle), before);
        assertThat(redis.getExpire(key, TimeUnit.MILLISECONDS)).isPositive().isLessThanOrEqualTo(2000);
        assertThat(writer.read(key, CandleInterval.ONE_MINUTE)).isPresent();
        var nextBucket = new RedisCandleCache(redis, mapper, java.time.Clock.fixed(before.plusSeconds(2), java.time.ZoneOffset.UTC));
        assertThat(redis.hasKey(key)).isTrue();
        assertThat(nextBucket.read(key, CandleInterval.ONE_MINUTE)).isEmpty();
    }
    @Test void staleOrCorruptPayloadIsIgnoredEvenIfRedisTtlRemains() throws Exception {
        redis.opsForValue().set(key, mapper.writeValueAsString(new RedisCandleCache.CachedCandles(
                Instant.now().minusSeconds(16), List.of(CandleServiceTests.candle(0)))), Duration.ofSeconds(30));
        assertThat(cache.read(key, CandleInterval.ONE_MINUTE)).isEmpty();
        redis.opsForValue().set(key, "{broken");
        assertThat(cache.read(key, CandleInterval.ONE_MINUTE)).isEmpty();
        redis.opsForValue().set(key, mapper.writeValueAsString(new RedisCandleCache.CachedCandles(
                Instant.now(), List.of(CandleServiceTests.candle(1), CandleServiceTests.candle(0)))));
        assertThat(cache.read(key, CandleInterval.ONE_MINUTE)).isEmpty();
    }
    @Test void readOutageIs503AndWriteOutageDoesNotDiscardAlreadyFetchedData() {
        var template = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> values = mock(ValueOperations.class);
        when(template.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenThrow(new RedisConnectionFailureException("offline"));
        var failing = new RedisCandleCache(template, mapper);
        assertThatThrownBy(() -> failing.read(key, CandleInterval.ONE_MINUTE)).isInstanceOfSatisfying(BusinessException.class,
                error -> assertThat(error.getCode()).isEqualTo(ErrorCode.CANDLE_UNAVAILABLE));
        doThrow(new RedisConnectionFailureException("offline")).when(values).set(anyString(), anyString(), any(Duration.class));
        assertThatCode(() -> failing.write(key, List.of(CandleServiceTests.candle(0)), Instant.now())).doesNotThrowAnyException();
    }
}
