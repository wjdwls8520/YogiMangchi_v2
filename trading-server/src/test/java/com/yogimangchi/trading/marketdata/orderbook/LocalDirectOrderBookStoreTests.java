package com.yogimangchi.trading.marketdata.orderbook;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisConnectionFactory;

class LocalDirectOrderBookStoreTests {
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();

    @Test
    void localDirectModeNeverTouchesRedisAndSupportsMonotonicFanoutAndLazyResolution() {
        RedisConnectionFactory connections = mock(RedisConnectionFactory.class);
        try (var store = new RedisOrderBookStore(connections, mapper, true)) {
            var delivered = new CopyOnWriteArrayList<OrderBookSnapshot>();
            store.subscribe(delivered::add);
            store.start();

            Instant now = Instant.now();
            var lazyCalls = new AtomicInteger();
            store.setLazyResolver(symbolId -> {
                lazyCalls.incrementAndGet();
                return symbolId == 11L ? Optional.of(book(11L, 100L, "100.0", now)) : Optional.empty();
            });

            // Cold read triggers lazy resolver once per missing symbol and caches fresh results locally.
            var initial = store.read(Set.of(11L, 12L));
            assertThat(initial).containsOnlyKeys(11L);
            assertThat(initial.get(11L).bids().get(0).price()).isEqualTo("100.0");
            assertThat(lazyCalls).hasValue(2);

            // Second warm read for symbol 11 hits local cache directly without re-parsing.
            assertThat(store.read(Set.of(11L)).get(11L).providerUpdateId()).isEqualTo(100L);
            assertThat(lazyCalls).hasValue(2);

            // Older update ID is rejected monotonically; newer update ID fans out directly in memory.
            store.accept(book(11L, 99L, "99.0", now));
            store.accept(book(11L, 101L, "101.0", now));
            await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
                assertThat(delivered).hasSize(1);
                assertThat(delivered.get(0).bids().get(0).price()).isEqualTo("101.0");
            });
            assertThat(store.read(Set.of(11L)).get(11L).providerUpdateId()).isEqualTo(101L);

            verifyNoInteractions(connections);
        }
    }

    private static OrderBookSnapshot book(long symbolId, long updateId, String bid, Instant now) {
        return new OrderBookSnapshot(
                symbolId,
                List.of(new OrderBookSnapshot.Level(bid, "1.0")),
                List.of(new OrderBookSnapshot.Level("102.0", "1.0")),
                updateId,
                now,
                now);
    }
}
