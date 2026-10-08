package com.yogimangchi.trading.marketdata;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

class RedisMarketDataBridgeTests {
    private static final GenericContainer<?> redisContainer = new GenericContainer<>("redis:7-alpine")
            .withExposedPorts(6379);
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private LettuceConnectionFactory connections;
    private StringRedisTemplate redis;
    private RedisMarketDataBridge bridge;
    private MarketDataFanout fanout;
    private final CopyOnWriteArrayList<MarketDataEvent> received = new CopyOnWriteArrayList<>();

    @BeforeAll
    static void startRedis() { redisContainer.start(); }

    @AfterAll
    static void stopRedis() { redisContainer.stop(); }

    @BeforeEach
    void setUp() {
        var config = new RedisStandaloneConfiguration(redisContainer.getHost(), redisContainer.getMappedPort(6379));
        connections = new LettuceConnectionFactory(config, LettuceClientConfiguration.builder()
                .commandTimeout(Duration.ofMillis(300)).shutdownTimeout(Duration.ZERO).build());
        connections.afterPropertiesSet();
        connections.start();
        redis = new StringRedisTemplate(connections);
        // This isolated test container contains no application/user data.
        try (var connection = connections.getConnection()) { connection.serverCommands().flushDb(); }
        fanout = new MarketDataFanout();
        fanout.subscribe(received::add);
        bridge = new RedisMarketDataBridge(connections, mapper, fanout);
        bridge.start();
        await().atMost(Duration.ofSeconds(10)).until(() -> bridge.health().state() == RedisMarketDataBridge.State.HEALTHY);
    }

    @AfterEach
    void tearDown() {
        bridge.close();
        fanout.close();
        connections.destroy();
    }

    @Test
    void normalizedSnapshotReplayStreamAndPubSubAreWrittenTogether() throws Exception {
        var price = price("0.0000098", Instant.now());
        var event = MarketDataEvent.price(price);
        bridge.accept(event);
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(received).containsExactly(event));

        assertThat(bridge.readSharedSnapshot(11).status()).isEqualTo(LatestPriceStore.Status.FRESH);
        assertThat(bridge.readSharedSnapshot(11).latestPrice()).contains(price);
        assertThat(redis.getExpire(RedisMarketDataBridge.snapshotKey(11), java.util.concurrent.TimeUnit.MILLISECONDS))
                .isPositive().isLessThanOrEqualTo(5000L);
        String json = redis.opsForValue().get(RedisMarketDataBridge.snapshotKey(11));
        assertThat(json).contains("\"version\":1", "\"tradingSymbolId\":11")
                .doesNotContain("provider", "1000PEPE");
        assertThat(mapper.readTree(json).path("price").path("domainMarkPrice").decimalValue())
                .isEqualByComparingTo("0.0000098");
        var records = redis.opsForStream().range(RedisMarketDataBridge.STREAM_KEY, Range.unbounded());
        assertThat(records).hasSize(1);
        assertThat(mapper.readValue((String) records.get(0).getValue().get("payload"), MarketDataEvent.class)).isEqualTo(event);
    }

    @Test
    void duplicateAndOlderEventsNeverReplaceSnapshotOrCreateAnotherReplayRecord() {
        Instant now = Instant.now();
        var newest = MarketDataEvent.price(price("10", now));
        bridge.accept(newest);
        bridge.accept(newest);
        bridge.accept(MarketDataEvent.price(price("99", now.minusMillis(500))));
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(received).hasSize(1));
        await().during(Duration.ofMillis(250)).atMost(Duration.ofSeconds(2)).untilAsserted(() ->
                assertThat(redis.opsForStream().size(RedisMarketDataBridge.STREAM_KEY)).isEqualTo(1));
        assertThat(bridge.readSharedSnapshot(11).latestPrice().orElseThrow().domainMarkPrice()).isEqualByComparingTo("10");
    }

    @Test
    void expiredSnapshotCannotBeResurrectedByAnOldEvent() {
        var event = MarketDataEvent.price(price("10", Instant.now()));
        bridge.accept(event);
        await().atMost(Duration.ofSeconds(3)).until(() -> received.size() == 1);
        await().atMost(Duration.ofSeconds(7)).until(() -> !redis.hasKey(RedisMarketDataBridge.snapshotKey(11)));
        assertThat(redis.hasKey(RedisMarketDataBridge.watermarkKey(11))).isTrue();
        bridge.accept(event);
        await().during(Duration.ofMillis(200)).atMost(Duration.ofSeconds(2)).untilAsserted(() ->
                assertThat(bridge.readSharedSnapshot(11).status()).isEqualTo(LatestPriceStore.Status.MISSING));
        assertThat(redis.opsForStream().size(RedisMarketDataBridge.STREAM_KEY)).isEqualTo(1);
    }

    @Test
    void delayedEventCannotReceiveANewFiveSecondLifetime() {
        var old = price("10", Instant.now().minusSeconds(10));
        bridge.accept(MarketDataEvent.price(old));
        await().atMost(Duration.ofSeconds(3)).until(() -> bridge.health().gapSequence() > 0);
        assertThat(redis.hasKey(RedisMarketDataBridge.snapshotKey(11))).isFalse();
        assertThat(redis.opsForStream().size(RedisMarketDataBridge.STREAM_KEY)).isZero();
        assertThat(received).isEmpty();
    }

    @Test
    void disconnectAndResubscriptionInvalidateSharedPricesUntilNewData() {
        LatestPriceStore local = new LatestPriceStore(Clock.systemUTC(), event -> bridge.accept((MarketDataEvent) event));
        local.beginSubscription(Set.of(11L));
        local.update(price("10", Instant.now()));
        await().atMost(Duration.ofSeconds(3)).until(() -> bridge.readSharedSnapshot(11).status() == LatestPriceStore.Status.FRESH);
        local.markUnavailable();
        await().atMost(Duration.ofSeconds(3)).until(() -> bridge.readSharedSnapshot(11).status() == LatestPriceStore.Status.UNAVAILABLE);
        local.beginSubscription(Set.of(11L));
        local.update(price("11", Instant.now().plusMillis(1)));
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(received)
                .extracting(MarketDataEvent::type).containsExactly(MarketDataEvent.Type.RECONNECTING,
                        MarketDataEvent.Type.PRICE, MarketDataEvent.Type.UNAVAILABLE,
                        MarketDataEvent.Type.RECONNECTING, MarketDataEvent.Type.PRICE));
        assertThat(bridge.readSharedSnapshot(11).latestPrice().orElseThrow().domainMarkPrice()).isEqualByComparingTo("11");
    }

    @Test
    void redisFailurePreservesLocalPriceAndProvidesLocalFanoutWhileReportingReplayGap() throws Exception {
        LatestPriceStore local = new LatestPriceStore(Clock.systemUTC(), event -> bridge.accept((MarketDataEvent) event));
        local.beginSubscription(Set.of(11L));
        await().atMost(Duration.ofSeconds(3)).until(() -> !received.isEmpty());
        redisContainer.execInContainer("redis-cli", "CLIENT", "PAUSE", "1500", "ALL");
        long started = System.nanoTime();
        local.update(price("10", Instant.now()));
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(100));
        await().atMost(Duration.ofSeconds(3)).until(() -> bridge.health().state() == RedisMarketDataBridge.State.UNAVAILABLE);
        assertThat(local.find(11L).status()).isEqualTo(LatestPriceStore.Status.FRESH);
        assertThat(bridge.health().gapSequence()).isPositive();
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(received)
                .anyMatch(event -> event.type() == MarketDataEvent.Type.PRICE));
        await().atMost(Duration.ofSeconds(10)).until(() -> bridge.health().state() == RedisMarketDataBridge.State.HEALTHY);
        local.update(price("12", Instant.now()));
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(bridge.readSharedSnapshot(11)
                .latestPrice().orElseThrow().domainMarkPrice()).isEqualByComparingTo("12"));
    }

    @Test
    void pubSubEchoAndLocalFallbackDoNotDeliverTheSameEventTwice() {
        var event = MarketDataEvent.price(price("10", Instant.now()));
        fanout.publish(event);
        bridge.accept(event);
        await().atMost(Duration.ofSeconds(3)).until(() -> redis.hasKey(RedisMarketDataBridge.snapshotKey(11)));
        await().during(Duration.ofMillis(200)).atMost(Duration.ofSeconds(2))
                .untilAsserted(() -> assertThat(received).containsExactly(event));
    }

    private LatestMarkPrice price(String amount, Instant time) {
        return new LatestMarkPrice(11L, new BigDecimal(amount), time, time);
    }
}
