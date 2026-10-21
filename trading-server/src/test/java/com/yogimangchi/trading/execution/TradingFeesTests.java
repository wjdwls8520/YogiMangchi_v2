package com.yogimangchi.trading.execution;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class TradingFeesTests {
    @Test void feesUseActualNotionalAndKeepTinyCloseCostsOnTheLedger() {
        assertThat(TradingFees.fee(n("1000"),n("2"),n("0.0005"))).isEqualByComparingTo("1");
        assertThat(TradingFees.fee(n("980"),n("2"),n("0.0003"))).isEqualByComparingTo("0.588");
        assertThat(TradingFees.fee(n("0.000000000001"),n("0.00000001"),n("0.0005")))
                .isEqualByComparingTo("0.000000000000000001");
        assertThat(TradingFees.fee(n("1000"),n("1"),BigDecimal.ZERO)).isZero();
    }
    @Test void negativeOrUnsupportedFeeRatesCannotCreditCash() {
        assertThatThrownBy(() -> TradingFees.fee(n("1000"),n("1"),n("-0.0005"))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> TradingFees.fee(n("1000"),n("1"),n("0.02"))).isInstanceOf(IllegalArgumentException.class);
    }
    private static BigDecimal n(String value) { return new BigDecimal(value); }
}
