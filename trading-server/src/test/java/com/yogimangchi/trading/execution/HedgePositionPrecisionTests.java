package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.position.entity.Position;
import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class HedgePositionPrecisionTests {
    private static final Instant NOW=Instant.parse("2026-10-19T00:00:00Z");
    private static BigDecimal n(String value) { return new BigDecimal(value); }

    @Test void oneThousandRepeatingAveragesPreserveCostBasisAndZeroProfitAtBreakEven() {
        var p=Position.open(1L,1L,Position.Side.LONG,n("0.1"),n("1000.123456789012345678"),100,NOW);
        BigDecimal basis=p.getEntryNotional();
        for(int i=0;i<1000;i++) {
            BigDecimal price=n(i%2==0 ? "1001.123456789012345678" : "999.123456789012345678");
            p.increase(n("0.1"),price); basis=basis.add(n("0.1").multiply(price));
        }
        assertThat(p.getEntryNotional()).isEqualByComparingTo(basis);
        assertThat(p.unrealizedPnl(n("1000.123456789012345678"))).isZero();
        p.reserveClose(n("0.1")); p.changeLeverage(21);
        assertThat(p.getReservedCloseQuantity()).isEqualByComparingTo("0.1");
        p.releaseCloseReservation(n("0.1"));
        var result=p.close(p.getQuantity(),n("1000.123456789012345678"),NOW.plusSeconds(1),false);
        assertThat(result.realizedPnl()).isZero(); assertThat(p.getEntryNotional()).isZero(); assertThat(p.getMargin()).isZero();
    }

    @Test void partialCloseAndRepeatedAddsPreserveRealizedProfitAndReservedQuantity() {
        var p=Position.open(1L,1L,Position.Side.SHORT,n("1"),n("100"),3,NOW);
        p.close(n("0.25"),n("90"),NOW.plusSeconds(1),false);
        p.reserveClose(n("0.25"));
        p.increase(n("0.25"),n("80"));
        assertThat(p.getEntryPrice()).isEqualByComparingTo("95");
        assertThat(p.getRealizedPnl()).isEqualByComparingTo("2.5");
        assertThat(p.getFreeCloseQuantity()).isEqualByComparingTo("0.75");
        p.changeLeverage(1);
        assertThat(p.getMargin()).isEqualByComparingTo("95");
        assertThat(p.getRealizedPnl()).isEqualByComparingTo("2.5");
    }

    @Test void dustSizeRemainderCanChangeLeverageAndCloseWithoutNewOrderMinimum() {
        var p=Position.open(1L,1L,Position.Side.LONG,n("1"),n("1"),3,NOW);
        p.close(n("0.99999999"),n("1"),NOW.plusSeconds(1),false);
        p.changeLeverage(100);
        assertThat(p.getMargin()).isEqualByComparingTo("0.0000000001");
        p.close(p.getQuantity(),n("1"),NOW.plusSeconds(2),false);
        assertThat(p.getMargin()).isZero(); assertThat(p.getEntryNotional()).isZero();
    }

    @Test void cumulativePositionNotionalCapAndClosedLifecycleAreEnforced() {
        var p=Position.open(1L,1L,Position.Side.LONG,n("1"),n("1000000"),100,NOW);
        assertThatThrownBy(() -> p.increase(n("0.000001"),n("1000000"))).isInstanceOf(IllegalArgumentException.class);
        assertThat(p.getQuantity()).isEqualByComparingTo("1");
        p.close(p.getQuantity(),n("1000000"),NOW.plusSeconds(1),false);
        assertThatThrownBy(() -> p.increase(n("1"),n("1"))).isInstanceOf(IllegalStateException.class);
    }
}
