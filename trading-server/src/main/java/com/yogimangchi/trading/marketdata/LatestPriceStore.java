package com.yogimangchi.trading.marketdata;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;

/** Small, synchronized snapshots: price, subscription availability and freshness are read atomically. */
@Component
public class LatestPriceStore {
    private static final Duration FRESH_FOR = Duration.ofSeconds(5);
    private static final Duration MAX_CLOCK_SKEW = Duration.ofSeconds(1);
    private final Clock clock;
    private final Map<Long, LatestMarkPrice> prices = new HashMap<>();
    private final Set<Long> available = new HashSet<>();
    private Set<Long> subscribed = Set.of();
    private boolean accepting;

    public enum Status { MISSING, FRESH, STALE, UNAVAILABLE }

    public record Snapshot(Status status, Optional<LatestMarkPrice> latestPrice) { }

    @Autowired
    public LatestPriceStore() {
        this(Clock.systemUTC());
    }

    public LatestPriceStore(Clock clock) {
        this.clock = clock;
    }

    public synchronized void beginSubscription(Set<Long> tradingSymbolIds) {
        subscribed = Set.copyOf(tradingSymbolIds);
        prices.keySet().retainAll(subscribed);
        available.clear();
        accepting = true;
    }

    public synchronized void markUnavailable() {
        accepting = false;
        available.clear();
    }

    public synchronized boolean update(LatestMarkPrice price) {
        if (!accepting || !subscribed.contains(price.tradingSymbolId()) || !isFresh(price, clock.instant())) {
            return false;
        }
        LatestMarkPrice previous = prices.get(price.tradingSymbolId());
        // Replayed/out-of-order events must not move prices backwards or make old data look fresh.
        if (previous != null && !price.eventTime().isAfter(previous.eventTime())) {
            return false;
        }
        prices.put(price.tradingSymbolId(), price);
        available.add(price.tradingSymbolId());
        return true;
    }

    public synchronized Snapshot find(Long tradingSymbolId) {
        LatestMarkPrice price = prices.get(tradingSymbolId);
        if (price == null) {
            return new Snapshot(Status.MISSING, Optional.empty());
        }
        Status status = !available.contains(tradingSymbolId) ? Status.UNAVAILABLE
                : isFresh(price, clock.instant()) ? Status.FRESH : Status.STALE;
        return new Snapshot(status, Optional.of(price));
    }

    private boolean isFresh(LatestMarkPrice price, Instant now) {
        return recent(price.eventTime(), now) && recent(price.receivedAt(), now);
    }

    private boolean recent(Instant time, Instant now) {
        return time.isAfter(now.minus(FRESH_FOR)) && !time.isAfter(now.plus(MAX_CLOCK_SKEW));
    }
}
