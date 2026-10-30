package com.yogimangchi.trading.execution.recovery;

import com.yogimangchi.trading.support.LegacyLeverageFixtures;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.fill.repository.FillRepository;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;

@SpringBootTest(properties={"trading.risk-journal.enabled=true","binance.mark-price.enabled=false","binance.order-book.enabled=false","trading.trigger.enabled=false","trading.reconciliation.enabled=false","trading.guest-cleanup.enabled=false"})
@Import(DurableRiskIntegrationTests.Infrastructure.class)
class RiskGapRecoveryIntegrationTests {
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired LatestPriceStore prices;
    @Autowired DurableRiskWorker worker;
    @Autowired RiskWorkRunner runner;
    @Autowired javax.sql.DataSource dataSource;
    @Autowired JdbcTemplate jdbc;
    @Autowired RedisMarketDataBridge bridge;
    @MockitoSpyBean FillRepository fills;
    @MockitoSpyBean LedgerReconciler ledger;
    long account,btc,eth;
    @BeforeEach void setup()throws Exception {
        btc=symbol("BTC");eth=symbol("ETH");account=accounts.createGuest().accountId();
        prices.beginSubscription(Set.of(btc,eth));
        await().atMost(Duration.ofSeconds(12)).until(()->bridge.health().state()==RedisMarketDataBridge.State.HEALTHY);
        tick(btc,"100");tick(eth,"100");drain();
    }
    @AfterEach void stop(){reset(fills,ledger);prices.markUnavailable();}
    @Test void receivedCrossingAfterGapIsReplayedOnceAndPreservesRecoveryEvidence()throws Exception {
        var order=limit(btc);gap();tick(btc,"98");tick(eth,"100");tick(btc,"102");drain();
        assertThat(status(order)).isEqualTo("FILLED");assertThat(fillPrice(order)).isEqualByComparingTo("98");
        assertThat(activeHolds()).isZero();assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
        assertThat(jdbc.queryForObject("select evidence::text from trading.risk_hold where account_id=? order by id limit 1",String.class,account))
            .contains("OBSERVED_MARK_ONLY_V1","resumedThroughEventId","\"unobservedCrossingsReconstructed\": false");
        worker.runOnce();assertThat(fillCount()).isEqualTo(1);market(btc);
    }
    @Test void unreceivedDipDoesNotBecomeAnInventedCrossingOrProfit()throws Exception {
        var order=limit(btc);gap();tick(btc,"102");tick(eth,"100");drain();
        assertThat(status(order)).isEqualTo("PENDING");assertThat(fillCount()).isZero();assertThat(activeHolds()).isZero();
        orders.cancel(account,order.orderId());assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }
    @Test void expiredReceivedPricesReplayButDoNotResumeCurrentTradingUntilFreshData()throws Exception {
        limit(btc);gap();tick(btc,"102");Thread.sleep(6100);drain();
        assertThat(activeHolds()).isPositive();assertThat(fillCount()).isZero();
        assertThatThrownBy(()->market(btc)).isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getCode()).isEqualTo(ErrorCode.ACCOUNT_RISK_PENDING));
        tick(btc,"103");drain();assertThat(activeHolds()).isZero();market(btc);
    }
    @Test void aSecondDisconnectCannotBeClearedUsingThePreviousConnectionsHead()throws Exception {
        limit(btc);gap();tick(btc,"102");gap();drain();
        assertThat(activeHolds()).isPositive();
        var boundary=jdbc.queryForObject("select (evidence->>'latestGapEventId')::bigint from trading.risk_hold where account_id=? and reason='PROVIDER_CONTINUITY_UNKNOWN'",Long.class,account);
        assertThat(boundary).isGreaterThan(jdbc.queryForObject("select event_id from trading.risk_price_head where trading_symbol_id=?",Long.class,btc));
        tick(btc,"103");drain();assertThat(activeHolds()).isZero();
    }
    @Test void flatAccountReceivesARecoveryProbeAfterPriorRecordedLiquidation()throws Exception {
        var opened=market(btc);gap();tick(btc,"80");gap();drain();
        assertThat(jdbc.queryForObject("select status from trading.position where id=?",String.class,opened.positionId())).isEqualTo("LIQUIDATED");
        assertThat(activeHolds()).isPositive();assertThat(fillCount()).isEqualTo(2);
        tick(btc,"102");drain();assertThat(activeHolds()).isZero();assertThat(fillCount()).isEqualTo(2);
        assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }
    @Test void ledgerMismatchBlocksReplayAndIsNeverAutomaticallyForgiven()throws Exception {
        var order=limit(btc);gap();tick(btc,"98");
        jdbc.update("update trading.wallet set balance=balance+1 where account_id=?",account);drain();
        assertThat(status(order)).isEqualTo("PENDING");assertThat(fillCount()).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and reason='LEDGER_MISMATCH' and resolved_at is null",Long.class,account)).isEqualTo(1);
        jdbc.update("update trading.wallet set balance=balance-1 where account_id=?",account);tick(btc,"102");drain();
        assertThat(fillCount()).isZero();assertThat(activeHolds()).isGreaterThan(1);
    }
    @Test void failedFinalReconciliationRollsBackFillDoneAndHoldResolutionTogether()throws Exception {
        var order=limit(btc);gap();tick(btc,"98");
        var ledgerTarget=org.springframework.test.util.AopTestUtils.<LedgerReconciler>getUltimateTargetObject(ledger);
        doCallRealMethod().doThrow(new IllegalStateException("test final reconciliation rollback")).when(ledgerTarget).checkInTransaction(account);
        worker.runOnce();assertThat(status(order)).isEqualTo("PENDING");assertThat(fillCount()).isZero();assertThat(activeHolds()).isPositive();
        reset(ledger);jdbc.update("update trading.risk_account_work set next_attempt_at=clock_timestamp() where account_id=?",account);drain();
        assertThat(status(order)).isEqualTo("FILLED");assertThat(fillCount()).isEqualTo(1);assertThat(activeHolds()).isZero();
    }
    @Test void repeatedProcessingFailureStillNeedsReviewAfterPricesRecover()throws Exception {
        var order=limit(btc);gap();tick(btc,"98");doThrow(new IllegalStateException("test poison")).when(fills).save(org.mockito.ArgumentMatchers.any());
        for(int i=0;i<3;i++){jdbc.update("update trading.risk_account_work set next_attempt_at=clock_timestamp() where account_id=?",account);worker.runOnce();}
        reset(fills);tick(btc,"102");drain();assertThat(status(order)).isEqualTo("PENDING");assertThat(fillCount()).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and reason='RISK_PROCESSING_FAILED' and resolved_at is null",Long.class,account)).isEqualTo(1);
    }
    @Test void oneSymbolsOutageDoesNotHideOtherSymbolsReceivedLiquidation()throws Exception {
        var opened=market(btc);limit(eth);gap();tick(btc,"80");drain();
        assertThat(jdbc.queryForObject("select status from trading.position where id=?",String.class,opened.positionId())).isEqualTo("LIQUIDATED");
        assertThat(activeHolds()).isPositive();tick(eth,"102");drain();assertThat(activeHolds()).isZero();
        assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }
    @Test void secondFillFailureRollsBackTheWholeOrderedBatch()throws Exception {
        var buy=limit(btc);var other=limit(eth);gap();tick(btc,"98");tick(eth,"98");
        var before=jdbc.queryForMap("select * from trading.wallet where account_id=?",account);
        var calls=new java.util.concurrent.atomic.AtomicInteger();
        doAnswer(inv->{com.yogimangchi.trading.fill.entity.Fill fill=inv.getArgument(0);
            long owner=jdbc.queryForObject("select account_id from trading.trading_order where id=?",Long.class,fill.getOrderId());
            if(owner==account&&calls.incrementAndGet()==2)throw new IllegalStateException("test second Fill rollback");
            return inv.callRealMethod();}).when(fills).save(org.mockito.ArgumentMatchers.any());
        worker.runOnce();assertThat(status(buy)).isEqualTo("PENDING");assertThat(status(other)).isEqualTo("PENDING");
        assertThat(fillCount()).isZero();assertThat(jdbc.queryForMap("select * from trading.wallet where account_id=?",account)).isEqualTo(before);
        reset(fills);jdbc.update("update trading.risk_account_work set next_attempt_at=clock_timestamp() where account_id=?",account);drain();
        assertThat(status(buy)).isEqualTo("FILLED");assertThat(status(other)).isEqualTo("FILLED");assertThat(fillCount()).isEqualTo(2);
        assertThat(activeHolds()).isZero();assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }
    @Test void batchCannotOvertakeHeldOrFutureRetryAndDuplicateHeadCannotConsumeLaterWork()throws Exception {
        limit(btc);tick(btc,"100");tick(btc,"101");tick(btc,"102");
        var ids=jdbc.queryForList("select event_id from trading.risk_account_work where account_id=? and status='PENDING' order by event_id",Long.class,account);
        jdbc.update("update trading.risk_account_work set status='HELD' where account_id=? and event_id=?",account,ids.get(1));
        assertThat(runner.processBatch(account,ids.get(0))).isEqualTo(1);
        assertThat(runner.process(account,ids.get(0))).isFalse();
        assertThat(runner.processBatch(account,ids.get(2))).isZero();
        jdbc.update("update trading.risk_account_work set status='PENDING',next_attempt_at=clock_timestamp()+interval '60 seconds' where account_id=? and event_id=?",account,ids.get(1));
        assertThat(runner.processBatch(account,ids.get(1))).isZero();assertThat(fillCount()).isZero();
    }
    @Test void batchSharesExposureQueriesButProcessesEveryReceivedEvent()throws Exception {
        limit(btc);for(int i=0;i<24;i++)tick(btc,"100");
        var ids=jdbc.queryForList("select event_id from trading.risk_account_work where account_id=? and status='PENDING' order by event_id",Long.class,account);
        long batchQueries,singleQueries;
        try(var count=RiskSqlCounter.start()){assertThat(runner.processBatch(account,ids.get(0))).isEqualTo(8);batchQueries=count.selectCount();}
        try(var count=RiskSqlCounter.start()){for(int i=8;i<16;i++)assertThat(runner.process(account,ids.get(i))).isTrue();singleQueries=count.selectCount();}
        assertThat(batchQueries).isLessThan(singleQueries);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id=? and status='DONE'",Long.class,account)).isEqualTo(16);
        assertThat(fillCount()).isZero();System.out.println("RISK_BATCH_QUERIES events=8 batch="+batchQueries+" single="+singleQueries);
        drain();assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id=? and status='DONE'",Long.class,account)).isEqualTo(24);
    }
    @Test void realPostgresIngressFenceTimeoutIsRetryableWithoutPoisoningAnAccount()throws Exception {
        limit(btc);tick(btc,"100");long deferred=worker.measurements().admissionDeferrals();
        try(var connection=dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try(var statement=connection.createStatement()){statement.execute("select pg_advisory_xact_lock("+RiskAdmission.INGRESS_LOCK+")");}
            var error=catchThrowable(()->market(btc));assertThat(error).isInstanceOf(RiskAdmission.IngressBusy.class);
            var response=new ApiExceptionHandler().handleBusinessException((BusinessException)error);
            assertThat(response.getStatus()).isEqualTo(409);assertThat(response.getProperties()).containsEntry("code","TRADING_BUSY").containsEntry("outcome","NOT_ACCEPTED");
            worker.runOnce();assertThat(worker.measurements().admissionDeferrals()).isEqualTo(deferred+1);
            assertThat(jdbc.queryForObject("select count(*) from trading.risk_work_attempt where account_id=?",Long.class,account)).isZero();
            assertThat(fillCount()).isZero();connection.rollback();
        }
        tick(btc,"101");drain();assertThat(market(btc).status()).isEqualTo("FILLED");
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and reason='RISK_PROCESSING_FAILED'",Long.class,account)).isZero();
        assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }
    void gap(){prices.markUnavailable();prices.beginSubscription(Set.of(btc,eth));}
    void tick(long symbol,String amount){var now=Instant.now();assertThat(prices.update(new LatestMarkPrice(symbol,new BigDecimal(amount),now,now))).isTrue();}
    void drain()throws Exception{for(int i=0;i<5;i++)worker.runOnce();}
    long symbol(String symbol){return jdbc.queryForObject("select id from trading.trading_symbol where symbol=?",Long.class,symbol);}
    OrderResponse limit(long symbol){
        LegacyLeverageFixtures.tenTimes(jdbc,account,symbol,Position.Side.LONG);
        return orders.create(account,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,symbol,Position.Side.LONG,BigDecimal.ONE,10,new BigDecimal("99")));}
    OrderResponse market(long symbol){
        LegacyLeverageFixtures.tenTimes(jdbc,account,symbol,Position.Side.LONG);
        return orders.create(account,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,symbol,Position.Side.LONG,BigDecimal.ONE,10,null));}
    long activeHolds(){return jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and resolved_at is null",Long.class,account);}
    long fillCount(){return jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,account);}
    String status(OrderResponse order){return jdbc.queryForObject("select status from trading.trading_order where id=?",String.class,order.orderId());}
    BigDecimal fillPrice(OrderResponse order){return jdbc.queryForObject("select price from trading.fill where order_id=?",BigDecimal.class,order.orderId());}
}
