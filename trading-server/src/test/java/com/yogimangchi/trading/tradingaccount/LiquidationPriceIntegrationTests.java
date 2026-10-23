package com.yogimangchi.trading.tradingaccount;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.*;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.*;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class LiquidationPriceIntegrationTests {
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired SymbolLeverageService leverages;
    @Autowired AccountTriggerService trigger;
    @Autowired LatestPriceStore prices;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @MockitoBean TradingEngineGate gate;
    GuestAccountResponse guest;
    long btc,eth;
    @BeforeEach void setup() {
        guest=accounts.createGuest();
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        eth=jdbc.queryForObject("select id from trading.trading_symbol where symbol='ETH'",Long.class);
        prices.beginSubscription(Set.of(btc,eth)); mark(btc,n("1000")); mark(eth,n("100"));
    }
    @AfterEach void cleanup() { prices.markUnavailable(); }

    @ParameterizedTest @EnumSource(Position.Side.class)
    void actualLiquidationWorkerIsSafeOneUlpBeforeAndLiquidatesAtTheReportedThreshold(Position.Side side) {
        leverages.change(guest.accountId(),btc,side,100);
        var order=open(btc,side,"100");
        var estimate=accounts.summary(guest.accountId()).positions().get(0);
        BigDecimal price=n(estimate.liquidationPrice());
        BigDecimal nearer=price.add(n(side==Position.Side.LONG?"0.000000000000000001":"-0.000000000000000001"));
        var safe=mark(btc,nearer); trigger.process(guest.accountId(),safe,Map.of(btc,safe));
        assertThat(accounts.summary(guest.accountId()).positions()).hasSize(1);
        var risk=mark(btc,price);
        assertThat(accounts.summary(guest.accountId()).positions().get(0).liquidationPriceStatus().name()).isEqualTo("ALREADY_AT_RISK");
        trigger.process(guest.accountId(),risk,Map.of(btc,risk));
        trigger.process(guest.accountId(),risk,Map.of(btc,risk));
        assertThat(accounts.summary(guest.accountId()).positions()).isEmpty();
        assertThat(jdbc.queryForObject("select status from trading.position where id=?",String.class,order.positionId())).isEqualTo("LIQUIDATED");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and action='LIQUIDATE'",Long.class,guest.accountId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select used_margin from trading.wallet where account_id=?",BigDecimal.class,guest.accountId())).isZero();
    }

    @Test void summaryAndPositionRoutesReturnIdenticalFieldsWithoutFinancialWrites() throws Exception {
        open(btc,Position.Side.LONG,"20"); open(btc,Position.Side.SHORT,"5"); open(eth,Position.Side.SHORT,"1");
        var before=ledger();
        var summary=json.readTree(mvc.perform(get("/api/v1/trading/account/summary").header("Authorization",bearer()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var positions=json.readTree(mvc.perform(get("/api/v1/trading/account/positions").header("Authorization",bearer()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(positions).isEqualTo(summary.path("positions"));
        assertThat(positions.get(0).path("liquidationPrice")).isNotEqualTo(positions.get(1).path("liquidationPrice"));
        assertThat(positions.get(0).path("marginMode").asText()).isEqualTo("ISOLATED");
        assertThat(positions.get(0).path("liquidationPriceStatus").asText()).isEqualTo("ESTIMATED_DOWNWARD");
        assertThat(positions.get(0).path("liquidationPriceAsOf").isTextual()).isTrue();
        assertThat(ledger()).isEqualTo(before);
        mvc.perform(get("/api/v1/trading/account/positions")).andExpect(status().isUnauthorized());
    }

    @Test void leverageMovesTheCollateralThresholdWhilePendingReservationsDoNot() {
        var opened=open(btc,Position.Side.SHORT,"5");
        var before=accounts.summary(guest.accountId()).positions().get(0).liquidationPrice();
        var pending=orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,n("1"),10,n("990")));
        var close=orders.createLimitClose(guest.accountId(),opened.positionId(),key(),new LimitCloseRequest(n("1"),n("900")));
        assertThat(accounts.summary(guest.accountId()).positions().get(0).liquidationPrice()).isEqualTo(before);
        for(int leverage:List.of(1,14,100)) {
            leverages.change(guest.accountId(),btc,Position.Side.SHORT,leverage);
            assertThat(accounts.summary(guest.accountId()).positions().get(0).liquidationPrice()).isNotEqualTo(before);
        }
        var after=accounts.summary(guest.accountId()).positions().get(0).liquidationPrice();
        orders.cancel(guest.accountId(),pending.orderId()); orders.cancel(guest.accountId(),close.orderId());
        assertThat(accounts.summary(guest.accountId()).positions().get(0).liquidationPrice()).isEqualTo(after);
    }

    @Test void fillsPartialCloseAndFullCloseImmediatelyAffectTheDerivedResponse() {
        var first=open(btc,Position.Side.LONG,"20");
        var before=accounts.summary(guest.accountId()).positions().get(0).liquidationPrice();
        mark(btc,n("1100")); open(btc,Position.Side.LONG,"5");
        var added=accounts.summary(guest.accountId()).positions().get(0);
        assertThat(added.id()).isEqualTo(first.positionId()); assertThat(added.entryPrice()).isEqualTo("1020.000000000000000000");
        assertThat(added.liquidationPrice()).isNotEqualTo(before);
        orders.close(guest.accountId(),first.positionId(),key(),new ClosePositionRequest(n("5")));
        assertThat(n(accounts.summary(guest.accountId()).positions().get(0).liquidationPrice()).subtract(n(added.liquidationPrice())).abs())
                .isLessThanOrEqualTo(n("0.000000000000000010"));
        orders.close(guest.accountId(),first.positionId(),key());
        assertThat(accounts.summary(guest.accountId()).positions()).isEmpty();
    }

    @Test void missingOtherSymbolMarkDoesNotHideTheFreshTargetsIsolatedEstimate() throws Exception {
        open(btc,Position.Side.SHORT,"5"); open(eth,Position.Side.LONG,"1");
        prices.beginSubscription(Set.of(btc,eth)); mark(btc,n("1000"));
        mvc.perform(get("/api/v1/trading/account/positions").header("Authorization",bearer()))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].liquidationPriceStatus").value("ESTIMATED_UPWARD"))
                .andExpect(jsonPath("$[0].liquidationPrice").isString()).andExpect(jsonPath("$[0].liquidationPriceAsOf").isString())
                .andExpect(jsonPath("$[1].liquidationPriceStatus").value("PRICE_UNAVAILABLE"));
    }

    @Test void generatedOpenApiDocumentsIndependentIsolatedThresholdAndConversionHold() throws Exception {
        var api=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var fields=api.path("components").path("schemas").path("PositionResponse").path("properties");
        assertThat(fields.path("liquidationPrice").path("description").asText()).contains("POSITION","collateral","actual Mark");
        assertThat(fields.path("liquidationPriceStatus").path("enum").toString()).contains("ESTIMATED_DOWNWARD","ESTIMATED_UPWARD","PRICE_UNAVAILABLE","NO_THRESHOLD","UNSUPPORTED_MODEL","ALREADY_AT_RISK");
        assertThat(fields.path("liquidationPriceAsOf").path("description").asText()).contains("This symbol's server receivedAt");
        assertThat(api.path("paths").path("/api/v1/trading/account/positions").path("get").path("security").isEmpty()).isFalse();
    }

    @Test void liquidationOnlyReleasesItsOwnCloseOrdersAndPreservesOppositeSideOtherSymbolsAndPendingOpen() {
        leverages.change(guest.accountId(),btc,Position.Side.LONG,100);
        var longOrder=open(btc,Position.Side.LONG,"10");
        leverages.change(guest.accountId(),btc,Position.Side.SHORT,100);
        var shortOrder=open(btc,Position.Side.SHORT,"10");
        open(eth,Position.Side.LONG,"1");
        var ownClose=orders.createLimitClose(guest.accountId(),longOrder.positionId(),key(),new LimitCloseRequest(n("7"),n("1100")));
        var otherClose=orders.createLimitClose(guest.accountId(),shortOrder.positionId(),key(),new LimitCloseRequest(n("7"),n("900")));
        var pending=orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.SHORT,n("1"),100,n("1010")));
        var tick=mark(btc,n("990"));
        trigger.process(guest.accountId(),tick,Map.of(btc,tick,eth,prices.find(eth).latestPrice().orElseThrow()));
        trigger.process(guest.accountId(),tick,Map.of(btc,tick,eth,prices.find(eth).latestPrice().orElseThrow()));
        assertThat(accounts.summary(guest.accountId()).positions()).hasSize(2);
        assertThat(jdbc.queryForObject("select status from trading.position where id=?",String.class,shortOrder.positionId())).isEqualTo("OPEN");
        assertThat(orderStatus(ownClose.orderId())).isEqualTo("REJECTED");
        assertThat(orderStatus(otherClose.orderId())).isEqualTo("PENDING");
        assertThat(orderStatus(pending.orderId())).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and action='LIQUIDATE'",Long.class,guest.accountId())).isEqualTo(1);
        assertThat(n(accounts.wallet(guest.accountId()).balance())).isEqualByComparingTo("9889.95");
    }

    @Test void gapUsesActualMarkAndGrossLossWhileSeparateAdjustmentProtectsUnusedCash() {
        leverages.change(guest.accountId(),btc,Position.Side.LONG,100);
        open(btc,Position.Side.LONG,"10");
        var tick=mark(btc,n("800"));
        trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        var fill=orders.history(guest.accountId(),null,10).stream().filter(o -> o.action().equals("LIQUIDATE")).findFirst().orElseThrow().fill();
        assertThat(n(fill.price())).isEqualByComparingTo("800");
        assertThat(n(fill.realizedPnl())).isEqualByComparingTo("-2000");
        assertThat(n(fill.fee())).isEqualByComparingTo("4");
        assertThat(n(fill.settlementAdjustment())).isEqualByComparingTo("1904");
        assertThat(fill.marginMode()).isEqualTo("ISOLATED");
        var wallet=accounts.wallet(guest.accountId());
        assertThat(n(wallet.balance())).isEqualByComparingTo("9895");
        assertThat(n(wallet.realizedPnl())).isEqualByComparingTo("-2000");
        assertThat(n(wallet.feesPaid())).isEqualByComparingTo("9"); // OPEN 5 + liquidation 4.
        assertThat(n(wallet.settlementAdjustment())).isEqualByComparingTo("1904");
        assertThat(accounts.summary(guest.accountId()).status()).isEqualTo("ACTIVE");
    }

    @Test void longAndShortRiskOnDifferentSymbolsSettleIndependentlyExactlyOnceInTheSameTransaction() {
        leverages.change(guest.accountId(),btc,Position.Side.LONG,100); leverages.change(guest.accountId(),eth,Position.Side.SHORT,100);
        open(btc,Position.Side.LONG,"10"); open(eth,Position.Side.SHORT,"1");
        var btcRisk=mark(btc,n("800")); var ethRisk=mark(eth,n("120"));
        var book=Map.of(btc,btcRisk,eth,ethRisk);
        trigger.process(guest.accountId(),btcRisk,book);
        trigger.process(guest.accountId(),ethRisk,book);
        assertThat(accounts.summary(guest.accountId()).positions()).isEmpty();
        assertThat(n(accounts.wallet(guest.accountId()).balance())).isEqualByComparingTo("9893.95");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and action='LIQUIDATE'",Long.class,guest.accountId())).isEqualTo(2);
        assertThat(n(accounts.wallet(guest.accountId()).usedMargin())).isZero();
    }

    @Test void unavailableUnrelatedMarkDoesNotDelayTheRiskyPositionsLiquidation() {
        leverages.change(guest.accountId(),btc,Position.Side.LONG,100);
        open(btc,Position.Side.LONG,"10"); open(eth,Position.Side.LONG,"1");
        prices.beginSubscription(Set.of(btc,eth));
        var tick=mark(btc,n("800"));
        trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        var remaining=accounts.summary(guest.accountId()).positions();
        assertThat(remaining).hasSize(1);
        assertThat(remaining.get(0).tradingSymbolId()).isEqualTo(eth);
    }

    @Test void legacyConversionPreservesCashCollateralAndHistoricalFactsAfterAllFreshRiskChecks() {
        var opened=open(btc,Position.Side.LONG,"10");
        markAsLegacy();
        var walletBefore=jdbc.queryForMap("select * from trading.wallet where account_id=?",guest.accountId());
        var fillsBefore=orders.history(guest.accountId(),null,10);
        assertThat(accounts.wallet(guest.accountId()).marginMode()).isEqualTo("LEGACY_CROSS");
        assertThat(accounts.summary(guest.accountId()).positions().get(0).liquidationPriceStatus().name()).isEqualTo("MARGIN_MIGRATION_REQUIRED");
        var tick=mark(btc,n("1000"));
        trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        assertThat(accounts.wallet(guest.accountId()).marginTransitionStatus()).isEqualTo("COMPLETE");
        assertThat(accounts.wallet(guest.accountId()).marginMode()).isEqualTo("ISOLATED");
        assertThat(jdbc.queryForMap("select * from trading.wallet where account_id=?",guest.accountId())).isEqualTo(walletBefore);
        assertThat(orders.history(guest.accountId(),null,10)).isEqualTo(fillsBefore);
        assertThat(jdbc.queryForObject("select isolated_cutover_margin from trading.position where id=?",BigDecimal.class,opened.positionId())).isEqualByComparingTo("1000");
        assertThat(jdbc.queryForObject("select isolated_cutover_price from trading.position where id=?",BigDecimal.class,opened.positionId())).isEqualByComparingTo("1000");
        assertThat(accounts.summary(guest.accountId()).positions().get(0).openedMarginMode()).isEqualTo("CROSS");
    }

    @Test void missingLegacyPriceKeepsConversionPendingAndRejectsNewTradesWithoutTouchingTheLedger() {
        open(btc,Position.Side.LONG,"10"); open(eth,Position.Side.LONG,"1");
        markAsLegacy();
        var before=ledger();
        prices.beginSubscription(Set.of(btc,eth)); var tick=mark(btc,n("1000"));
        trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        assertThat(accounts.wallet(guest.accountId()).marginTransitionStatus()).isEqualTo("PENDING");
        assertThatThrownBy(() -> open(btc,Position.Side.LONG,"1"))
                .isInstanceOfSatisfying(com.yogimangchi.trading.error.BusinessException.class,
                        e -> assertThat(e.getCode()).isEqualTo(com.yogimangchi.trading.error.ErrorCode.MARGIN_MIGRATION_REQUIRED));
        assertThat(ledger()).isEqualTo(before);
    }

    @Test void alreadyRiskyLegacyExposureIsPersistentlyHeldForReviewWithoutAutomaticLiquidationOrCashRedistribution() {
        open(btc,Position.Side.LONG,"10");
        markAsLegacy();
        var walletBefore=jdbc.queryForMap("select * from trading.wallet where account_id=?",guest.accountId());
        var tick=mark(btc,n("800"));
        trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        assertThat(accounts.wallet(guest.accountId()).marginTransitionStatus()).isEqualTo("REVIEW_REQUIRED");
        assertThat(jdbc.queryForMap("select * from trading.wallet where account_id=?",guest.accountId())).isEqualTo(walletBefore);
        assertThat(accounts.summary(guest.accountId()).positions()).hasSize(1);
        assertThat(orders.history(guest.accountId(),null,10)).hasSize(1);
        var recovered=mark(btc,n("1000"));
        trigger.process(guest.accountId(),recovered,Map.of(btc,recovered));
        assertThat(accounts.wallet(guest.accountId()).marginTransitionStatus()).isEqualTo("REVIEW_REQUIRED");
        assertThat(accounts.summary(guest.accountId()).positions().get(0).liquidationPrice()).isNull();
    }

    private void markAsLegacy() {
        jdbc.update("update trading.trading_account set margin_transition_status='PENDING',isolated_activated_at=null where id=?",guest.accountId());
        jdbc.update("update trading.position set opened_margin_mode='CROSS' where account_id=?",guest.accountId());
        jdbc.update("update trading.trading_order set submitted_margin_mode='CROSS' where account_id=?",guest.accountId());
        jdbc.update("update trading.fill set margin_mode='CROSS' where order_id in (select id from trading.trading_order where account_id=?)",guest.accountId());
    }

    private String orderStatus(long id) {
        return jdbc.queryForObject("select status from trading.trading_order where id=?",String.class,id);
    }

    private OrderResponse open(long symbol,Position.Side side,String quantity) {
        return orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.MARKET,symbol,side,n(quantity),leverages.current(guest.accountId(),symbol,side),null));
    }
    private LatestMarkPrice mark(long symbol,BigDecimal price) {
        Instant now=Instant.now();
        Instant event=prices.find(symbol).latestPrice().map(LatestMarkPrice::eventTime).filter(previous -> !previous.isBefore(now)).map(previous -> previous.plusNanos(1)).orElse(now);
        var tick=new LatestMarkPrice(symbol,price,event,now); assertThat(prices.update(tick)).isTrue(); return tick;
    }
    private List<Object> ledger() {
        var result=new ArrayList<Object>();
        for(String table:List.of("trading_account","wallet","position","trading_order"))
            result.add(jdbc.queryForList("select * from trading."+table+" where "+(table.equals("trading_account")?"id":"account_id")+"=? order by 1",guest.accountId()));
        result.add(jdbc.queryForList("select f.* from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=? order by f.id",guest.accountId()));
        return result;
    }
    private String bearer() { return "Bearer "+guest.accessToken(); }
    private static String key() { return UUID.randomUUID().toString(); }
    private static BigDecimal n(String value) { return new BigDecimal(value); }
}
