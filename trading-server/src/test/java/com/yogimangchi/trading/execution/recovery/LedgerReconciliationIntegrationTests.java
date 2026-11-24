package com.yogimangchi.trading.execution.recovery;

import com.yogimangchi.trading.support.LegacyLeverageFixtures;

import com.yogimangchi.trading.reconciliation.*;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.tradingaccount.service.*;
import com.yogimangchi.trading.tradinground.MemberRounds;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.awaitility.Awaitility.await;

@SpringBootTest(properties={"trading.risk-journal.enabled=true","trading.reconciliation.enabled=false","trading.trigger.enabled=false","trading.guest-cleanup.enabled=false","binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(DurableRiskIntegrationTests.Infrastructure.class)
class LedgerReconciliationIntegrationTests {
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired GuestRetryService retries;
    @Autowired MemberAccounts members;
    @Autowired MemberRounds rounds;
    @Autowired LatestPriceStore prices;
    @Autowired RedisMarketDataBridge bridge;
    @Autowired DurableRiskWorker riskWorker;
    @Autowired LedgerReconciliationWorker worker;
    @Autowired JdbcTemplate jdbc;
    @MockitoSpyBean LedgerReconciler reconciler;
    long account,btc;
    @BeforeEach void setup(){
        account=accounts.createGuest().accountId();
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc));
        await().atMost(Duration.ofSeconds(12)).until(()->bridge.health().state()==RedisMarketDataBridge.State.HEALTHY);
        mark("1000");
    }
    @AfterEach void cleanup(){reset(reconciler);prices.markUnavailable();}
    @Test void realHedgeAndPendingReservationsMatchWithoutAnyFinancialWrite(){
        var opened=open(account,Position.Side.LONG);open(account,Position.Side.SHORT);
        orders.create(account,key(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,n("0.1"),10,n("990")));
        orders.createLimitClose(account,opened.positionId(),key(),new LimitCloseRequest(n("0.2"),n("1100")));
        var before=financial(account);var result=reconciler.check(account);
        assertThat(result.status()).isEqualTo("MATCHED");assertThat(result.failedChecks()).isEmpty();
        assertThat(financial(account)).isEqualTo(before);
        assertThat((BigDecimal)result.evidence().get("expected_collateral")).isEqualByComparingTo("200");
    }
    @ParameterizedTest @CsvSource({"used_margin=used_margin-1,OPEN_COLLATERAL","balance=balance+1,CASH_CAPITAL_RECONCILIATION","realized_pnl=realized_pnl+1,FILL_GROSS_PNL","fees_paid=fees_paid+1,FILL_FEES","settlement_adjustment=settlement_adjustment+1,FILL_ADJUSTMENT","reserved_margin=reserved_margin+1,OPEN_RESERVATION"})
    void corruptionIsEvidenceAndScopedHoldRatherThanAutomaticRepair(String mutation,String check){
        open(account,Position.Side.LONG);
        jdbc.update("update trading.wallet set "+mutation+" where account_id=?",account);
        var before=financial(account);var result=reconciler.check(account);
        assertThat(result.status()).isEqualTo("MISMATCH");assertThat(result.failedChecks()).contains(check);
        assertThat(financial(account)).isEqualTo(before);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and reason='LEDGER_MISMATCH' and resolved_at is null",Long.class,account)).isEqualTo(1);
        long other=accounts.createGuest().accountId();open(other,Position.Side.LONG);
        assertThat(reconciler.check(other).status()).isEqualTo("MATCHED");
    }
    @Test void closeReservationMismatchPersistsAndSuccessfulRecheckDoesNotSilentlyReleaseHold(){
        var p=open(account,Position.Side.LONG);
        orders.createLimitClose(account,p.positionId(),key(),new LimitCloseRequest(n("0.2"),n("1100")));
        jdbc.update("update trading.position set reserved_close_quantity=0 where id=?",p.positionId());
        assertThat(reconciler.check(account).failedChecks()).contains("CLOSE_RESERVATION");
        jdbc.update("update trading.position set reserved_close_quantity=0.2 where id=?",p.positionId());
        assertThat(reconciler.check(account).status()).isEqualTo("MATCHED");
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and reason='LEDGER_MISMATCH' and resolved_at is null",Long.class,account)).isEqualTo(1);
    }
    @Test void guestRetryCapitalIsNotTradingProfit(){
        var p=open(account,Position.Side.LONG);mark("1100");orders.close(account,p.positionId(),key());retries.retry(account,key());
        var result=reconciler.check(account);assertThat(result.status()).isEqualTo("MATCHED");
        assertThat((BigDecimal)result.evidence().get("capital")).isEqualByComparingTo("-98.95");
        assertThat((BigDecimal)result.evidence().get("expected_balance")).isEqualByComparingTo("10000");
    }
    @Test void memberRestartPreservesFrozenRoundAndCapitalFacts(){
        long memberAccount=members.open(90_000_000L+account).accountId();
        var p=open(memberAccount,Position.Side.LONG);mark("1100");orders.close(memberAccount,p.positionId(),key());
        rounds.restart(memberAccount,key());
        var result=reconciler.check(memberAccount);assertThat(result.status()).isEqualTo("MATCHED");
        assertThat((BigDecimal)result.evidence().get("capital")).isEqualByComparingTo("-98.95");
        assertThat((BigDecimal)result.evidence().get("expected_balance")).isEqualByComparingTo("10000");
    }
    @Test void legacyUnknownFundingIsUnverifiedWithoutInventingCapitalOrBlockingSoundLedger(){
        long id=members.open(90_000_000L+account).accountId();
        jdbc.update("update trading.member_trading_round set funding='LEGACY_UNVERIFIED',initial_balance=null where account_id=?",id);
        var result=reconciler.check(id);assertThat(result.status()).isEqualTo("UNVERIFIED");
        assertThat(result.evidence().get("expected_balance")).isNull();assertThat(result.failedChecks()).isEmpty();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=?",Long.class,id)).isZero();
    }
    @Test void batchIsBoundedAndOneUnavailableAccountDoesNotStopScan(){
        var ids=new ArrayList<Long>();for(int i=0;i<27;i++)ids.add(accounts.createGuest().accountId());
        jdbc.update("update trading.ledger_reconciliation_cursor set last_account_id=? where id=1",ids.get(0)-1);
        doThrow(new org.springframework.dao.CannotAcquireLockException("test busy account")).when(reconciler).check(ids.get(0));
        assertThat(worker.runBatch()).isEqualTo(25);
        assertThat(jdbc.queryForObject("select last_account_id from trading.ledger_reconciliation_cursor where id=1",Long.class)).isEqualTo(ids.get(24));
        assertThat(jdbc.queryForObject("select count(*) from trading.ledger_reconciliation where account_id between ? and ?",Long.class,ids.get(0),ids.get(24))).isEqualTo(24);
        reset(reconciler);assertThat(worker.runBatch()).isEqualTo(2);assertThat(worker.runBatch()).isZero();
        assertThat(jdbc.queryForObject("select last_account_id from trading.ledger_reconciliation_cursor where id=1",Long.class)).isZero();
    }
    @Test void representativeReadHasMeasuredCostAndExactFinancialFacts()throws Exception{
        var ids=new ArrayList<Long>();for(int i=0;i<10;i++){
            long id=accounts.createGuest().accountId();ids.add(id);mark("1000");open(id,Position.Side.LONG);open(id,Position.Side.SHORT);
        }
        long max=0,statements,selects;
        try(var counter=RiskSqlCounter.start()){
            for(long id:ids){long start=System.nanoTime();assertThat(reconciler.check(id).status()).isEqualTo("MATCHED");max=Math.max(max,System.nanoTime()-start);}
            statements=counter.count();selects=counter.selectCount();
        }
        var field=LedgerReconciler.class.getDeclaredField("SNAPSHOT");field.setAccessible(true);
        var plan=jdbc.queryForObject("explain(analyze,buffers,format json) "+field.get(null),String.class,ids.get(0));
        assertThat(plan).contains("Actual Rows","Shared Hit Blocks");
        System.out.println("RECONCILIATION_MEASUREMENT accounts=10 fills=20 maxCheckMs="+max/1_000_000.0+" jdbcStatements="+statements+" readQueries="+selects+" plan="+plan);
    }
    @Test void corruptRoundBaselineIsHeldRatherThanRewritten(){
        long id=members.open(90_000_000L+account).accountId();
        jdbc.update("update trading.member_trading_round set start_realized_pnl=1 where account_id=?",id);
        assertThat(reconciler.check(id).failedChecks()).contains("ROUND_LEDGER");
        assertThat(jdbc.queryForObject("select start_realized_pnl from trading.member_trading_round where account_id=?",BigDecimal.class,id)).isEqualByComparingTo("1");
    }
    @Test void reviewedReleaseRequiresNewSuccessfulCheckAndPreservesFinancialAndOriginalEvidence()throws Exception{
        open(account,Position.Side.LONG);
        jdbc.update("update trading.wallet set balance=balance+1 where account_id=?",account);
        reconciler.check(account);
        long hold=jdbc.queryForObject("select id from trading.risk_hold where account_id=? and reason='LEDGER_MISMATCH'",Long.class,account);
        String evidence=jdbc.queryForObject("select evidence::text from trading.risk_hold where id=?",String.class,hold);
        jdbc.update("update trading.wallet set balance=balance-1 where account_id=?",account);
        String script=java.nio.file.Files.readString(java.nio.file.Path.of("ops/review-ledger-hold.sql"))
            .lines().filter(line->!line.startsWith("\\")).collect(java.util.stream.Collectors.joining("\n"))
            .replace(":'account_id'",Long.toString(account)).replace(":'hold_id'",Long.toString(hold)).replace(":'review_reference'","'TEST-REVIEW-123'");
        jdbc.execute(script);
        assertThat(jdbc.queryForObject("select resolved_at is null from trading.risk_hold where id=?",Boolean.class,hold)).isTrue();
        assertThat(reconciler.check(account).status()).isEqualTo("MATCHED");
        var before=financial(account);jdbc.execute(script);
        assertThat(jdbc.queryForObject("select resolved_at is not null from trading.risk_hold where id=?",Boolean.class,hold)).isTrue();
        assertThat(jdbc.queryForObject("select evidence::text from trading.risk_hold where id=?",String.class,hold)).isEqualTo(evidence);
        assertThat(financial(account)).isEqualTo(before);
    }
    private Map<String,Object> financial(long id){return jdbc.queryForMap("select to_jsonb(w)::text wallet,(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]')::text from trading.position p where p.account_id=w.account_id) positions,(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]')::text from trading.trading_order o where o.account_id=w.account_id) orders,(select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]')::text from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=w.account_id) fills from trading.wallet w where w.account_id=?",id);}
    private OrderResponse open(long id,Position.Side side){
        LegacyLeverageFixtures.tenTimes(jdbc,id,btc,side);
        return orders.create(id,key(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,side,n("1"),10,null));}
    private void mark(String price){Instant now=Instant.now();assertThat(prices.update(new LatestMarkPrice(btc,n(price),now,now))).isTrue();try{for(int i=0;i<100;i++){riskWorker.runOnce();if(jdbc.queryForObject("select count(*) from trading.risk_account_work w where status='PENDING' and not exists(select 1 from trading.risk_hold h where h.account_id=w.account_id and h.resolved_at is null and (h.event_id is null or h.event_id<=w.event_id))",Long.class)==0)return;}throw new AssertionError("risk work not drained");}catch(Exception failure){throw new AssertionError(failure);}}
    private static BigDecimal n(String value){return new BigDecimal(value);}
    private static String key(){return UUID.randomUUID().toString();}
}
