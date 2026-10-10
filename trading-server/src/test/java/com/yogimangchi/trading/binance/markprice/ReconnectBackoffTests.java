package com.yogimangchi.trading.binance.markprice;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ReconnectBackoffTests {

    @Test
    void growsExponentiallyAndCapsAtThirtySecondsWithoutOverflow() {
        var backoff = new ReconnectBackoff(() -> 1.0);
        assertThat(java.util.stream.IntStream.rangeClosed(1, 8).mapToLong(backoff::delayMillis).toArray())
                .containsExactly(1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000);
        assertThat(backoff.delayMillis(Integer.MAX_VALUE)).isEqualTo(30000);
    }

    @Test
    void jitterIsBoundedAndRemainsEffectiveAtTheCap() {
        var low = new ReconnectBackoff(() -> 0.0);
        var middle = new ReconnectBackoff(() -> 0.5);
        assertThat(low.delayMillis(1)).isEqualTo(800);
        assertThat(middle.delayMillis(1)).isEqualTo(900);
        assertThat(low.delayMillis(20)).isEqualTo(24000);
        assertThat(middle.delayMillis(20)).isEqualTo(27000);
    }
}
