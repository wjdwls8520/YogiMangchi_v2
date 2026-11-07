package com.yogimangchi.trading.execution.recovery;

import com.yogimangchi.trading.support.LegacyLeverageFixtures;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.*;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.fill.repository.FillRepository;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"trading.risk-journal.enabled=true","binance.mark-price.enabled=false","binance.order-book.enabled=false","trading.trigger.enabled=false","trading.guest-cleanup.enabled=false","trading.risk.retention.enabled=false"})
@AutoConfigureMockMvc @Import(DurableRiskIntegrationTests.Infrastructure.class)
class DurableRiskIntegrationTests {
    @TestConfiguration(proxyBeanMethods=false) static class Infrastructure {
        @Bean static org.springframework.beans.factory.config.BeanPostProcessor sqlCounter(){return new RiskSqlCounter();}
        @Bean @ServiceConnection PostgreSQLContainer<?> postgres(){return new PostgreSQLContainer<>("postgres:17.11-alpine");}
        @Bean @ServiceConnection(name="redis") GenericContainer<?> redis(){return new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);}
    }
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired GuestRetryService retries;
    @Autowired LatestPriceStore prices;
    @Autowired DurableRiskWorker worker;
    @Autowired RiskWorkRunner runner;
    @Autowired RiskAdmission admission;
    @Autowired RiskJournalRetentionService retention;
    @Autowired com.yogimangchi.trading.reconciliation.LedgerReconciler reconciler;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @Autowired com.fasterxml.jackson.databind.ObjectMapper json;
    @Autowired TradingEngineGate gate;
    @MockitoSpyBean JdbcTemplate jdbc;
    @Autowired MemberAccounts members;
    @Autowired MemberWithdrawal withdrawal;
    @Autowired StringRedisTemplate redis;
    @Autowired RedisMarketDataBridge bridge;
    @Autowired MockMvc mvc;
    @MockitoSpyBean AccountTriggerService trigger;
    @MockitoSpyBean FillRepository fills;
    GuestAccountResponse guest;long btc;
    @BeforeEach void setup() throws Exception {
        guest=accounts.createGuest();btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc));
        await().atMost(Duration.ofSeconds(12)).until(()->bridge.health().state()==RedisMarketDataBridge.State.HEALTHY);
        tick("100");drain();
    }
    @AfterEach void cleanup(){reset(trigger,fills,jdbc);prices.markUnavailable();}
    @Test void sixSecondLateCrossingIsFilledAtReceivedDipAndManualMarketStillRequiresFreshPrice() throws Exception {
        var pending=limit(guest.accountId());tick("98");tick("102");Thread.sleep(6100);
        drain();
        assertThat(orderStatus(pending.orderId())).isEqualTo("FILLED");
        assertThat(jdbc.queryForObject("select filled_price from trading.trading_order where id=?",BigDecimal.class,pending.orderId())).isEqualByComparingTo("98");
        rejects(()->market(guest.accountId()),ErrorCode.PRICE_NOT_FRESH);
        assertThat(fillCount(guest.accountId())).isEqualTo(1);
    }
    @Test void transientLiquidationCrossingIsNotLostAfterPriceRecovery() throws Exception {
        var opened=market(guest.accountId());tick("80");tick("102");Thread.sleep(6100);drain();
        assertThat(jdbc.queryForObject("select status from trading.position where id=?",String.class,opened.positionId())).isEqualTo("LIQUIDATED");
        assertThat(jdbc.queryForObject("select f.price from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=? and o.action='LIQUIDATE'",BigDecimal.class,guest.accountId())).isEqualByComparingTo("80");
        drain();assertThat(fillCount(guest.accountId())).isEqualTo(2);
    }
    @Test void redisTrimDoesNotRemovePersistedCrossingAndRestartCannotDoubleSettle() throws Exception {
        var pending=limit(guest.accountId());tick("98");tick("102");
        redis.delete(RedisMarketDataBridge.STREAM_KEY);drain();assertThat(orderStatus(pending.orderId())).isEqualTo("FILLED");
        jdbc.update("update trading.risk_dispatch_cursor set event_id=0,price_book='{}'::jsonb where id=1");
        drain();assertThat(fillCount(guest.accountId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id=? and status='DONE'",Long.class,guest.accountId())).isEqualTo(2);
    }
    @Test void oldEventCannotLiquidateExposureCreatedAfterItAndPendingWorkFencesQuantityChanges() throws Exception {
        tick("80");tick("100");drain();var opened=market(guest.accountId());worker.runOnce();
        assertThat(jdbc.queryForObject("select status from trading.position where id=?",String.class,opened.positionId())).isEqualTo("OPEN");
        tick("99");
        rejects(()->orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(n("0.1"))),ErrorCode.ACCOUNT_RISK_PENDING);
        rejects(()->retries.retry(guest.accountId(),key()),ErrorCode.ACCOUNT_RISK_PENDING);
        drain();orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(n("0.1")));
        assertThat(fillCount(guest.accountId())).isEqualTo(2);
    }
    @Test void rollbackRetriesPreserveWalletAndCommitCheckpointIsAtomicWithFill() throws Exception {
        var pending=limit(guest.accountId());tick("98");
        var before=jdbc.queryForMap("select * from trading.wallet where account_id=?",guest.accountId());
        doThrow(new IllegalStateException("test rollback")).when(fills).save(any());worker.runOnce();
        assertThat(orderStatus(pending.orderId())).isEqualTo("PENDING");assertThat(jdbc.queryForMap("select * from trading.wallet where account_id=?",guest.accountId())).isEqualTo(before);
        assertThat(fillCount(guest.accountId())).isZero();reset(fills);
        jdbc.update("update trading.risk_account_work set next_attempt_at=clock_timestamp() where account_id=?",guest.accountId());drain();
        assertThat(orderStatus(pending.orderId())).isEqualTo("FILLED");assertThat(fillCount(guest.accountId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_work_attempt where account_id=?",Long.class,guest.accountId())).isEqualTo(1);
    }
    @Test void poisonAccountIsHeldAfterThreeFailuresWhileOtherAccountProgressesInOrder() throws Exception {
        var other=accounts.createGuest();var bad=limit(guest.accountId());var good=limit(other.accountId());
        doThrow(new IllegalStateException("poison")).when(trigger).processRecorded(argThat(p->p.accountId()==guest.accountId()));
        tick("98");tick("102");
        for(int i=0;i<5;i++){jdbc.update("update trading.risk_account_work set next_attempt_at=clock_timestamp() where account_id=?",guest.accountId());worker.runOnce();}
        assertThat(orderStatus(good.orderId())).isEqualTo("FILLED");assertThat(fillCount(other.accountId())).isEqualTo(1);
        assertThat(orderStatus(bad.orderId())).isEqualTo("PENDING");assertThat(fillCount(guest.accountId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_work_attempt where account_id=?",Long.class,guest.accountId())).isEqualTo(3);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and reason='RISK_PROCESSING_FAILED' and resolved_at is null",Long.class,guest.accountId())).isEqualTo(1);
        rejects(()->market(guest.accountId()),ErrorCode.ACCOUNT_RECOVERY_HELD);
        assertThat(market(other.accountId()).status()).isEqualTo("FILLED");
    }
    @Test void providerGapReplaysObservedCrossingAndResumesWithAuditEvidence() throws Exception {
        limit(guest.accountId());prices.beginSubscription(Set.of(btc));tick("98");worker.runOnce();
        mvc.perform(get("/api/v1/trading/account/recovery").header("Authorization","Bearer "+guest.accessToken()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CLEAR"));
        assertThat(fillCount(guest.accountId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and resolved_at is not null and resolution_reference like 'AUTO_OBSERVED_MARK_V1:%'",Long.class,guest.accountId())).isEqualTo(1);
        market(guest.accountId());
    }
    @Test void oneAccountCanExpireWallClockWithoutSuppressingTheNextAccountsSameValidTick() throws Exception {
        var other=accounts.createGuest();limit(guest.accountId());var pending=limit(other.accountId());
        doAnswer(inv->{Thread.sleep(4000);return inv.callRealMethod();}).when(trigger).processRecorded(argThat(p->p.accountId()==guest.accountId()));
        tick("98");worker.runOnce();Thread.sleep(2200);reset(trigger);drain();
        assertThat(orderStatus(pending.orderId())).isEqualTo("FILLED");assertThat(fillCount(other.accountId())).isEqualTo(1);
    }
    @Test void notionalCapHasDistinctCodeAndNeverWritesARejectedMarketFill() {
        LegacyLeverageFixtures.tenTimes(jdbc,guest.accountId(),btc,Position.Side.LONG);
        rejects(()->orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,n("10001"),10,null)),ErrorCode.ORDER_SIZE_LIMIT_EXCEEDED);
        assertThat(fillCount(guest.accountId())).isZero();
    }

    @Test void representativeTwentyAccountCrossingHasMeasuredCommitLagQueriesAndNoMissingOrDuplicateFills() throws Exception {
        List<Long> ids=new ArrayList<>();
        for(int i=0;i<20;i++){long id=accounts.createGuest().accountId();ids.add(id);limit(id);}
        var event=tick("98");
        long statements,readQueries;
        var measuredWorker=new DurableRiskWorker(jdbc,json,runner,gate,bridge,false);
        try(var measurement=RiskSqlCounter.start()){
            for(int i=0;i<100;i++){
                measuredWorker.runOnce();
                if(jdbc.queryForObject("select count(*) from trading.risk_account_work where status='PENDING' and account_id in ("+String.join(",",Collections.nCopies(ids.size(),"?"))+")",Long.class,ids.toArray())==0)break;
            }
            statements=measurement.count();readQueries=measurement.selectCount();
        }
        String slots=String.join(",",Collections.nCopies(ids.size(),"?"));
        var counts=jdbc.queryForList("select o.account_id,count(*) facts from trading.trading_order o join trading.fill f on f.order_id=o.id where o.account_id in ("+slots+") group by o.account_id",ids.toArray());
        assertThat(counts).hasSize(20);assertThat(counts).allMatch(row->((Number)row.get("facts")).longValue()==1);
        var lag=jdbc.queryForMap("select max(extract(epoch from(w.completed_at-e.occurred_at))*1000) max_receive_commit_ms,max(extract(epoch from(w.completed_at-e.recorded_at))*1000) max_work_ms from trading.risk_account_work w join trading.risk_price_event e on e.id=w.event_id where e.kind='PRICE' and e.occurred_at=? and w.account_id in ("+slots+")",java.util.stream.Stream.concat(java.util.stream.Stream.of(event.receivedAt().atOffset(ZoneOffset.UTC)),ids.stream()).toArray());
        var plan=jdbc.queryForObject("explain(analyze,buffers,format json) select w.account_id,w.event_id from trading.risk_account_work w where w.status='PENDING' and w.next_attempt_at<=clock_timestamp() and not exists(select 1 from trading.risk_account_work p where p.account_id=w.account_id and p.event_id<w.event_id and p.status in ('PENDING','HELD')) order by w.event_id,w.account_id limit 64",String.class);
        System.out.println("RISK_MEASUREMENT accounts=20 expectedFills=20 duplicate=0 missing=0 jdbcStatements="+statements+" readQueries="+readQueries+" beforeCommitMarkers="+lag+" committedMeasurements="+measuredWorker.measurements()+" plan="+plan);
        assertThat(statements).isPositive();assertThat(plan).contains("Actual Rows","Shared Hit Blocks");
        assertThat(measuredWorker.measurements().committedWork()).isGreaterThanOrEqualTo(20);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id in ("+slots+") and status='DONE'",Long.class,ids.toArray())).isEqualTo(20);
        assertThat(measuredWorker.measurements().lockTimeouts()).isZero();
        measuredWorker.close();
    }

    @Test void failedIngressOnOneSymbolIsNotForgottenWhenAnotherSymbolRecoversTheDatabase() throws Exception {
        long eth=jdbc.queryForObject("select id from trading.trading_symbol where symbol='ETH'",Long.class);
        prices.beginSubscription(Set.of(btc,eth));tick("100");Instant now=Instant.now();
        prices.update(new LatestMarkPrice(eth,n("100"),now,now));drain();
        market(guest.accountId());var other=accounts.createGuest();
        LegacyLeverageFixtures.tenTimes(jdbc,other.accountId(),eth,Position.Side.LONG);
        orders.create(other.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.MARKET,eth,Position.Side.LONG,n("1"),10,null));
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("test ingress outage")).when(jdbc)
            .queryForList(eq("select pg_advisory_xact_lock(?)"),eq(RiskAdmission.INGRESS_LOCK));
        assertThatThrownBy(()->tick("80")).isInstanceOf(org.springframework.dao.DataAccessResourceFailureException.class);
        reset(jdbc);now=Instant.now();prices.update(new LatestMarkPrice(eth,n("101"),now,now));worker.runOnce();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and trading_symbol_id=? and reason='POSTGRES_INGRESS_INTERRUPTED' and resolved_at is null",Long.class,guest.accountId(),btc)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and resolved_at is null",Long.class,other.accountId())).isZero();
        rejects(()->market(guest.accountId()),ErrorCode.ACCOUNT_RISK_PENDING);
    }

    @Test void finalWithdrawalStillCleansAllExposureAndRetiresQueuedWorkWithoutFakeFills() throws Exception {
        long member=9_000_000L+guest.accountId(),account=members.open(member).accountId();
        market(account);limit(account);tick("98");withdrawal.withdraw(member);drain();
        assertThat(jdbc.queryForObject("select status from trading.trading_account where id=?",String.class,account)).isEqualTo("WITHDRAWN");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'",Long.class,account)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='OPEN'",Long.class,account)).isZero();
        assertThat(jdbc.queryForObject("select used_margin+reserved_margin from trading.wallet where account_id=?",BigDecimal.class,account)).isZero();
        assertThat(fillCount(account)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id=? and status='RETIRED' and completion_reason='MEMBER_WITHDRAWAL'",Long.class,account)).isEqualTo(1);
    }

    @Test void riskPriceJournalNudgesEnabledWorkerImmediatelyCoalescesBurstAndNoOpsWhenDisabledOrClosed() throws Exception {
        assertThat(worker.isEnabled()).isFalse();
        long disabledQueriesBefore=worker.measurements().readyQueries();
        worker.nudge();
        assertThat(worker.measurements().readyQueries()).isEqualTo(disabledQueriesBefore);

        var enabledWorker=new DurableRiskWorker(jdbc,json,runner,gate,bridge,true);
        try {
            assertThat(enabledWorker.isEnabled()).isTrue();
            var journal=new RiskPriceJournal(jdbc,json,admission,transactions,enabledWorker);
            var pending=limit(guest.accountId());
            var entered=new java.util.concurrent.CountDownLatch(1);
            var release=new java.util.concurrent.CountDownLatch(1);
            doAnswer(inv->{
                entered.countDown();
                assertThat(release.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                return inv.callRealMethod();
            }).when(trigger).processRecorded(argThat(p->p!=null&&p.accountId()==guest.accountId()));

            var mark=tick("98");
            assertThat(worker.measurements().readyQueries()).isEqualTo(disabledQueriesBefore);
            assertThat(orderStatus(pending.orderId())).isEqualTo("PENDING");

            journal.receive(MarketDataEvent.price(mark));
            assertThat(entered.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            long queriesAtPause=enabledWorker.measurements().readyQueries();
            for(int i=0;i<10;i++)enabledWorker.nudge();
            release.countDown();

            await().atMost(Duration.ofSeconds(5)).pollInterval(Duration.ofMillis(10)).until(()->
                "FILLED".equals(orderStatus(pending.orderId()))&&enabledWorker.measurements().readyQueries()>queriesAtPause);
            assertThat(enabledWorker.measurements().committedWork()).isGreaterThanOrEqualTo(1);
            assertThat(enabledWorker.measurements().readyQueries()-queriesAtPause).isLessThanOrEqualTo(2);
            gate.requireCaughtUp(prices.findAll(Set.of(btc)));
            gate.requireAccountClear(guest.accountId());
        } finally {
            reset(trigger);
            enabledWorker.close();
        }
        assertThat(enabledWorker.isEnabled()).isFalse();
        long closedQueries=enabledWorker.measurements().readyQueries();
        enabledWorker.nudge();
        assertThat(enabledWorker.measurements().readyQueries()).isEqualTo(closedQueries);
    }

    @Test void retentionPurgesOnlyExpiredTerminalWorkAndUnreferencedEventsBelowSafeCursorAndPreservesLedger() throws Exception {
        jdbc.update("delete from trading.risk_price_head where trading_symbol_id<>?",btc);
        jdbc.update("update trading.risk_hold set resolved_at=clock_timestamp(),resolution_reference='TEST_ISOLATION_RESOLVED' where resolved_at is null");
        jdbc.update("update trading.risk_account_work set status='RETIRED',completed_at=clock_timestamp(),completion_reason='TEST_ISOLATION' where status in ('PENDING','HELD')");
        long doneAccount=accounts.createGuest().accountId();
        long memberId=9_600_000L+doneAccount;
        long retiredAccount=members.open(memberId).accountId();
        var pendingOrder=limit(doneAccount);
        market(retiredAccount);
        limit(retiredAccount);

        doThrow(new IllegalStateException("transient attempt before done")).when(trigger)
            .processRecorded(argThat(p->p!=null&&p.accountId()==doneAccount));
        tick("98");
        long expiredEventId=jdbc.queryForObject("select event_id from trading.risk_price_head where trading_symbol_id=?",Long.class,btc);
        withdrawal.withdraw(memberId);
        worker.runOnce();
        reset(trigger);
        jdbc.update("update trading.risk_account_work set next_attempt_at=clock_timestamp() where account_id=? and event_id=?",doneAccount,expiredEventId);
        drain();

        assertThat(orderStatus(pendingOrder.orderId())).isEqualTo("FILLED");
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_work_attempt where account_id=? and event_id=?",Long.class,doneAccount,expiredEventId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select status from trading.risk_account_work where account_id=? and event_id=?",String.class,doneAccount,expiredEventId)).isEqualTo("DONE");
        assertThat(jdbc.queryForObject("select status from trading.risk_account_work where account_id=? and event_id=?",String.class,retiredAccount,expiredEventId)).isEqualTo("RETIRED");

        tick("99");
        long holdReferencedEventId=jdbc.queryForObject("select event_id from trading.risk_price_head where trading_symbol_id=?",Long.class,btc);
        drain();
        jdbc.update("""
            insert into trading.risk_hold(account_id,trading_symbol_id,event_id,reason,evidence,resolved_at,resolution_reference)
            values(?,?,?,'AUDIT_HOLD_EVIDENCE','{"policy":"OBSERVED_MARK_ONLY_V1"}'::jsonb,clock_timestamp(),'AUTO_OBSERVED_MARK_V1:test-hold-reference')
            """,doneAccount,btc,holdReferencedEventId);

        tick("100");
        long recentEventId=jdbc.queryForObject("select event_id from trading.risk_price_head where trading_symbol_id=?",Long.class,btc);
        drain();

        tick("101");
        long headEventId=jdbc.queryForObject("select event_id from trading.risk_price_head where trading_symbol_id=?",Long.class,btc);
        drain();

        jdbc.update("update trading.risk_price_event set recorded_at=clock_timestamp()-interval '96 hours' where id<=?",holdReferencedEventId);
        jdbc.update("update trading.risk_account_work set completed_at=clock_timestamp()-interval '96 hours' where event_id<=? and status in ('DONE','RETIRED')",holdReferencedEventId);
        jdbc.update("update trading.risk_price_event set recorded_at=clock_timestamp()-interval '1 hour' where id=?",recentEventId);
        jdbc.update("update trading.risk_account_work set completed_at=clock_timestamp()-interval '1 hour' where event_id=? and status in ('DONE','RETIRED')",recentEventId);

        long unresolvedFenceAccount=accounts.createGuest().accountId();
        jdbc.update("insert into trading.risk_account_work(event_id,account_id,status) values(?,?,'PENDING')",expiredEventId,unresolvedFenceAccount);
        var fencedByPending=retention.purgeExpired(Instant.now());
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id=? and event_id=?",Long.class,doneAccount,expiredEventId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_work_attempt where account_id=? and event_id=?",Long.class,doneAccount,expiredEventId)).isEqualTo(1);
        assertThat(fencedByPending.purgedEvents()).isGreaterThanOrEqualTo(0);

        jdbc.update("update trading.risk_account_work set status='HELD' where account_id=? and event_id=?",unresolvedFenceAccount,expiredEventId);
        retention.purgeExpired(Instant.now());
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id=? and event_id=?",Long.class,doneAccount,expiredEventId)).isEqualTo(1);

        jdbc.update("delete from trading.risk_account_work where account_id=? and event_id=?",unresolvedFenceAccount,expiredEventId);
        jdbc.update("insert into trading.risk_account_work(event_id,account_id,status) values(?,?,'PENDING')",headEventId,unresolvedFenceAccount);

        var walletBefore=jdbc.queryForMap("select * from trading.wallet where account_id=?",doneAccount);
        long ordersBefore=jdbc.queryForObject("select count(*) from trading.trading_order where account_id=?",Long.class,doneAccount);
        long fillsBefore=fillCount(doneAccount);
        long positionsBefore=jdbc.queryForObject("select count(*) from trading.position where account_id=?",Long.class,doneAccount);

        int totalPurgedAttempts=0,totalPurgedWorks=0,totalPurgedEvents=0;
        for(int i=0;i<10;i++) {
            var batch=retention.purgeExpired(Instant.now());
            totalPurgedAttempts+=batch.purgedAttempts();
            totalPurgedWorks+=batch.purgedWorks();
            totalPurgedEvents+=batch.purgedEvents();
            if(batch.purgedAttempts()==0&&batch.purgedWorks()==0&&batch.purgedEvents()==0)break;
        }
        System.out.println("RETENTION_PURGE_MEASUREMENT purgedAttempts="+totalPurgedAttempts+" purgedWorks="+totalPurgedWorks+" purgedEvents="+totalPurgedEvents);

        assertThat(totalPurgedAttempts).isGreaterThanOrEqualTo(1);
        assertThat(totalPurgedWorks).isGreaterThanOrEqualTo(2);
        assertThat(totalPurgedEvents).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_work_attempt where account_id=? and event_id=?",Long.class,doneAccount,expiredEventId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id in (?,?) and event_id=?",Long.class,doneAccount,retiredAccount,expiredEventId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_price_event where id=?",Long.class,expiredEventId)).isZero();

        assertThat(jdbc.queryForObject("select count(*) from trading.risk_price_event where id=?",Long.class,holdReferencedEventId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_price_event where id=?",Long.class,recentEventId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_price_event where id=?",Long.class,headEventId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id=? and event_id=? and status='PENDING'",Long.class,unresolvedFenceAccount,headEventId)).isEqualTo(1);

        assertThat(jdbc.queryForMap("select * from trading.wallet where account_id=?",doneAccount)).isEqualTo(walletBefore);
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=?",Long.class,doneAccount)).isEqualTo(ordersBefore);
        assertThat(fillCount(doneAccount)).isEqualTo(fillsBefore);
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=?",Long.class,doneAccount)).isEqualTo(positionsBefore);
        assertThat(reconciler.check(doneAccount).status()).isEqualTo("MATCHED");

        jdbc.update("delete from trading.risk_account_work where account_id=? and event_id=?",unresolvedFenceAccount,headEventId);
    }

    @Test void continuousMultiAccountPriceTickRehearsalMeasuresEndToEndP50P95LatencyWithZeroLedgerMismatch() throws Exception {
        List<Long> rehearsalAccounts=new ArrayList<>();
        for(int i=0;i<20;i++) {
            long accountId=accounts.createGuest().accountId();
            rehearsalAccounts.add(accountId);
            if(i>=10)market(accountId);
            limit(accountId);
        }
        String accountSlots=String.join(",",Collections.nCopies(rehearsalAccounts.size(),"?"));
        var liveWorker=new DurableRiskWorker(jdbc,json,runner,gate,bridge,true);
        liveWorker.start();
        try {
            var liveJournal=new RiskPriceJournal(jdbc,json,admission,transactions,liveWorker);
            List<Long> rehearsalEventIds=new ArrayList<>();
            List<Long> tickDrainWallMs=new ArrayList<>();
            for(String priceText:List.of("99","97","80","101")) {
                long startedNs=System.nanoTime();
                var mark=tick(priceText);
                liveJournal.receive(MarketDataEvent.price(mark));
                long eventId=jdbc.queryForObject("select event_id from trading.risk_price_head where trading_symbol_id=?",Long.class,btc);
                rehearsalEventIds.add(eventId);
                Object[] params=java.util.stream.Stream.concat(java.util.stream.Stream.of(eventId),rehearsalAccounts.stream()).toArray();
                await().atMost(Duration.ofSeconds(10)).pollInterval(Duration.ofMillis(5)).until(()->
                    jdbc.queryForObject("select count(*) from trading.risk_account_work where event_id<=? and status in ('PENDING','HELD') and account_id in ("+accountSlots+")",Long.class,params)==0
                    &&"READY".equals(gate.status()));
                gate.requireCaughtUp(prices.findAll(Set.of(btc)));
                tickDrainWallMs.add(java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-startedNs));
            }

            String eventSlots=String.join(",",Collections.nCopies(rehearsalEventIds.size(),"?"));
            Object[] queryArgs=java.util.stream.Stream.concat(rehearsalEventIds.stream(),rehearsalAccounts.stream()).toArray();
            var rows=jdbc.queryForList("""
                select extract(epoch from (w.completed_at - e.recorded_at)) * 1000.0 as work_ms,
                       extract(epoch from (w.completed_at - e.occurred_at)) * 1000.0 as receive_commit_ms
                from trading.risk_account_work w
                join trading.risk_price_event e on e.id = w.event_id
                where w.status = 'DONE'
                  and w.event_id in (%s)
                  and w.account_id in (%s)
                order by w.event_id, w.account_id
                """.formatted(eventSlots,accountSlots),queryArgs);

            assertThat(rows).isNotEmpty();
            List<Double> workMs=rows.stream().map(r->((Number)r.get("work_ms")).doubleValue()).sorted().toList();
            List<Double> receiveCommitMs=rows.stream().map(r->((Number)r.get("receive_commit_ms")).doubleValue()).sorted().toList();
            double p50WorkMs=percentile(workMs,0.50);
            double p95WorkMs=percentile(workMs,0.95);
            double maxWorkMs=workMs.get(workMs.size()-1);
            double p50ReceiveCommitMs=percentile(receiveCommitMs,0.50);
            double p95ReceiveCommitMs=percentile(receiveCommitMs,0.95);
            double maxReceiveCommitMs=receiveCommitMs.get(receiveCommitMs.size()-1);

            System.out.println(String.format(java.util.Locale.ROOT,
                "CONTINUOUS_E2E_LATENCY accounts=%d ticks=%d workItems=%d p50WorkMs=%.2f p95WorkMs=%.2f maxWorkMs=%.2f p50ReceiveCommitMs=%.2f p95ReceiveCommitMs=%.2f maxReceiveCommitMs=%.2f tickDrainWallMs=%s",
                rehearsalAccounts.size(),rehearsalEventIds.size(),rows.size(),p50WorkMs,p95WorkMs,maxWorkMs,p50ReceiveCommitMs,p95ReceiveCommitMs,maxReceiveCommitMs,tickDrainWallMs));

            long limitFills=jdbc.queryForObject(
                "select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.type='LIMIT' and o.account_id in ("+accountSlots+")",
                Long.class,rehearsalAccounts.toArray());
            long liquidationFills=jdbc.queryForObject(
                "select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.action='LIQUIDATE' and o.account_id in ("+accountSlots+")",
                Long.class,rehearsalAccounts.toArray());
            assertThat(limitFills).isEqualTo(20);
            assertThat(liquidationFills).isEqualTo(20);
            for(long accountId:rehearsalAccounts) {
                gate.requireAccountClear(accountId);
                assertThat(reconciler.check(accountId).status()).isEqualTo("MATCHED");
            }
        } finally {
            liveWorker.close();
            worker.runOnce();
        }
    }

    private static double percentile(List<Double> sorted,double quantile) {
        int index=(int)Math.ceil(quantile*sorted.size())-1;
        return sorted.get(Math.max(0,Math.min(sorted.size()-1,index)));
    }

    private void drain() throws Exception {
        await().atMost(Duration.ofSeconds(15)).pollInterval(Duration.ofMillis(25)).until(()->{
            worker.runOnce();
            return jdbc.queryForObject("select count(*) from trading.risk_account_work w where w.status='PENDING' and not exists(select 1 from trading.risk_hold h where h.account_id=w.account_id and h.resolved_at is null and (h.event_id is null or h.event_id<=w.event_id) and not ("+RiskGapRecovery.AUTOMATIC_HOLD+"))",Long.class)==0;
        });
    }
    private OrderResponse limit(long account){
        LegacyLeverageFixtures.tenTimes(jdbc,account,btc,Position.Side.LONG);
        return orders.create(account,key(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,n("1"),10,n("99")));}
    private OrderResponse market(long account){
        LegacyLeverageFixtures.tenTimes(jdbc,account,btc,Position.Side.LONG);
        return orders.create(account,key(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,n("1"),10,null));}
    private LatestMarkPrice tick(String amount){Instant now=Instant.now();var tick=new LatestMarkPrice(btc,n(amount),now,now);assertThat(prices.update(tick)).isTrue();return tick;}
    private String orderStatus(long order){return jdbc.queryForObject("select status from trading.trading_order where id=?",String.class,order);}
    private long fillCount(long account){return jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,account);}
    private static void rejects(Runnable action,ErrorCode code){assertThatThrownBy(action::run).isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getCode()).isEqualTo(code));}
    private static BigDecimal n(String v){return new BigDecimal(v);}
    private static String key(){return UUID.randomUUID().toString();}
}
