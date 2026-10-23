package com.yogimangchi.trading.execution.trigger;

import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class TradingEngineStatusControllerTests {
    @Test void reportsReceiverClockIndependentlyOfEngineReadiness() {
        var gate = mock(TradingEngineGate.class);
        when(gate.status()).thenReturn("READY");
        Instant now = Instant.parse("2026-10-15T00:00:00Z");
        var prices = new LatestPriceStore(Clock.fixed(now, ZoneOffset.UTC));
        prices.beginSubscription(Set.of(1L));
        prices.update(new LatestMarkPrice(1L, BigDecimal.TEN, now.plusSeconds(2), now));
        var status = new TradingEngineStatusController(gate, prices).status();
        assertThat(status.status()).isEqualTo("READY");
        assertThat(status.marketClockStatus().name()).isEqualTo("WARNING");
        assertThat(status.clockSkewMs()).isEqualTo(2000L);
        verify(gate, never()).recovering();
    }

    @Test void unavailableClockDoesNotInventAZeroSkew() {
        var status = new TradingEngineStatusController(mock(TradingEngineGate.class), new LatestPriceStore()).status();
        assertThat(status.marketClockStatus().name()).isEqualTo("UNAVAILABLE");
        assertThat(status.clockSkewMs()).isNull();
    }
}
