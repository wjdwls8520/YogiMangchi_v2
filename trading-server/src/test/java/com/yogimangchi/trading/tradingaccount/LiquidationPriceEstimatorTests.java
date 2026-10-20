package com.yogimangchi.trading.tradingaccount;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.service.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import static com.yogimangchi.trading.tradingaccount.service.LiquidationPriceEstimator.Status.*;
import static org.assertj.core.api.Assertions.*;

class LiquidationPriceEstimatorTests {
    static final Instant NOW=Instant.parse("2026-10-19T00:00:00Z");
    static final BigDecimal TICK=new BigDecimal("0.000000000000000001");
    final LatestPriceStore prices=new LatestPriceStore(Clock.fixed(NOW,ZoneOffset.UTC));
    final AccountValuation valuation=new AccountValuation(prices);
    final LiquidationPriceEstimator estimator=new LiquidationPriceEstimator(valuation);
    final Wallet wallet=Wallet.open(1L);

    @ParameterizedTest @EnumSource(Position.Side.class)
    void singleDirectionReturnsFirstRoundedEngineRiskPrice(Position.Side side) {
        var p=position(1L,side,"100","1000",10);
        var open=List.of(p); marks(Map.of(1L,"1000"));
        var result=estimate(open).get(1L);
        assertThat(result.status()).isEqualTo(side==Position.Side.LONG?ESTIMATED_DOWNWARD:ESTIMATED_UPWARD);
        assertThat(result.price()).isBetween(n(side==Position.Side.LONG?"904":"1094"),n(side==Position.Side.LONG?"905":"1095"));
        assertEngineBoundary(open,1L,result);
        assertThat(result.asOf()).isEqualTo(NOW);
    }

    @Test void hedgeMovesBothSidesAndUsesGrossMaintenanceRatherThanNetExposure() {
        var open=List.of(position(1L,Position.Side.LONG,"100","1000",100),position(1L,Position.Side.SHORT,"50","1000",100));
        marks(Map.of(1L,"1000")); var result=estimate(open).get(1L);
        assertThat(result.status()).isEqualTo(ESTIMATED_DOWNWARD);
        assertThat(result.price()).isBetween(n("812"),n("813"));
        assertEngineBoundary(open,1L,result);
    }

    @Test void zeroNetQuantityStillHasAnUpwardGrossMaintenanceThreshold() {
        var open=List.of(position(1L,Position.Side.LONG,"10","1000",10),position(1L,Position.Side.SHORT,"10","1000",10));
        marks(Map.of(1L,"1000")); var result=estimate(open).get(1L);
        assertThat(result.status()).isEqualTo(ESTIMATED_UPWARD);
        assertThat(result.price()).isEqualByComparingTo("99999.999999999999999981"); // CEILING maintenance reaches the boundary before the unrounded root.
        assertEngineBoundary(open,1L,result);
    }

    @Test void otherSymbolsMarksStayFixedAndTheirLossAndMaintenanceShiftTheThreshold() {
        var btc=position(1L,Position.Side.LONG,"100","1000",10);
        var eth=position(2L,Position.Side.LONG,"1","200",10);
        var open=List.of(btc,eth); marks(Map.of(1L,"1000",2L,"100"));
        var estimate=estimate(open).get(1L);
        assertThat(estimate.price()).isBetween(n("905"),n("906"));
        assertThat(estimate.price()).isGreaterThan(estimate(List.of(btc)).get(1L).price());
        assertEngineBoundary(open,1L,estimate);
    }

    @Test void additionalEntryAndPartialCloseUseRemainingExactBasisAndRealizedCash() {
        var p=position(1L,Position.Side.LONG,"10","8000",100);
        wallet.openMargin(p.getMargin());
        wallet.openMargin(p.increase(n("2"),n("8500")));
        marks(Map.of(1L,"8500")); var open=List.of(p);
        assertEngineBoundary(open,1L,estimate(open).get(1L));
        var settled=p.close(n("3"),n("8500"),NOW.plusSeconds(1),false);
        wallet.settle(settled.releasedMargin(),settled.realizedPnl());
        var changed=estimate(open).get(1L);
        assertEngineBoundary(open,1L,changed);
        assertThat(p.getRealizedPnl()).isPositive();
        var last=p.close(p.getQuantity(),n("8500"),NOW.plusSeconds(2),false);
        wallet.settle(last.releasedMargin(),last.realizedPnl());
        assertThat(estimate(List.of())).isEmpty();
    }

    @ParameterizedTest @ValueSource(ints={1,10,14,100})
    void leverageAndReservationsDoNotEnterTheActualCrossRiskEquation(int leverage) {
        var p=position(1L,Position.Side.SHORT,"5","1000",10);
        wallet.openMargin(p.getMargin()); marks(Map.of(1L,"1000")); var open=List.of(p);
        var before=estimate(open).get(1L);
        wallet.reallocateMargin(p.marginAtLeverage(leverage),n("100")); p.changeLeverage(leverage);
        p.reserveClose(n("1"));
        assertThat(estimate(open).get(1L)).isEqualTo(before);
        assertThat(p.getReservedCloseQuantity()).isEqualByComparingTo("1");
    }

    @ParameterizedTest @ValueSource(strings={"MISSING","STALE","UNAVAILABLE"})
    void anyRequiredSymbolWithoutFreshPriceReturnsNullForTheEntirePortfolio(String state) {
        var open=List.of(position(1L,Position.Side.LONG,"100","1000",10),position(2L,Position.Side.SHORT,"1","100",10));
        marks(Map.of(1L,"1000"));
        if(state.equals("STALE")) prices.update(new LatestMarkPrice(2L,n("100"),NOW.minusSeconds(5),NOW.minusSeconds(5)));
        if(state.equals("UNAVAILABLE")) prices.markUnavailable();
        assertThat(estimate(open).values()).allSatisfy(e -> {
            assertThat(e.status()).isEqualTo(PRICE_UNAVAILABLE); assertThat(e.price()).isNull(); assertThat(e.asOf()).isNull();
        });
    }

    @Test void freshExactExpiryBoundaryDoesNotServeOldEstimate() {
        var p=position(1L,Position.Side.LONG,"100","1000",10);
        var snapshots=Map.of(1L,new LatestPriceStore.Snapshot(LatestPriceStore.Status.STALE,
                Optional.of(new LatestMarkPrice(1L,n("1000"),NOW.minusSeconds(5),NOW.minusSeconds(5)))));
        var result=estimator.estimate(wallet,List.of(p),valuation.evaluate(wallet,List.of(p),snapshots,NOW)).get(1L);
        assertThat(result.status()).isEqualTo(PRICE_UNAVAILABLE); assertThat(result.price()).isNull();
    }

    @Test void oldestServerReceiptAcrossAllRequiredSymbolsIsTheBasisTimestamp() {
        var open=List.of(position(1L,Position.Side.LONG,"100","1000",10),position(2L,Position.Side.SHORT,"1","100",10));
        marks(Map.of(1L,"1000"));
        prices.update(new LatestMarkPrice(2L,n("100"),NOW.plusSeconds(2),NOW.minusSeconds(1)));
        assertThat(estimate(open).get(1L).asOf()).isEqualTo(NOW.minusSeconds(1));
    }

    @Test void aFullyFundedLongHasNoPositiveThresholdAndNeverReturnsZero() {
        var open=List.of(position(1L,Position.Side.LONG,"1","1000",1)); marks(Map.of(1L,"1000"));
        var result=estimate(open).get(1L);
        assertThat(result.status()).isEqualTo(NO_THRESHOLD); assertThat(result.price()).isNull();
    }

    @Test void exactlyFlatRiskSlopeHasNoThresholdDespiteNonzeroNetQuantity() {
        var open=List.of(position(1L,Position.Side.LONG,"201","10",10),position(1L,Position.Side.SHORT,"199","10",10));
        marks(Map.of(1L,"10")); var result=estimate(open).get(1L);
        assertThat(result.status()).isEqualTo(NO_THRESHOLD); assertThat(result.price()).isNull();
    }

    @Test void alreadyAtRiskReturnsNoFuturePriceRatherThanAnOutdatedSafeNumber() {
        var open=List.of(position(1L,Position.Side.LONG,"100","1000",10)); marks(Map.of(1L,"900"));
        assertThat(valuation.evaluate(wallet,open,prices.findAll(Set.of(1L)),NOW).atRisk()).isTrue();
        assertThat(estimate(open).get(1L).status()).isEqualTo(ALREADY_AT_RISK);
        assertThat(estimate(open).get(1L).price()).isNull();
    }

    @ParameterizedTest @CsvSource({"LONG,1000000000000,0.000001","SHORT,0.00000001,100000000"})
    void tinyDomainPricesOrQuantitiesStillMatchEngineRounding(Position.Side side,String quantity,String entry) {
        var open=List.of(position(1L,side,quantity,entry,100)); marks(Map.of(1L,entry));
        var result=estimate(open).get(1L);
        assertThat(result.status()).isIn(ESTIMATED_DOWNWARD,ESTIMATED_UPWARD);
        assertEngineBoundary(open,1L,result);
    }

    @Test void nearFlatHedgeWithAmbiguousRoundingCannotConsumeUnboundedQueryTime() {
        var open=List.of(position(1L,Position.Side.LONG,"201","1000",100),position(1L,Position.Side.SHORT,"199.00000001","1000",100));
        marks(Map.of(1L,"1000"));
        var result=estimate(open).get(1L);
        assertThat(result.status()).isEqualTo(UNSUPPORTED_MODEL); assertThat(result.price()).isNull();
    }

    @Test void roundingSafePointTooCloseToBoundaryDoesNotPretendThereIsAUniqueDirection() {
        var open=List.of(position(1L,Position.Side.SHORT,"1","1000",10));
        marks(Map.of(1L,"10945.273631840796019899"));
        var result=estimate(open).get(1L);
        assertThat(result.price()).isNull(); assertThat(result.status()).isIn(ALREADY_AT_RISK,UNSUPPORTED_MODEL);
    }

    private void assertEngineBoundary(List<Position> open,Long symbol,LiquidationPriceEstimator.Estimate result) {
        assertThat(result.price()).isPositive();
        boolean down=result.status()==ESTIMATED_DOWNWARD;
        assertThat(risk(open,symbol,result.price())).isLessThanOrEqualTo(BigDecimal.ZERO);
        assertThat(risk(open,symbol,result.price().add(down?TICK:TICK.negate()))).isPositive();
        // Larger adverse moves should also be at risk; the returned ULP is verified rather than a display-rounded formula.
        BigDecimal farther=result.price().add(down?TICK.negate():TICK);
        if(farther.signum()>0) assertThat(risk(open,symbol,farther)).isLessThanOrEqualTo(BigDecimal.ZERO);
    }
    private BigDecimal risk(List<Position> open,Long symbol,BigDecimal price) {
        return valuation.risk(wallet,open,p -> p.getTradingSymbolId().equals(symbol)?price:prices.find(p.getTradingSymbolId()).latestPrice().orElseThrow().domainMarkPrice()).buffer();
    }
    private Map<Long,LiquidationPriceEstimator.Estimate> estimate(List<Position> open) {
        var ids=new HashSet<Long>(); open.forEach(p -> ids.add(p.getTradingSymbolId()));
        return estimator.estimate(wallet,open,valuation.evaluate(wallet,open,prices.findAll(ids),NOW));
    }
    private void marks(Map<Long,String> marks) {
        prices.beginSubscription(Set.of(1L,2L));
        marks.forEach((id,mark) -> prices.update(new LatestMarkPrice(id,n(mark),NOW,NOW)));
    }
    private static Position position(Long symbol,Position.Side side,String quantity,String entry,int leverage) {
        return Position.open(1L,symbol,side,n(quantity),n(entry),leverage,NOW.minusSeconds(10));
    }
    private static BigDecimal n(String value) { return new BigDecimal(value); }
}
