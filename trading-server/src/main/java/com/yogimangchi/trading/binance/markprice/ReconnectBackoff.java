package com.yogimangchi.trading.binance.markprice;

import java.util.function.DoubleSupplier;

final class ReconnectBackoff {

    private final DoubleSupplier random;

    ReconnectBackoff(DoubleSupplier random) {
        this.random = random;
    }

    long delayMillis(int attempt) {
        long ceiling = Math.min(30_000L, 1_000L << Math.min(5, Math.max(0, attempt - 1)));
        // Jitter remains effective at the cap: 80..100% of 1, 2, 4, 8, 16, 30 seconds.
        return (long) (ceiling * (0.8 + 0.2 * random.getAsDouble()));
    }
}
