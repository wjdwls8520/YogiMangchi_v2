package com.yogimangchi.trading.marketdata;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.connection.RedisConnectionFactory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RedisMarketDataBridgeFailureTests {
    @Test
    void startupWithoutRedisSurvivesAndRetriesWithDelayWhileLocalFanoutContinues() {
        var connections = mock(RedisConnectionFactory.class);
        when(connections.getConnection()).thenThrow(new RedisConnectionFailureException("test offline"));
        var fanout = new MarketDataFanout();
        var bridge = new RedisMarketDataBridge(connections, new ObjectMapper().findAndRegisterModules(), fanout);
        var received = new CopyOnWriteArrayList<MarketDataEvent>();
        fanout.subscribe(received::add);
        try {
            bridge.start();
            await().atMost(Duration.ofSeconds(2)).until(() -> bridge.health().state() == RedisMarketDataBridge.State.UNAVAILABLE);
            Instant now = Instant.now();
            var event = MarketDataEvent.price(new LatestMarkPrice(1L, BigDecimal.TEN, now, now));
            bridge.accept(event);
            await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertThat(received).containsExactly(event));
            await().during(Duration.ofMillis(500)).atMost(Duration.ofSeconds(2))
                    .untilAsserted(() -> verify(connections, times(1)).getConnection());
            await().atMost(Duration.ofSeconds(7)).untilAsserted(() -> verify(connections, atLeast(2)).getConnection());
            await().during(Duration.ofMillis(500)).atMost(Duration.ofSeconds(2))
                    .untilAsserted(() -> verify(connections, times(2)).getConnection());
            assertThat(bridge.health().gapSequence()).isPositive();
        } finally {
            bridge.close();
            fanout.close();
        }
    }

    @Test
    void fullPublisherQueueDoesNotBlockAndReportsLostReplayContinuity() {
        var connections = mock(RedisConnectionFactory.class);
        var fanout = new MarketDataFanout();
        var bridge = new RedisMarketDataBridge(connections, new ObjectMapper().findAndRegisterModules(), fanout);
        try {
            // Deliberately do not start the worker: producers must remain bounded even when it cannot run.
            Instant now = Instant.now();
            for (int index = 0; index < 1100; index++) {
                bridge.accept(MarketDataEvent.price(new LatestMarkPrice(1L, BigDecimal.TEN, now, now)));
            }
            assertThat(bridge.health().state()).isEqualTo(RedisMarketDataBridge.State.UNAVAILABLE);
            assertThat(bridge.health().gapSequence()).isPositive();
        } finally {
            bridge.close();
            fanout.close();
        }
    }
}
