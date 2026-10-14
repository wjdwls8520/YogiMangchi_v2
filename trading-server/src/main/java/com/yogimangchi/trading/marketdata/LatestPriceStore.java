package com.yogimangchi.trading.marketdata;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Small, synchronized snapshots: price, subscription availability and freshness are read atomically. */
@Component
public class LatestPriceStore {
    private static final Logger log = LoggerFactory.getLogger(LatestPriceStore.class);
    private static final Duration CLOCK_LOG_INTERVAL = Duration.ofSeconds(30);
    private final Clock clock;
    private final ApplicationEventPublisher events;
    private final Map<Long, LatestMarkPrice> prices = new HashMap<>();
    private final Set<Long> available = new HashSet<>();
    private final Set<Long> clockRejected = new HashSet<>();
    private final Map<Long, ClockObservation> clockObservations = new HashMap<>();
    private final Map<Long, Instant> clockLoggedAt = new HashMap<>();
    private Set<Long> subscribed = Set.of();
    private boolean accepting;

    public enum Status { MISSING, FRESH, STALE, UNAVAILABLE }

    public record Snapshot(Status status, Optional<LatestMarkPrice> latestPrice) { }
    public record MarketClockSnapshot(MarkPriceTimePolicy.ClockStatus status, Long skewMs) { }
    private record ClockObservation(MarkPriceTimePolicy.ClockStatus status, long skewMs, LatestMarkPrice price) { }

    public LatestPriceStore() {
        this(Clock.systemUTC());
    }

    @Autowired
    public LatestPriceStore(ApplicationEventPublisher events) {
        this(Clock.systemUTC(), events);
    }

    public LatestPriceStore(Clock clock) {
        this(clock, event -> { });
    }

    public LatestPriceStore(Clock clock, ApplicationEventPublisher events) {
        this.clock = clock;
        this.events = events;
    }

    public synchronized void beginSubscription(Set<Long> tradingSymbolIds) {
        Set<Long> affected = new HashSet<>(subscribed);
        affected.addAll(tradingSymbolIds);
        subscribed = Set.copyOf(tradingSymbolIds);
        prices.keySet().retainAll(subscribed);
        clockRejected.clear();
        clockObservations.keySet().retainAll(subscribed);
        clockLoggedAt.keySet().retainAll(subscribed);
        available.clear();
        accepting = true;
        events.publishEvent(MarketDataEvent.state(MarketDataEvent.Type.RECONNECTING, affected, clock.instant()));
    }

    public synchronized void markUnavailable() {
        accepting = false;
        available.clear();
        events.publishEvent(MarketDataEvent.state(MarketDataEvent.Type.UNAVAILABLE, subscribed, clock.instant()));
    }

    public synchronized boolean update(LatestMarkPrice price) {
        Instant now = clock.instant();
        if (!accepting || !subscribed.contains(price.tradingSymbolId()) || !MarkPriceTimePolicy.receivedRecently(price, now)) {
            return false;
        }
        LatestMarkPrice previous = prices.get(price.tradingSymbolId());
        // Replayed/out-of-order events must not move prices backwards or make old data look fresh.
        if (previous != null && !price.eventTime().isAfter(previous.eventTime())) {
            return false;
        }
        var clockStatus = observeClock(price, now);
        if (clockStatus == MarkPriceTimePolicy.ClockStatus.REJECTED) {
            available.remove(price.tradingSymbolId());
            // One unavailable event per rejection episode, including when no valid price was stored yet.
            if (clockRejected.add(price.tradingSymbolId())) {
                events.publishEvent(MarketDataEvent.state(MarketDataEvent.Type.UNAVAILABLE,
                        Set.of(price.tradingSymbolId()), now));
            }
            return false;
        }
        prices.put(price.tradingSymbolId(), price);
        available.add(price.tradingSymbolId());
        clockRejected.remove(price.tradingSymbolId());
        // Listeners only enqueue: external I/O must never run under this short local-cache lock.
        events.publishEvent(MarketDataEvent.price(price));
        return true;
    }

    public synchronized Snapshot find(Long tradingSymbolId) {
        return findAt(tradingSymbolId, clock.instant());
    }

    /** One timestamp and cache lock give account-wide valuation a coherent price vector. */
    public synchronized Map<Long, Snapshot> findAll(Collection<Long> tradingSymbolIds) {
        Instant now = clock.instant();
        Map<Long, Snapshot> result = new HashMap<>();
        for (Long id : tradingSymbolIds) result.put(id, findAt(id, now));
        return Map.copyOf(result);
    }

    private Snapshot findAt(Long tradingSymbolId, Instant now) {
        LatestMarkPrice price = prices.get(tradingSymbolId);
        if (price == null) {
            return new Snapshot(clockRejected.contains(tradingSymbolId) ? Status.UNAVAILABLE : Status.MISSING, Optional.empty());
        }
        Status status = !available.contains(tradingSymbolId) ? Status.UNAVAILABLE
                : isFreshAt(price, now) ? Status.FRESH : Status.STALE;
        return new Snapshot(status, Optional.of(price));
    }

    public static boolean isFreshAt(LatestMarkPrice price, Instant now) {
        return MarkPriceTimePolicy.isFreshAt(price, now);
    }

    /** Worst recent observation on this receiving node; diagnostic only, separate from the engine gate. */
    public synchronized MarketClockSnapshot marketClockSnapshot() {
        Instant now = clock.instant();
        if (!accepting) return new MarketClockSnapshot(MarkPriceTimePolicy.ClockStatus.UNAVAILABLE, null);
        return clockObservations.values().stream()
                .filter(observation -> MarkPriceTimePolicy.receivedRecently(observation.price(), now))
                .max(Comparator.comparingInt((ClockObservation observation) -> observation.status().ordinal())
                        .thenComparing(observation -> Duration.between(observation.price().receivedAt(), observation.price().eventTime()).abs()))
                .map(observation -> new MarketClockSnapshot(observation.status(), observation.skewMs()))
                .orElseGet(() -> new MarketClockSnapshot(MarkPriceTimePolicy.ClockStatus.UNAVAILABLE, null));
    }

    private MarkPriceTimePolicy.ClockStatus observeClock(LatestMarkPrice price, Instant now) {
        var status = MarkPriceTimePolicy.clockStatus(price);
        long skewMs = MarkPriceTimePolicy.skewMillis(price);
        var previous = clockObservations.put(price.tradingSymbolId(), new ClockObservation(status, skewMs, price));
        Instant lastLog = clockLoggedAt.get(price.tradingSymbolId());
        boolean changed = previous != null && previous.status() != status;
        boolean summaryDue = lastLog == null || !now.isBefore(lastLog.plus(CLOCK_LOG_INTERVAL));
        if (changed || (status != MarkPriceTimePolicy.ClockStatus.NORMAL && summaryDue)) {
            String format = "[Market clock] provider=BINANCE tradingSymbolId={} status={} eventTime={} receivedAt={} serverNow={} skewMs={} warningThresholdMs={} degradedThresholdMs={} rejectThresholdMs={}";
            Object[] fields = {price.tradingSymbolId(), status, price.eventTime(), price.receivedAt(), now, skewMs,
                    MarkPriceTimePolicy.WARNING_THRESHOLD.toMillis(), MarkPriceTimePolicy.DEGRADED_THRESHOLD.toMillis(),
                    MarkPriceTimePolicy.REJECT_THRESHOLD.toMillis()};
            if (status == MarkPriceTimePolicy.ClockStatus.REJECTED || status == MarkPriceTimePolicy.ClockStatus.DEGRADED) log.error(format, fields);
            else if (status == MarkPriceTimePolicy.ClockStatus.WARNING) log.warn(format, fields);
            else log.info(format, fields);
            clockLoggedAt.put(price.tradingSymbolId(), now);
        }
        return status;
    }
}
