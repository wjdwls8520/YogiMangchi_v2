package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.stoploss.*;
import com.yogimangchi.trading.tradingaccount.service.MemberAccounts;
import com.yogimangchi.trading.tradinground.MemberRounds;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.nio.file.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

@SpringBootTest(properties={"trading.risk-journal.enabled=true","trading.trigger.enabled=false",
        "trading.reconciliation.enabled=false","trading.guest-cleanup.enabled=false",
        "binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(DurableRiskIntegrationTests.Infrastructure.class)
class LifecycleTimeValidationIntegrationTests {
    static final AtomicLong MEMBERS=new AtomicLong(96_000_000);
    @Autowired MemberAccounts members; @Autowired TradingOrderService orders; @Autowired StopLossService stops;
    @Autowired MemberRounds rounds; @Autowired LatestPriceStore prices; @Autowired DurableRiskWorker worker;
    @Autowired TradingEngineGate gate; @Autowired RedisMarketDataBridge bridge; @Autowired ObjectMapper json;
    @Autowired PlatformTransactionManager transactions; @MockitoSpyBean JdbcTemplate jdbc;
    @Autowired EntityManager entities;
    final AtomicLong positionId=new AtomicLong();
    final AtomicReference<Instant> controlledTime=new AtomicReference<>();
    final List<Map<String,Object>> observations=new CopyOnWriteArrayList<>();
    long account,btc;

    @BeforeEach void setup()throws Exception{
        account=members.open(MEMBERS.incrementAndGet()).accountId();
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc));
        await().atMost(Duration.ofSeconds(12)).until(()->bridge.health().state()==RedisMarketDataBridge.State.HEALTHY);
        Instant now=Instant.now();assertThat(prices.update(new LatestMarkPrice(btc,n("1000"),now,now))).isTrue();
        await().atMost(Duration.ofSeconds(10)).until(()->{worker.runOnce();return gate.status().equals("READY");});
        doAnswer(call->{
            Instant j0=Instant.now();Timestamp database=(Timestamp)call.callRealMethod();Instant j1=Instant.now();
            Instant supplied=controlledTime.get()==null?database.toInstant():controlledTime.get();
            var observed=new LinkedHashMap<String,Object>();observed.put("stage","lifecycle-clock-after-account-lock");
            observed.put("mode",controlledTime.get()==null?"NATURAL_DATABASE_CLOCK":"CONTROLLED_OFFSET_NOT_ORIGINAL_REPRODUCTION");
            observed.put("jvmBefore",j0.toString());observed.put("databaseActual",database.toInstant().toString());
            observed.put("jvmAfter",j1.toString());observed.put("suppliedToLifecycle",supplied.toString());
            observed.put("position",state());observations.add(observed);
            return Timestamp.from(supplied);
        }).when(jdbc).queryForObject(eq("select clock_timestamp()"),eq(Timestamp.class));
        doAnswer(call->{
            Object result=call.callRealMethod();
            observations.add(Map.of("stage","retirement-after-reservation-release-before-position-close","position",state()));
            return result;
        }).when(jdbc).update(startsWith("insert into trading.member_round_retirement("),any(Object[].class));
    }
    @AfterEach void cleanup(){reset(jdbc);prices.markUnavailable();}

    @ParameterizedTest @ValueSource(booleans={false,true})
    void realAccountLockWaitTakesDatabaseClockOnlyAfterOpenCommit(boolean pendingClose)throws Exception{
        var pool=Executors.newFixedThreadPool(2);var opened=new CountDownLatch(1);var release=new CountDownLatch(1);
        var restartPid=new AtomicInteger();var tx=new TransactionTemplate(transactions);tx.setTimeout(10);
        Future<?> opening=pool.submit(()->tx.executeWithoutResult(status->{
            var order=open();positionId.set(order.positionId());
            if(pendingClose)orders.createLimitClose(account,order.positionId(),key(),new LimitCloseRequest(n("0.25"),n("1100")));
            entities.flush();
            assertThat(new BigDecimal(state().get("reserved_close_quantity").toString())).isEqualByComparingTo(pendingClose?"0.25":"0");
            observations.add(Map.of("stage","uncommitted-open-holds-account-lock","position",state()));opened.countDown();
            try{if(!release.await(5,TimeUnit.SECONDS))throw new IllegalStateException("Test release timed out");}
            catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}
        }));
        Future<MemberRounds.Restart> restarting=null;
        try{
            await().atMost(Duration.ofSeconds(5)).until(()->opened.getCount()==0||opening.isDone());
            if(opening.isDone())opening.get();
            restarting=pool.submit(()->tx.execute(status->{restartPid.set(jdbc.queryForObject("select pg_backend_pid()",Integer.class));return rounds.restart(account,key());}));
            await().atMost(Duration.ofSeconds(1)).until(()->restartPid.get()!=0&&Boolean.TRUE.equals(jdbc.queryForObject(
                    "select exists(select 1 from pg_stat_activity where pid=? and wait_event_type='Lock' and wait_event in ('transactionid','tuple'))",Boolean.class,restartPid.get())));
            assertThat(observations.stream().filter(o->o.get("stage").equals("lifecycle-clock-after-account-lock"))).isEmpty();
            observations.add(Map.of("stage","restart-confirmed-waiting-on-real-postgres-lock","backendPid",restartPid.get()));
            release.countDown();opening.get(5,TimeUnit.SECONDS);var result=restarting.get(5,TimeUnit.SECONDS);
            assertThat(result.roundNumber()).isEqualTo(2);assertThat(result.closedPositionCount()).isEqualTo(1);
            assertThat(result.canceledOrderCount()).isEqualTo(pendingClose?1:0);
            assertThat(state()).containsEntry("status","CLOSED");
            assertThat(jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,account)).isEqualTo(1);
            var entry=observations.stream().filter(o->o.get("stage").equals("retirement-after-reservation-release-before-position-close")).findFirst().orElseThrow();
            @SuppressWarnings("unchecked") var beforeClose=(Map<String,Object>)entry.get("position");
            assertThat(new BigDecimal(beforeClose.get("reserved_close_quantity").toString())).isZero();
        } finally {
            release.countDown();
            try{if(restarting!=null)restarting.get(5,TimeUnit.SECONDS);}
            catch(ExecutionException|TimeoutException ignored){/* Original get/assertion retains the failure. */}
            finally{pool.shutdownNow();save("natural-pending-"+pendingClose);}
        }
    }

    enum ClockBoundary { BEFORE_OPEN, BEFORE_LATEST_CHANGE, AFTER_LATEST_CHANGE }

    @ParameterizedTest @EnumSource(ClockBoundary.class)
    void controlledOffsetSeparatesGuardRejectionFromNaturalClockEvidence(ClockBoundary boundary)throws Exception{
        var opened=open();positionId.set(opened.positionId());
        stops.put(account,opened.positionId(),key(),new StopLossRequest(n("950"),0L));
        Instant openTime=jdbc.queryForObject("select opened_at from trading.position where id=?",Timestamp.class,opened.positionId()).toInstant();
        Instant lastChange=jdbc.queryForObject("select last_financial_change_at from trading.trading_account where id=?",Timestamp.class,account).toInstant();
        assertThat(lastChange.minusNanos(1000)).isAfter(openTime);
        Instant injected=switch(boundary){
            case BEFORE_OPEN -> openTime.minusMillis(1);
            case BEFORE_LATEST_CHANGE -> lastChange.minusNanos(1000);
            case AFTER_LATEST_CHANGE -> lastChange.plusMillis(1);
        };
        controlledTime.set(injected);
        observations.add(Map.of("stage","controlled-clock-boundaries","openedAt",openTime.toString(),"lastFinancialChangeAt",lastChange.toString(),"supplied",injected.toString()));
        var before=snapshot();
        try{
            switch(boundary){
                case BEFORE_OPEN -> {
                    assertThatThrownBy(()->rounds.restart(account,key())).isInstanceOf(IllegalStateException.class)
                            .hasMessageContaining("status=OPEN, hasReservation=false, closesBeforeOpen=true");
                    assertThat(snapshot()).isEqualTo(before);
                }
                case BEFORE_LATEST_CHANGE -> {
                    assertThatThrownBy(()->rounds.restart(account,key())).isInstanceOf(IllegalArgumentException.class)
                            .hasMessage("Financial time cannot move backwards");
                    assertThat(snapshot()).isEqualTo(before);
                }
                case AFTER_LATEST_CHANGE -> {
                    assertThat(rounds.restart(account,key()).roundNumber()).isEqualTo(2);
                    assertThat(state()).containsEntry("status","CLOSED");
                }
            }
        } finally{save("controlled-"+boundary.name().toLowerCase(Locale.ROOT));}
    }
    private com.yogimangchi.trading.order.dto.OrderResponse open(){return orders.create(account,key(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,n("1"),1,null));}
    private Map<String,Object> state(){
        if(positionId.get()==0)return Map.of();
        return jdbc.queryForMap("select status,reserved_close_quantity::text,opened_at::text,closed_at::text,stop_loss_status,stop_loss_version from trading.position where id=?",positionId.get());
    }
    private Map<String,Object> snapshot(){
        var result=new LinkedHashMap<String,Object>();result.put("position",state());
        result.put("wallet",jdbc.queryForMap("select balance,used_margin,reserved_margin,realized_pnl,fees_paid,settlement_adjustment from trading.wallet where account_id=?",account));
        result.put("lastFinancialChange",jdbc.queryForObject("select last_financial_change_at from trading.trading_account where id=?",Timestamp.class,account));
        result.put("rounds",jdbc.queryForObject("select count(*) from trading.member_trading_round where account_id=?",Long.class,account));
        result.put("restarts",jdbc.queryForObject("select count(*) from trading.member_restart where account_id=?",Long.class,account));
        result.put("events",jdbc.queryForObject("select count(*) from trading.trading_event where account_id=?",Long.class,account));
        result.put("retirement",jdbc.queryForObject("select count(*) from trading.member_round_retirement where position_id=?",Long.class,positionId.get()));
        return result;
    }
    private void save(String name)throws Exception{
        Files.createDirectories(Path.of(".gradle"));json.writerWithDefaultPrettyPrinter().writeValue(Path.of(".gradle/tr02-"+name+".json").toFile(),Map.of(
                "scenario",name,"accountId",account,"observations",observations));
        System.out.println("TR02_LIFECYCLE_EVIDENCE scenario="+name+" observations="+observations.size());
    }
    private static BigDecimal n(String value){return new BigDecimal(value);}
    private static String key(){return UUID.randomUUID().toString();}
}
