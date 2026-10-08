package com.yogimangchi.trading.marketdata;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LatestPriceStoreTests {
    private final MutableClock clock = new MutableClock();
    private final LatestPriceStore store = new LatestPriceStore(clock);

    @Test
    void missingStoredAndUpdatedSnapshotsIncludeTimestamps() {
        store.beginSubscription(Set.of(1L, 2L));
        assertThat(store.find(1L).status()).isEqualTo(LatestPriceStore.Status.MISSING);
        assertThat(store.find(1L).latestPrice()).isEmpty();
        var first = price(1L, "10", clock.instant(), clock.instant());
        assertThat(store.update(first)).isTrue();
        var snapshot = store.find(1L);
        clock.advanceMillis(1000);
        var second = price(1L, "11", clock.instant(), clock.instant());
        assertThat(store.update(second)).isTrue();
        assertThat(store.find(1L).latestPrice()).contains(second);
        assertThat(snapshot.latestPrice()).contains(first);
        assertThat(store.find(1L).status()).isEqualTo(LatestPriceStore.Status.FRESH);
    }

    @Test
    void anotherSymbolsUpdatesDoNotHideStalenessAndBoundaryIsFiveSeconds() {
        store.beginSubscription(Set.of(1L, 2L));
        store.update(price(1L, "10", clock.instant(), clock.instant()));
        clock.advanceMillis(4999);
        assertThat(store.find(1L).status()).isEqualTo(LatestPriceStore.Status.FRESH);
        clock.advanceMillis(1);
        store.update(price(2L, "20", clock.instant(), clock.instant()));
        assertThat(store.find(1L).status()).isEqualTo(LatestPriceStore.Status.STALE);
        assertThat(store.find(2L).status()).isEqualTo(LatestPriceStore.Status.FRESH);
    }

    @Test
    void bothProviderEventTimeAndReceiptTimeMustBeFresh() {
        store.beginSubscription(Set.of(1L));
        assertThat(store.update(price(1L, "1", clock.instant().minusSeconds(5), clock.instant()))).isFalse();
        assertThat(store.update(price(1L, "1", clock.instant(), clock.instant().minusSeconds(5)))).isFalse();
        assertThat(store.update(price(1L, "1", clock.instant().plusSeconds(2), clock.instant()))).isFalse();
        assertThat(store.find(1L).status()).isEqualTo(LatestPriceStore.Status.MISSING);
    }

    @Test
    void replayAndOutOfOrderDataNeverRefreshExistingPrice() {
        store.beginSubscription(Set.of(1L));
        Instant eventTime = clock.instant();
        var first = price(1L, "10", eventTime, eventTime);
        store.update(first);
        clock.advanceMillis(1000);
        assertThat(store.update(price(1L, "99", eventTime, clock.instant()))).isFalse();
        assertThat(store.update(price(1L, "98", eventTime.minusSeconds(1), clock.instant()))).isFalse();
        assertThat(store.find(1L).latestPrice()).contains(first);
    }

    @Test
    void disconnectAndReconnectRequireNewDataForEachSymbol() {
        store.beginSubscription(Set.of(1L, 2L));
        store.update(price(1L, "10", clock.instant(), clock.instant()));
        store.update(price(2L, "20", clock.instant(), clock.instant()));
        store.markUnavailable();
        assertThat(store.find(1L).status()).isEqualTo(LatestPriceStore.Status.UNAVAILABLE);
        clock.advanceMillis(1000);
        var next = price(1L, "11", clock.instant(), clock.instant());
        assertThat(store.update(next)).isFalse();
        store.beginSubscription(Set.of(1L, 2L));
        assertThat(store.find(1L).status()).isEqualTo(LatestPriceStore.Status.UNAVAILABLE);
        store.update(next);
        assertThat(store.find(1L).status()).isEqualTo(LatestPriceStore.Status.FRESH);
        assertThat(store.find(2L).status()).isEqualTo(LatestPriceStore.Status.UNAVAILABLE);
    }

    @Test
    void removedAndUnknownSymbolsCannotBeUsed() {
        store.beginSubscription(Set.of(1L));
        store.update(price(1L, "10", clock.instant(), clock.instant()));
        assertThat(store.update(price(2L, "20", clock.instant(), clock.instant()))).isFalse();
        store.beginSubscription(Set.of(2L));
        assertThat(store.find(1L).latestPrice()).isEmpty();
    }

    @Test
    void concurrentUpdatesRetainTheNewestWholeSnapshot() throws Exception {
        store.beginSubscription(Set.of(1L));
        var executor = Executors.newFixedThreadPool(4);
        try {
            var results = new ArrayList<Future<?>>();
            for (int i = 0; i < 100; i++) {
                int sequence = i;
                results.add(executor.submit(() -> {
                    store.update(price(1L, Integer.toString(sequence + 1),
                            clock.instant().minusMillis(100 - sequence), clock.instant()));
                    var snapshot = store.find(1L);
                    assertThat(snapshot.status()).isEqualTo(LatestPriceStore.Status.FRESH);
                    assertThat(snapshot.latestPrice()).isPresent();
                }));
            }
            for (var result : results) {
                result.get();
            }
            assertThat(store.find(1L).latestPrice().orElseThrow().domainMarkPrice()).isEqualByComparingTo("100");
        } finally {
            executor.shutdownNow();
        }
    }

    private LatestMarkPrice price(Long id, String price, Instant eventTime, Instant receivedAt) {
        return new LatestMarkPrice(id, new BigDecimal(price), eventTime, receivedAt);
    }

    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-10-08T00:00:00Z");
        void advanceMillis(long millis) { now = now.plusMillis(millis); }
        @Override public Instant instant() { return now; }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(now, zone); }
    }
}
