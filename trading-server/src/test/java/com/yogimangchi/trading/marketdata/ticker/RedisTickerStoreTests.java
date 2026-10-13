package com.yogimangchi.trading.marketdata.ticker;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

class RedisTickerStoreTests {
    private static final GenericContainer<?> container = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private LettuceConnectionFactory connections;
    private StringRedisTemplate redis;
    private RedisTickerStore store;

    @BeforeAll static void startRedis() { container.start(); }
    @AfterAll static void stopRedis() { container.stop(); }
    @BeforeEach void setUp() {
        connections = new LettuceConnectionFactory(new RedisStandaloneConfiguration(container.getHost(), container.getMappedPort(6379)),
                LettuceClientConfiguration.builder().commandTimeout(Duration.ofMillis(300)).shutdownTimeout(Duration.ZERO).build());
        connections.afterPropertiesSet(); connections.start();
        redis = new StringRedisTemplate(connections);
        try (var connection = connections.getConnection()) { connection.serverCommands().flushDb(); }
        store = new RedisTickerStore(connections, mapper);
        store.start();
    }
    @AfterEach void tearDown() { store.close(); connections.destroy(); }

    @Test void overwritesLatestAndRejectsDuplicateAndOlderAcrossIndependentCollectorsWithoutStream() throws Exception {
        Instant now = Instant.now();
        store.accept(ticker(now.minusMillis(100), "10"));
        await().atMost(Duration.ofSeconds(3)).until(() -> redis.hasKey(RedisTickerStore.snapshotKey(91)));
        var second = new RedisTickerStore(connections, mapper);
        second.start();
        try {
            second.accept(ticker(now, "20"));
            await().atMost(Duration.ofSeconds(3)).untilAsserted(() ->
                    assertThat(read().quoteVolume24h()).isEqualByComparingTo("20"));
            store.accept(ticker(now, "99"));
            store.accept(ticker(now.minusMillis(50), "99"));
            await().during(Duration.ofMillis(200)).atMost(Duration.ofSeconds(2)).untilAsserted(() ->
                    assertThat(read().quoteVolume24h()).isEqualByComparingTo("20"));
            assertThat(redis.hasKey(RedisMarketDataBridge.STREAM_KEY)).isFalse();
            assertThat(redis.hasKey(RedisMarketDataBridge.snapshotKey(91))).isFalse();
            assertThat(redis.getExpire(RedisTickerStore.snapshotKey(91), TimeUnit.MILLISECONDS)).isPositive().isLessThanOrEqualTo(10000);
        } finally { second.close(); }
    }

    @Test void expirationDoesNotAllowAnOldEventToResurrectTheSnapshot() {
        Instant now = Instant.now();
        store.accept(ticker(now, "20"));
        await().atMost(Duration.ofSeconds(3)).until(() -> redis.hasKey(RedisTickerStore.snapshotKey(91)));
        redis.expire(RedisTickerStore.snapshotKey(91), Duration.ofMillis(1));
        await().atMost(Duration.ofSeconds(2)).until(() -> !redis.hasKey(RedisTickerStore.snapshotKey(91)));
        store.accept(ticker(now.minusMillis(1), "99"));
        await().during(Duration.ofMillis(200)).atMost(Duration.ofSeconds(2)).untilAsserted(() ->
                assertThat(redis.hasKey(RedisTickerStore.snapshotKey(91))).isFalse());
        assertThat(redis.getExpire(RedisTickerStore.watermarkKey(91))).isGreaterThan(86000);
    }

    @Test void staleAndFutureDataCannotBePublished() {
        store.accept(ticker(Instant.now().minusSeconds(11), "20"));
        store.accept(ticker(Instant.now().plusSeconds(3), "20"));
        await().during(Duration.ofMillis(200)).atMost(Duration.ofSeconds(2)).untilAsserted(() ->
                assertThat(redis.hasKey(RedisTickerStore.snapshotKey(91))).isFalse());
    }

    @Test void redisFailureAndQueueSaturationNeverBlockBinanceProducer() {
        var unavailable = org.mockito.Mockito.mock(org.springframework.data.redis.connection.RedisConnectionFactory.class);
        org.mockito.Mockito.when(unavailable.getConnection()).thenThrow(new org.springframework.data.redis.RedisConnectionFailureException("offline"));
        var failingStore = new RedisTickerStore(unavailable, mapper);
        failingStore.start();
        try {
            Assertions.assertTimeoutPreemptively(Duration.ofSeconds(2), () -> {
                for (int i = 0; i < 10000; i++) failingStore.accept(ticker(Instant.now(), "20"));
            });
            org.mockito.Mockito.verify(unavailable, org.mockito.Mockito.timeout(2000).atLeastOnce()).getConnection();
        } finally { failingStore.close(); }
    }

    private MarketTicker read() throws Exception { return mapper.readValue(redis.opsForValue().get(RedisTickerStore.snapshotKey(91)), MarketTicker.class); }
    private static MarketTicker ticker(Instant event, String volume) {
        return new MarketTicker(91, new BigDecimal("2.3"), new BigDecimal("0.0000123"), new BigDecimal("0.0000091"),
                new BigDecimal(volume), event, Instant.now());
    }
}
