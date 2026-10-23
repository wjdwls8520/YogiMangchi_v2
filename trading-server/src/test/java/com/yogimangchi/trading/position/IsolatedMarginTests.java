package com.yogimangchi.trading.position;

import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.service.IsolatedMargin;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

import static org.assertj.core.api.Assertions.assertThat;

class IsolatedMarginTests {
    private final IsolatedMargin isolated = new IsolatedMargin();
    private static BigDecimal n(String value) { return new BigDecimal(value); }

    @Test void includesBothGrossMaintenanceAndActualClosingFeeReserve() {
        var risk = isolated.risk(Position.Side.LONG, n("1"), n("1000"), n("100"), n("1000"));
        assertThat(risk.equity()).isEqualByComparingTo("100");
        assertThat(risk.maintenanceMargin()).isEqualByComparingTo("5");
        assertThat(risk.closingFeeReserve()).isEqualByComparingTo("0.5");
        assertThat(risk.buffer()).isEqualByComparingTo("94.5");
        assertThat(risk.atRisk()).isFalse();
    }

    @ParameterizedTest @CsvSource({"LONG,89", "SHORT,111"})
    void riskDoesNotRequireWalletOrOtherPositionsToCoverALoss(Position.Side side, String mark) {
        assertThat(isolated.risk(side, n("1"), n("100"), n("10"), n(mark)).atRisk()).isTrue();
    }

    @Test void hedgeProfitDoesNotPreventTheOtherDirectionLiquidating() {
        var longRisk = isolated.risk(Position.Side.LONG, n("1"), n("100"), n("10"), n("89"));
        var shortRisk = isolated.risk(Position.Side.SHORT, n("1"), n("100"), n("10"), n("89"));
        assertThat(longRisk.atRisk()).isTrue();
        assertThat(shortRisk.atRisk()).isFalse();
        assertThat(shortRisk.equity()).isEqualByComparingTo("21");
    }

    @ParameterizedTest @EnumSource(Position.Side.class)
    void roundedRiskChangesAtTheCorrectSideOfTheAnalyticThreshold(Position.Side side) {
        // Validate the engine condition itself; do not trust a pre-rounded display formula.
        BigDecimal rate = n("0.0055"), q = n("1"), basis = n("100"), margin = n("10");
        BigDecimal boundary = side == Position.Side.LONG
                ? basis.subtract(margin).divide(BigDecimal.ONE.subtract(rate), 18, RoundingMode.CEILING)
                : basis.add(margin).divide(BigDecimal.ONE.add(rate), 18, RoundingMode.FLOOR);
        BigDecimal far = n(side == Position.Side.LONG ? "-0.000000000000000010" : "0.000000000000000010");
        assertThat(isolated.risk(side, q, basis, margin, boundary.add(far)).atRisk()).isTrue();
        assertThat(isolated.risk(side, q, basis, margin, boundary.subtract(far)).atRisk()).isFalse();
    }

    @Test void actualGapFillPnlAndFeeArePreservedWhileWalletLossIsLimitedToAllocatedMargin() {
        var settlement = isolated.liquidationSettlement(n("10"), n("-20"), isolated.liquidationFee(n("80"), n("1")));
        assertThat(settlement.grossPnl()).isEqualByComparingTo("-20");
        assertThat(settlement.fee()).isEqualByComparingTo("0.04");
        assertThat(settlement.shortfallAdjustment()).isEqualByComparingTo("10.04");
        assertThat(settlement.walletDelta()).isEqualByComparingTo("-10");
    }

    @Test void noAdjustmentIsInventedWhenCollateralCoversTheActualLossAndFee() {
        var settlement = isolated.liquidationSettlement(n("10"), n("-9"), n("0.0455"));
        assertThat(settlement.shortfallAdjustment()).isZero();
        assertThat(settlement.walletDelta()).isEqualByComparingTo("-9.0455");
    }

    @Test void tinyFeesAndMaintenanceRoundUpRatherThanDisappear() {
        var risk = isolated.risk(Position.Side.LONG, n("0.00000001"), n("0.000000000000000001"), n("0.000000000000000001"), n("0.0000000001"));
        assertThat(risk.maintenanceMargin()).isEqualByComparingTo("0.000000000000000001");
        assertThat(risk.closingFeeReserve()).isEqualByComparingTo("0.000000000000000001");
        assertThat(risk.atRisk()).isTrue();
    }

    @ParameterizedTest @EnumSource(Position.Side.class)
    void changingOnlyAllocatedCollateralChangesRiskWithoutChangingGrossPnl(Position.Side side) {
        var smaller = isolated.risk(side, n("1"), n("100"), n("1"), n("100"));
        var larger = isolated.risk(side, n("1"), n("100"), n("100"), n("100"));
        assertThat(larger.unrealizedPnl()).isEqualByComparingTo(smaller.unrealizedPnl());
        assertThat(larger.buffer().subtract(smaller.buffer())).isEqualByComparingTo("99");
    }
}
