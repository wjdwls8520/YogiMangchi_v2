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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

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
    void oldReceiptsAndExcessiveProviderSkewAreRejected() {
        store.beginSubscription(Set.of(1L));
        assertThat(store.update(price(1L, "1", clock.instant(), clock.instant().minusSeconds(5)))).isFalse();
        assertThat(store.update(price(1L, "1", clock.instant().plusSeconds(11), clock.instant()))).isFalse();
        assertThat(store.find(1L).status()).isEqualTo(LatestPriceStore.Status.UNAVAILABLE);
    }

    @ParameterizedTest
    @CsvSource({"-11000,REJECTED,false", "-10000,DEGRADED,true", "-6000,DEGRADED,true",
            "-2000,WARNING,true", "-1000,NORMAL,true", "0,NORMAL,true", "999,NORMAL,true",
            "1000,NORMAL,true", "1001,WARNING,true", "2000,WARNING,true", "5000,WARNING,true",
            "5001,DEGRADED,true", "6000,DEGRADED,true", "10000,DEGRADED,true", "10001,REJECTED,false", "11000,REJECTED,false"})
    void providerSkewHasSeparateWarningDegradedAndRejectThresholds(long skewMs, String expected, boolean accepted) {
        store.beginSubscription(Set.of(1L));
        var price = price(1L, "10", clock.instant().plusMillis(skewMs), clock.instant());
        assertThat(store.update(price)).isEqualTo(accepted);
        assertThat(store.marketClockSnapshot().status().name()).isEqualTo(expected);
        assertThat(store.marketClockSnapshot().skewMs()).isEqualTo(skewMs);
        assertThat(store.find(1L).status()).isEqualTo(accepted ? LatestPriceStore.Status.FRESH : LatestPriceStore.Status.UNAVAILABLE);
        if (accepted) {
            clock.advanceMillis(5000);
            assertThat(store.find(1L).status()).isEqualTo(LatestPriceStore.Status.STALE);
            assertThat(store.marketClockSnapshot().status()).isEqualTo(MarkPriceTimePolicy.ClockStatus.UNAVAILABLE);
        }
    }

    @Test
    void rejectedSkewInvalidatesPreviousPriceOnceWithoutPoisoningItsWatermarkAndRecovers() {
        var emitted = new ArrayList<MarketDataEvent>();
        var observable = new LatestPriceStore(clock, event -> emitted.add((MarketDataEvent) event));
        observable.beginSubscription(Set.of(1L));
        var first = price(1L, "10", clock.instant(), clock.instant());
        assertThat(observable.update(first)).isTrue();
        assertThat(observable.update(price(1L, "999", clock.instant().plusSeconds(11), clock.instant()))).isFalse();
        assertThat(observable.update(price(1L, "999", clock.instant().plusSeconds(12), clock.instant()))).isFalse();
        assertThat(observable.find(1L).status()).isEqualTo(LatestPriceStore.Status.UNAVAILABLE);
        assertThat(observable.find(1L).latestPrice()).contains(first);
        assertThat(emitted).extracting(MarketDataEvent::type).containsExactly(
                MarketDataEvent.Type.RECONNECTING, MarketDataEvent.Type.PRICE, MarketDataEvent.Type.UNAVAILABLE);
        clock.advanceMillis(1);
        assertThat(observable.update(price(1L, "11", clock.instant(), clock.instant()))).isTrue();
        assertThat(observable.find(1L).status()).isEqualTo(LatestPriceStore.Status.FRESH);
        assertThat(observable.marketClockSnapshot().status()).isEqualTo(MarkPriceTimePolicy.ClockStatus.NORMAL);
    }

    @Test
    void warningRecoversToNormalAndDuplicateOrOldEventsCannotRefreshClockObservation() {
        store.beginSubscription(Set.of(1L));
        var first = price(1L, "10", clock.instant().minusSeconds(2), clock.instant());
        assertThat(store.update(first)).isTrue();
        clock.advanceMillis(1000);
        assertThat(store.update(price(1L, "99", first.eventTime(), clock.instant()))).isFalse();
        assertThat(store.update(price(1L, "99", first.eventTime().minusMillis(1), clock.instant()))).isFalse();
        assertThat(store.marketClockSnapshot().skewMs()).isEqualTo(-2000);
        assertThat(store.update(price(1L, "11", clock.instant(), clock.instant()))).isTrue();
        assertThat(store.marketClockSnapshot().status()).isEqualTo(MarkPriceTimePolicy.ClockStatus.NORMAL);
    }

    @Test
    void clockLogsAreTransitionsOrThirtySecondSummariesWithOperationalContext() {
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(LatestPriceStore.class);
        var logs = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        logs.start(); logger.addAppender(logs);
        try {
            store.beginSubscription(Set.of(1L));
            for (int i = 0; i < 40; i++) {
                store.update(price(1L, "10", clock.instant().plusSeconds(2), clock.instant()));
                clock.advanceMillis(1000);
            }
            assertThat(logs.list).hasSize(2).allSatisfy(entry -> assertThat(entry.getFormattedMessage()).contains(
                    "provider=BINANCE", "tradingSymbolId=1", "status=WARNING", "skewMs=2000", "eventTime=", "receivedAt=",
                    "serverNow=", "warningThresholdMs=1000", "degradedThresholdMs=5000", "rejectThresholdMs=10000"));
            store.update(price(1L, "10", clock.instant().plusSeconds(6), clock.instant()));
            clock.advanceMillis(7000);
            store.update(price(1L, "10", clock.instant(), clock.instant()));
            assertThat(logs.list).hasSize(4);
            assertThat(logs.list.get(2).getFormattedMessage()).contains("status=DEGRADED");
            assertThat(logs.list.get(3).getFormattedMessage()).contains("status=NORMAL");
        } finally { logger.detachAppender(logs); logs.stop(); }
    }

    @Test
    void worstRecentClockObservationIsDiagnosticAndDoesNotBlockOtherSymbols() {
        store.beginSubscription(Set.of(1L, 2L));
        assertThat(store.update(price(1L, "10", clock.instant().plusSeconds(11), clock.instant()))).isFalse();
        assertThat(store.update(price(2L, "20", clock.instant(), clock.instant()))).isTrue();
        assertThat(store.marketClockSnapshot().status()).isEqualTo(MarkPriceTimePolicy.ClockStatus.REJECTED);
        assertThat(store.find(2L).status()).isEqualTo(LatestPriceStore.Status.FRESH);
        store.markUnavailable();
        assertThat(store.marketClockSnapshot().status()).isEqualTo(MarkPriceTimePolicy.ClockStatus.UNAVAILABLE);
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
