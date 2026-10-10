package com.yogimangchi.trading.execution.trigger;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.marketdata.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class TradingEngineGateTests {
    @Test void redisRecoveryDoesNotEraseAnUnreconciledProducerGap() {
        RedisMarketDataBridge bridge=mock(RedisMarketDataBridge.class);
        when(bridge.health()).thenReturn(new RedisMarketDataBridge.Health(RedisMarketDataBridge.State.HEALTHY,0));
        TradingEngineGate gate=new TradingEngineGate(bridge);
        LatestMarkPrice price=new LatestMarkPrice(1L,BigDecimal.ONE,Instant.now(),Instant.now());
        var current=Map.of(1L,new LatestPriceStore.Snapshot(LatestPriceStore.Status.FRESH,Optional.of(price)));
        gate.processed(Map.of(1L,price),0); gate.requireCaughtUp(current);
        when(bridge.health()).thenReturn(new RedisMarketDataBridge.Health(RedisMarketDataBridge.State.UNAVAILABLE,1));
        assertThatThrownBy(() -> gate.requireCaughtUp(current)).isInstanceOf(BusinessException.class);
        when(bridge.health()).thenReturn(new RedisMarketDataBridge.Health(RedisMarketDataBridge.State.HEALTHY,1));
        assertThatThrownBy(() -> gate.requireCaughtUp(current)).isInstanceOf(BusinessException.class);
        gate.processed(Map.of(1L,price),1); gate.requireCaughtUp(current);
    }
    @Test void noProcessedSnapshotAndStoppedWorkerFailClosed() {
        RedisMarketDataBridge bridge=mock(RedisMarketDataBridge.class);
        when(bridge.health()).thenReturn(new RedisMarketDataBridge.Health(RedisMarketDataBridge.State.HEALTHY,0));
        TradingEngineGate gate=new TradingEngineGate(bridge);
        assertThat(gate.status()).isEqualTo("RECOVERING");
        gate.processed(Map.of(),0);
        LatestMarkPrice price=new LatestMarkPrice(1L,BigDecimal.ONE,Instant.now(),Instant.now());
        assertThatThrownBy(() -> gate.requireCaughtUp(Map.of(1L,new LatestPriceStore.Snapshot(LatestPriceStore.Status.FRESH,Optional.of(price)))))
                .isInstanceOf(BusinessException.class);
        gate.recovering(); assertThat(gate.status()).isEqualTo("RECOVERING");
    }
}
