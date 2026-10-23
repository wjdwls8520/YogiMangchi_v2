package com.yogimangchi.trading.marketdata.orderbook;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.*;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;

class RedisOrderBookStoreTests {
    private static final GenericContainer<?> container = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private LettuceConnectionFactory connection;
    private StringRedisTemplate redis;
    private RedisOrderBookStore first, second;
    @BeforeAll static void begin() { container.start(); }
    @AfterAll static void end() { container.stop(); }
    @BeforeEach void setup() {
        connection = new LettuceConnectionFactory(new RedisStandaloneConfiguration(container.getHost(), container.getMappedPort(6379)),
                LettuceClientConfiguration.builder().commandTimeout(Duration.ofMillis(500)).shutdownTimeout(Duration.ZERO).build());
        connection.afterPropertiesSet(); connection.start(); redis = new StringRedisTemplate(connection);
        try (var isolated = connection.getConnection()) { isolated.serverCommands().flushDb(); }
        first = new RedisOrderBookStore(connection, mapper); second = new RedisOrderBookStore(connection, mapper);
    }
    @AfterEach void cleanup() { first.close(); second.close(); connection.destroy(); }
    @Test void overwritesOnlyLatestRejectsOldDuplicateAndEventTimeRegressionWithExactInt64Ids() throws Exception {
        Instant now = Instant.now();
        long id = 9_007_199_254_740_992L;
        assertThat(first.publish(book(id, now))).isEqualTo(1);
        assertThat(first.publish(book(id + 1, now))).isEqualTo(1);
        assertThat(first.publish(book(id, now))).isZero();
        assertThat(first.publish(book(id + 1, now))).isZero();
        assertThat(first.publish(book(id + 2, now.minusMillis(1)))).isZero();
        assertThat(second.read(Set.of(11L)).get(11L).providerUpdateId()).isEqualTo(id + 1);
        assertThat(redis.getExpire(RedisOrderBookStore.snapshotKey(11), TimeUnit.MILLISECONDS)).isPositive().isLessThanOrEqualTo(3000);
        assertThat(redis.hasKey(RedisMarketDataBridge.STREAM_KEY)).isFalse();
        assertThat(first.publish(book(id + 2, now.minusSeconds(4)))).isZero();
    }
    @Test void ttlExpiryAndReadFreshnessNeverReturnAnOldSnapshot() throws Exception {
        var expired = book(100, Instant.now().minusSeconds(4));
        redis.opsForValue().set(RedisOrderBookStore.snapshotKey(11), mapper.writeValueAsString(expired), Duration.ofSeconds(30));
        assertThat(first.read(Set.of(11L))).isEmpty();
        redis.delete(RedisOrderBookStore.watermarkKey(11));
        assertThat(first.publish(book(101, Instant.now()))).isEqualTo(1);
        await().atMost(Duration.ofSeconds(5)).until(() -> first.read(Set.of(11L)).isEmpty());
        assertThat(redis.hasKey(RedisOrderBookStore.snapshotKey(11))).isFalse();
    }
    @Test void collectorPublishesThroughRedisToIndependentNodeWithoutWritingAnExecutionStream() {
        var received = new CopyOnWriteArrayList<OrderBookSnapshot>();
        second.subscribe(received::add); first.start(); second.start();
        var sequence = new AtomicLong(100);
        await().atMost(Duration.ofSeconds(8)).untilAsserted(() -> {
            first.accept(book(sequence.incrementAndGet(), Instant.now()));
            assertThat(received).isNotEmpty();
        });
        assertThat(received.get(0).bids().get(0).price()).isEqualTo("0.000004001");
        assertThat(redis.hasKey(RedisMarketDataBridge.STREAM_KEY)).isFalse();
    }
    static OrderBookSnapshot book(long update, Instant now) {
        return new OrderBookSnapshot(11, List.of(new OrderBookSnapshot.Level("0.000004001", "1250")),
                List.of(new OrderBookSnapshot.Level("0.000004002", "2500")), update, now, now);
    }
}
