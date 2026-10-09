package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.position.entity.Position;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TradingMathTests {
    private static BigDecimal n(String value) { return new BigDecimal(value); }

    @Test
    void longAndShortPnlUseDomainQuantityAndExactDecimals() {
        assertThat(TradingMath.pnl(Position.Side.LONG, n("100"), n("120"), n("3.5"))).isEqualByComparingTo("70");
        assertThat(TradingMath.pnl(Position.Side.SHORT, n("100"), n("120"), n("3.5"))).isEqualByComparingTo("-70");
        assertThat(TradingMath.pnl(Position.Side.LONG, n("0.000003"), n("0.000004"), n("1000000")))
                .isEqualByComparingTo("1");
        assertThat(TradingMath.pnl(Position.Side.SHORT, n("0.3"), n("0.2"), n("0.3"))).isEqualByComparingTo("0.03");
    }

    @Test
    void marginAlwaysRoundsUpButPnlUsesHalfEvenAtEighteenDecimals() {
        assertThat(TradingMath.margin(n("1"), n("1"), 3)).isEqualByComparingTo("0.333333333333333334");
        assertThat(TradingMath.amount(n("0.0000000000000000005"))).isEqualByComparingTo("0");
        assertThat(TradingMath.amount(n("0.0000000000000000015"))).isEqualByComparingTo("0.000000000000000002");
    }

    @Test
    void lossesReduceBuyingPowerWhileUnrealizedGainsCannotFundMargin() {
        assertThat(TradingMath.available(n("10000"), n("2000"), n("1000"), n("-5000")))
                .isEqualByComparingTo("2000");
        assertThat(TradingMath.available(n("10000"), n("2000"), n("1000"), n("5000")))
                .isEqualByComparingTo("7000");
        assertThat(TradingMath.available(n("10000"), n("2000"), n("1000"), n("-11000")))
                .isEqualByComparingTo("0");
    }

    @Test
    void supportedNotionalBoundariesIncludeSmallDomainPrices() {
        TradingMath.validateOrder(n("1"), 1, n("1"));
        TradingMath.validateOrder(n("1000000000000"), 20, n("0.000001"));
        assertThatThrownBy(() -> TradingMath.validateOrder(n("0.1"), 1, n("1"))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> TradingMath.validateOrder(n("1000001"), 20, n("1"))).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void invalidQuantityAndLeverageAreRejectedInsteadOfSilentlyRounded() {
        for (String quantity : new String[]{"0", "-1", "1.000000001", "1000000000001"}) {
            assertThatThrownBy(() -> TradingMath.validateOrder(n(quantity), 10, n("100")))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        assertThatThrownBy(() -> TradingMath.validateOrder(n("1"), 0, n("100"))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> TradingMath.validateOrder(n("1"), 21, n("100"))).isInstanceOf(IllegalArgumentException.class);
    }
}
