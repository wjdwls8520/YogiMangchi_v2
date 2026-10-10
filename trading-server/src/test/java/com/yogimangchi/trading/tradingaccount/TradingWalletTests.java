package com.yogimangchi.trading.tradingaccount;

import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TradingWalletTests {
    private static BigDecimal n(String value) { return new BigDecimal(value); }

    @Test
    void reservationAndInitialMarginDoNotSpendOrManufactureCash() {
        Wallet wallet = Wallet.open(1L);
        wallet.reserve(n("1000"));
        wallet.releaseReservation(n("400"));
        wallet.openMargin(n("2000"));
        assertThat(wallet.getBalance()).isEqualByComparingTo("10000");
        assertThat(wallet.getUsedMargin()).isEqualByComparingTo("2000");
        assertThat(wallet.getReservedMargin()).isEqualByComparingTo("600");
        assertThat(wallet.getRealizedPnl()).isZero();
    }

    @Test
    void settlementReleasesMarginAndAddsActualRealizedPnl() {
        Wallet wallet = Wallet.open(1L);
        wallet.openMargin(n("2000"));
        wallet.settle(n("1000"), n("-200"));
        wallet.settle(n("1000"), n("50"));
        assertThat(wallet.getBalance()).isEqualByComparingTo("9850");
        assertThat(wallet.getRealizedPnl()).isEqualByComparingTo("-150");
        assertThat(wallet.getUsedMargin()).isZero();
    }

    @Test
    void gapLossIsNotClampedToInitialMarginOrCash() {
        Wallet wallet = Wallet.open(1L);
        wallet.openMargin(n("1000"));
        wallet.settle(n("1000"), n("-12000"));
        assertThat(wallet.getBalance()).isEqualByComparingTo("-2000");
        assertThat(wallet.getRealizedPnl()).isEqualByComparingTo("-12000");
        assertThat(wallet.getUsedMargin()).isZero();
    }

    @Test
    void overReleaseAndNegativeReservationCannotCorruptWallet() {
        Wallet wallet = Wallet.open(1L);
        wallet.reserve(n("100"));
        wallet.openMargin(n("50"));
        assertThatThrownBy(() -> wallet.releaseReservation(n("101"))).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> wallet.settle(n("51"), BigDecimal.ZERO)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> wallet.reserve(n("-1"))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> wallet.openMargin(n("-1"))).isInstanceOf(IllegalArgumentException.class);
        assertThat(wallet.getBalance()).isEqualByComparingTo("10000");
        assertThat(wallet.getReservedMargin()).isEqualByComparingTo("100");
        assertThat(wallet.getUsedMargin()).isEqualByComparingTo("50");
    }
}
