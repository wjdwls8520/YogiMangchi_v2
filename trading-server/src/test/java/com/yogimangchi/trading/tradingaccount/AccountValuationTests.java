package com.yogimangchi.trading.tradingaccount;

import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.service.AccountValuation;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AccountValuationTests {
    private static final Instant NOW = Instant.parse("2026-10-09T00:00:00Z");
    private static BigDecimal n(String value) { return new BigDecimal(value); }
    private final LatestPriceStore prices = new LatestPriceStore(Clock.fixed(NOW, java.time.ZoneOffset.UTC));
    private final AccountValuation valuation = new AccountValuation(prices);

    @Test
    void sharedAccountEquityIncludesLongAndShortAcrossSymbols() {
        Wallet wallet = Wallet.open(1L);
        var longPosition = Position.open(1L, 1L, Position.Side.LONG, n("10"), n("100"), 10, NOW);
        var shortPosition = Position.open(1L, 2L, Position.Side.SHORT, n("5"), n("200"), 10, NOW);
        wallet.openMargin(longPosition.getMargin());
        wallet.openMargin(shortPosition.getMargin());
        prices.beginSubscription(Set.of(1L, 2L));
        prices.update(new LatestMarkPrice(1L, n("110"), NOW, NOW));
        prices.update(new LatestMarkPrice(2L, n("180"), NOW, NOW));
        var value = valuation.calculate(wallet, List.of(longPosition, shortPosition));
        assertThat(value.fresh()).isTrue();
        assertThat(value.unrealizedPnl()).isEqualByComparingTo("200");
        assertThat(value.equity()).isEqualByComparingTo("10200");
        assertThat(value.availableBalance()).isEqualByComparingTo("9800");
        assertThat(value.maintenanceMargin()).isEqualByComparingTo("10");
    }

    @Test
    void oneUnavailableHeldSymbolMakesAggregateValuationUnknown() {
        Wallet wallet = Wallet.open(1L);
        var first = Position.open(1L, 1L, Position.Side.LONG, n("10"), n("100"), 10, NOW);
        var missing = Position.open(1L, 2L, Position.Side.SHORT, n("5"), n("200"), 10, NOW);
        prices.beginSubscription(Set.of(1L, 2L));
        prices.update(new LatestMarkPrice(1L, n("110"), NOW, NOW));
        var value = valuation.calculate(wallet, List.of(first, missing));
        assertThat(value.fresh()).isFalse();
        assertThat(value.unrealizedPnl()).isNull();
        assertThat(value.equity()).isNull();
        assertThat(value.availableBalance()).isNull();
        assertThat(value.maintenanceMargin()).isNull();
        assertThat(value.prices().get(1L).status()).isEqualTo(LatestPriceStore.Status.FRESH);
        assertThat(value.prices().get(2L).status()).isEqualTo(LatestPriceStore.Status.MISSING);
    }

    @Test
    void connectionFailureInvalidatesRiskAssessmentEvenWithRecentTimestamps() {
        var position = Position.open(1L, 1L, Position.Side.LONG, n("10"), n("100"), 10, NOW);
        prices.beginSubscription(Set.of(1L));
        prices.update(new LatestMarkPrice(1L, n("110"), NOW, NOW));
        prices.markUnavailable();
        var value = valuation.calculate(Wallet.open(1L), List.of(position));
        assertThat(value.fresh()).isFalse();
        assertThat(value.availableBalance()).isNull();
    }

    @Test
    void accountWithoutPositionsHasKnownCashEvenBeforeMarketDataArrives() {
        var value = valuation.calculate(Wallet.open(1L), List.of());
        assertThat(value.fresh()).isTrue();
        assertThat(value.unrealizedPnl()).isZero();
        assertThat(value.equity()).isEqualByComparingTo("10000");
        assertThat(value.availableBalance()).isEqualByComparingTo("10000");
    }
}
