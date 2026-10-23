package com.yogimangchi.trading.marketdata.orderbook;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/** Display-only complete top-20 snapshot, never an execution price or available liquidity. */
public record OrderBookSnapshot(long tradingSymbolId, List<Level> bids, List<Level> asks,
                                long providerUpdateId, Instant eventTime, Instant receivedAt) {
    public static final Duration FRESHNESS = Duration.ofSeconds(3);

    public record Level(String price, String quantity) {
        public Level { positive(price); positive(quantity); }
        private static void positive(String value) {
            if (value == null || value.length() > 120 || !value.matches("[0-9]+(\\.[0-9]+)?")
                    || new BigDecimal(value).signum() <= 0) throw new IllegalArgumentException("Invalid book level");
        }
    }

    public OrderBookSnapshot {
        if (tradingSymbolId <= 0 || providerUpdateId <= 0 || eventTime == null || receivedAt == null
                || !eventTime.isAfter(Instant.EPOCH) || !receivedAt.isAfter(Instant.EPOCH)) {
            throw new IllegalArgumentException("Invalid book identity/time");
        }
        bids = List.copyOf(bids); asks = List.copyOf(asks);
        ordered(bids, false); ordered(asks, true);
        if (new BigDecimal(bids.get(0).price()).compareTo(new BigDecimal(asks.get(0).price())) >= 0) {
            throw new IllegalArgumentException("Crossed order book");
        }
    }

    private static void ordered(List<Level> levels, boolean ascending) {
        if (levels.isEmpty() || levels.size() > 20) throw new IllegalArgumentException("Invalid book depth");
        for (int i = 1; i < levels.size(); i++) {
            int comparison = new BigDecimal(levels.get(i).price()).compareTo(new BigDecimal(levels.get(i - 1).price()));
            if (ascending ? comparison <= 0 : comparison >= 0) throw new IllegalArgumentException("Unordered book");
        }
    }

    public boolean isFreshAt(Instant now) {
        return receivedAt.isAfter(now.minus(FRESHNESS)) && !receivedAt.isAfter(now.plusSeconds(1))
                && !eventTime.isBefore(receivedAt.minus(FRESHNESS)) && !eventTime.isAfter(receivedAt.plusSeconds(10));
    }

    public boolean newerThan(OrderBookSnapshot previous) {
        return previous == null || providerUpdateId > previous.providerUpdateId && !eventTime.isBefore(previous.eventTime);
    }
}
