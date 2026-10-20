package com.yogimangchi.trading.tradingaccount;

import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.service.IsolatedMargin;
import com.yogimangchi.trading.tradingaccount.service.LiquidationPriceEstimator;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.assertThat;
import static com.yogimangchi.trading.tradingaccount.service.LiquidationPriceEstimator.Status.*;

class LiquidationPriceEstimatorTests {
    private static final Instant NOW = Instant.parse("2026-10-20T00:00:00Z");
    private static final BigDecimal TICK = n("0.000000000000000001");
    private final IsolatedMargin isolated = new IsolatedMargin();
    private final LiquidationPriceEstimator estimator = new LiquidationPriceEstimator(isolated);
    private long nextId;

    @ParameterizedTest @CsvSource({"LONG,1", "LONG,10", "LONG,14", "LONG,100", "SHORT,1", "SHORT,10", "SHORT,14", "SHORT,100"})
    void reportsVerifiedPositionBoundaryAtEverySupportedLeverage(Position.Side side, int leverage) {
        var p = position(1, side, "100", "1000", leverage);
        var result = estimate(List.of(p), Map.of(1L, fresh(1, "1000", NOW))).get(p.getId());
        if (side == Position.Side.LONG && leverage == 1) {
            assertThat(result.status()).isEqualTo(NO_THRESHOLD);
            assertThat(result.price()).isNull();
        } else assertBoundary(p, result);
    }

    @Test void eachHedgeSideHasItsOwnCollateralBoundaryEvenAtZeroNetExposure() {
        var longP = position(1, Position.Side.LONG, "100", "1000", 100);
        var shortP = position(1, Position.Side.SHORT, "100", "1000", 100);
        var estimates = estimate(List.of(longP, shortP), Map.of(1L, fresh(1, "1000", NOW)));
        assertBoundary(longP, estimates.get(longP.getId()));
        assertBoundary(shortP, estimates.get(shortP.getId()));
        assertThat(estimates.get(longP.getId()).status()).isEqualTo(ESTIMATED_DOWNWARD);
        assertThat(estimates.get(shortP.getId()).status()).isEqualTo(ESTIMATED_UPWARD);
        assertThat(estimates.get(longP.getId()).price()).isNotEqualByComparingTo(estimates.get(shortP.getId()).price());
    }

    @Test void addingAnotherSymbolsLossDoesNotChangeThisPositionsThresholdOrAsOf() {
        var btc = position(1, Position.Side.LONG, "10", "1000", 10);
        var eth = position(2, Position.Side.SHORT, "10", "100", 10);
        var mark = fresh(1, "1000", NOW);
        var before = estimate(List.of(btc), Map.of(1L, mark)).get(btc.getId());
        var after = estimate(List.of(btc, eth), Map.of(1L, mark, 2L, fresh(2, "120", NOW.minusSeconds(2))));
        assertThat(after.get(btc.getId())).isEqualTo(before);
        assertThat(after.get(eth.getId()).status()).isEqualTo(ALREADY_AT_RISK);
    }

    @ParameterizedTest @EnumSource(value = LatestPriceStore.Status.class, names = {"MISSING", "STALE", "UNAVAILABLE"})
    void unrelatedUnavailableSymbolDoesNotHideAValidIsolatedEstimate(LatestPriceStore.Status status) {
        var btc = position(1, Position.Side.LONG, "10", "1000", 10);
        var eth = position(2, Position.Side.SHORT, "10", "100", 10);
        var estimates = estimate(List.of(btc, eth), Map.of(1L, fresh(1, "1000", NOW),
                2L, new LatestPriceStore.Snapshot(status, Optional.empty())));
        assertBoundary(btc, estimates.get(btc.getId()));
        assertThat(estimates.get(eth.getId()).status()).isEqualTo(PRICE_UNAVAILABLE);
        assertThat(estimates.get(eth.getId()).price()).isNull();
        assertThat(estimates.get(eth.getId()).asOf()).isNull();
    }

    @Test void missingTargetPriceIsUnavailableWithoutLeakingTheLastEstimate() {
        var p = position(1, Position.Side.LONG, "10", "1000", 10);
        assertBoundary(p, estimate(List.of(p), Map.of(1L, fresh(1, "1000", NOW))).get(p.getId()));
        var result = estimate(List.of(p), Map.of()).get(p.getId());
        assertThat(result.status()).isEqualTo(PRICE_UNAVAILABLE);
        assertThat(result.price()).isNull();
    }

    @Test void legacyConversionDoesNotLabelACrossThresholdAsIsolated() {
        var p = position(1, Position.Side.LONG, "10", "1000", 10);
        var result = estimator.estimate(List.of(p), Map.of(1L, fresh(1, "1000", NOW)), false).get(p.getId());
        assertThat(result.status()).isEqualTo(MARGIN_MIGRATION_REQUIRED);
        assertThat(result.price()).isNull();
        assertThat(result.asOf()).isNull();
    }

    @ParameterizedTest @EnumSource(Position.Side.class)
    void alreadyAtRiskIsAboutThisPositionEvenWithUnboundedUnusedWalletCash(Position.Side side) {
        var p = position(1, side, "10", "1000", 100);
        var result = estimate(List.of(p), Map.of(1L, fresh(1, side == Position.Side.LONG ? "900" : "1100", NOW))).get(p.getId());
        assertThat(result.status()).isEqualTo(ALREADY_AT_RISK);
        assertThat(result.price()).isNull();
        assertThat(result.asOf()).isEqualTo(NOW);
    }

    @Test void sameDirectionAdditionalEntryUsesRemainingExactBasisAndAllocatedMargin() {
        var p = position(1, Position.Side.LONG, "20", "1000", 10);
        var before = estimate(List.of(p), Map.of(1L, fresh(1, "1100", NOW))).get(p.getId());
        p.increase(n("5"), n("1100"));
        var after = estimate(List.of(p), Map.of(1L, fresh(1, "1100", NOW))).get(p.getId());
        assertThat(p.getEntryPrice()).isEqualByComparingTo("1020");
        assertThat(after.price()).isNotEqualByComparingTo(before.price());
        assertBoundary(p, after);
    }

    @Test void partialCloseKeepsItsProportionalCollateralAndFullCloseLeavesNoEstimate() {
        var p = position(1, Position.Side.LONG, "100", "1000", 10);
        var before = estimate(List.of(p), Map.of(1L, fresh(1, "1100", NOW))).get(p.getId());
        p.close(n("25"), n("1100"), NOW, false);
        var after = estimate(List.of(p), Map.of(1L, fresh(1, "1100", NOW))).get(p.getId());
        assertThat(after.price()).isEqualByComparingTo(before.price());
        assertBoundary(p, after);
        p.close(p.getQuantity(), n("1100"), NOW, false);
        assertThat(estimate(List.of(), Map.of())).isEmpty();
    }

    @Test void changingLeverageReallocatesCollateralAndMovesTheThreshold() {
        var p = position(1, Position.Side.LONG, "100", "1000", 10);
        var before = estimate(List.of(p), Map.of(1L, fresh(1, "1000", NOW))).get(p.getId());
        p.changeLeverage(100);
        var after = estimate(List.of(p), Map.of(1L, fresh(1, "1000", NOW))).get(p.getId());
        assertThat(after.price()).isGreaterThan(before.price());
        assertBoundary(p, after);
    }

    @Test void closeQuantityReservationDoesNotMoveLiquidationCollateral() {
        var p = position(1, Position.Side.LONG, "100", "1000", 10);
        var before = estimate(List.of(p), Map.of(1L, fresh(1, "1000", NOW))).get(p.getId());
        p.reserveClose(n("70"));
        assertThat(estimate(List.of(p), Map.of(1L, fresh(1, "1000", NOW))).get(p.getId())).isEqualTo(before);
    }

    @ParameterizedTest @CsvSource({"LONG,0.00000001,100000000", "SHORT,0.00000001,100000000", "LONG,1000000000000,0.000001", "SHORT,1000000000000,0.000001"})
    void tinyQuantitiesAndAssetPricesUseTheActualRoundedRisk(Position.Side side, String quantity, String entry) {
        var p = position(1, side, quantity, entry, 100);
        assertBoundary(p, estimate(List.of(p), Map.of(1L, fresh(1, entry, NOW))).get(p.getId()));
    }

    @Test void safePointOneUlpBeforeTheBoundaryStillHasACertifiedNumericThreshold() {
        var p = position(1, Position.Side.LONG, "1", "1000", 100);
        var initial = estimate(List.of(p), Map.of(1L, fresh(1, "1000", NOW))).get(p.getId());
        var result = estimate(List.of(p), Map.of(1L, fresh(1, initial.price().add(TICK).toPlainString(), NOW))).get(p.getId());
        assertThat(result.price()).isEqualByComparingTo(initial.price());
        assertBoundary(p, result);
    }

    private void assertBoundary(Position p, LiquidationPriceEstimator.Estimate result) {
        assertThat(result.price()).as("estimate status %s", result.status()).isPositive();
        assertThat(isolated.risk(p, result.price()).atRisk()).isTrue();
        BigDecimal nearer = result.price().add(p.getSide() == Position.Side.LONG ? TICK : TICK.negate());
        assertThat(isolated.risk(p, nearer).atRisk()).isFalse();
    }
    private Map<Long, LiquidationPriceEstimator.Estimate> estimate(List<Position> open, Map<Long, LatestPriceStore.Snapshot> marks) {
        return estimator.estimate(open, marks, true);
    }
    private Position position(long symbol, Position.Side side, String quantity, String entry, int leverage) {
        var p = Position.open(1L, symbol, side, n(quantity), n(entry), leverage, NOW.minusSeconds(10));
        ReflectionTestUtils.setField(p, "id", ++nextId);
        return p;
    }
    private static LatestPriceStore.Snapshot fresh(long symbol, String price, Instant at) {
        return new LatestPriceStore.Snapshot(LatestPriceStore.Status.FRESH, Optional.of(new LatestMarkPrice(symbol, n(price), at, at)));
    }
    private static BigDecimal n(String value) { return new BigDecimal(value); }
}
