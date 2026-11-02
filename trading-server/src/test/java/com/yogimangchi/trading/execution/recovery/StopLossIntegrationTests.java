package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.*;
import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.*;
import com.yogimangchi.trading.execution.trigger.*;
import com.yogimangchi.trading.fill.repository.FillRepository;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.stoploss.*;
import com.yogimangchi.trading.tradingaccount.service.*;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import com.yogimangchi.trading.tradinground.MemberRounds;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"trading.risk-journal.enabled=true","trading.member-auth.enabled=true","trading.trigger.enabled=false","trading.reconciliation.enabled=false","trading.guest-cleanup.enabled=false","binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@AutoConfigureMockMvc @Import(DurableRiskIntegrationTests.Infrastructure.class)
class StopLossIntegrationTests {
    @DynamicPropertySource static void jwt(DynamicPropertyRegistry settings){MemberTradingSoakTests.jwt(settings);}
    static final AtomicLong MEMBERS=new AtomicLong(94_000_000);
    @Autowired MemberAccounts members; @Autowired TradingAccountService accounts; @Autowired TradingOrderService orders;
    @Autowired StopLossService stops; @Autowired SymbolLeverageService leverages; @Autowired LatestPriceStore prices;
    @Autowired DurableRiskWorker worker; @Autowired RiskWorkRunner runner; @Autowired RedisMarketDataBridge bridge;
    @Autowired TradingEngineGate gate; @Autowired AccountTriggerService trigger; @Autowired TradingEvents events;
    @Autowired LedgerReconciler ledger; @MockitoSpyBean JdbcTemplate jdbc; @Autowired ObjectMapper json;
    @Autowired MemberRounds rounds; @Autowired GuestRetryService retries; @Autowired MemberWithdrawal withdrawal;
    @Autowired MockMvc mvc; @LocalServerPort int port; @MockitoSpyBean FillRepository fills;
    long account,member,btc,eth; MemberTradingSoakTests.Actor actor;

    @BeforeEach void setup()throws Exception{
        member=MEMBERS.incrementAndGet(); account=members.open(member).accountId();
        btc=symbol("BTC");eth=symbol("ETH");actor=new MemberTradingSoakTests.Actor(member,btc);actor.id=account;
        prices.beginSubscription(Set.of(btc,eth));await().atMost(Duration.ofSeconds(12)).until(()->bridge.health().state()==RedisMarketDataBridge.State.HEALTHY);
        mark(btc,"1000");mark(eth,"100");drain();
        leverages.change(account,btc,Position.Side.LONG,10);leverages.change(account,btc,Position.Side.SHORT,10);
    }
    @AfterEach void stop(){reset(fills,jdbc);prices.markUnavailable();}

    @ParameterizedTest @EnumSource(Position.Side.class)
    void crossedMarkExecutesRemainingMarketAtActualPriceAndKeepsFeesAndEvents(Position.Side side)throws Exception{
        var position=open(account,btc,side,"1");String settingKey=key();
        var active=stops.put(account,position.positionId(),settingKey,new StopLossRequest(n(side==Position.Side.LONG?"950":"1050"),0L));
        assertThat(active.version()).isEqualTo(1);assertThat(active.status()).isEqualTo("ACTIVE");
        mark(btc,side==Position.Side.LONG?"940":"1060");drain();
        var done=stops.get(account,position.positionId());assertThat(done.status()).isEqualTo("TRIGGERED");assertThat(done.version()).isEqualTo(2);
        var order=orders.history(account,null,20).stream().filter(o->o.orderId().equals(done.triggerOrderId())).findFirst().orElseThrow();
        assertThat(order.action()).isEqualTo("CLOSE");assertThat(order.type()).isEqualTo("MARKET");assertThat(order.reason()).isEqualTo("STOP_LOSS");
        eq(order.fill().price(),side==Position.Side.LONG?"940":"1060");eq(order.fill().realizedPnl(),"-60");
        eq(order.fill().fee(),side==Position.Side.LONG?"0.47":"0.53");
        assertThat(stops.put(account,position.positionId(),settingKey,new StopLossRequest(n(side==Position.Side.LONG?"950":"1050"),0L))).isEqualTo(active);
        var first=events.after(account,0,100).stream().filter(e->e.stopLoss()!=null).toList();
        assertThat(first).hasSize(2);assertThat(first.get(0).order()).isNull();assertThat(first.get(0).stopLoss()).isEqualTo(active);
        assertThat(first.get(1).stopLoss()).isEqualTo(done);assertThat(first).allMatch(e->e.roundId().equals(rounds.current(account).round().roundId()));
        worker.runOnce();assertThat(fillCount(account)).isEqualTo(2);assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }

    @Test void pendingCrossingCannotBeCanceledOrReplacedAndExpiredReplaySurvivesWorkerRestart()throws Exception{
        var opened=open(account,btc,Position.Side.LONG,"1");stops.put(account,opened.positionId(),key(),new StopLossRequest(n("950"),0L));
        mark(btc,"940");Thread.sleep(6100);
        rejects(()->stops.delete(account,opened.positionId(),key(),1L),ErrorCode.ACCOUNT_RISK_PENDING);
        rejects(()->stops.put(account,opened.positionId(),key(),new StopLossRequest(n("930"),1L)),ErrorCode.ACCOUNT_RISK_PENDING);
        var restarted=new DurableRiskWorker(jdbc,json,runner,gate,bridge,false);
        try{restarted.runOnce();restarted.runOnce();}finally{restarted.close();}
        assertThat(stops.get(account,opened.positionId()).status()).isEqualTo("TRIGGERED");
        assertThat(fillCount(account)).isEqualTo(2);eq(orders.history(account,null,10).get(0).fill().price(),"940");
    }

    @Test void stopTracksAdditionsAndPartialExitsAndAtomicallyReleasesAllCloseReservations()throws Exception{
        var opened=open(account,btc,Position.Side.LONG,"1");stops.put(account,opened.positionId(),key(),new StopLossRequest(n("950"),0L));
        open(account,btc,Position.Side.LONG,"0.5");orders.close(account,opened.positionId(),key(),new ClosePositionRequest(n("0.2")));
        assertThat(stops.get(account,opened.positionId()).version()).isEqualTo(1);
        var reserved=orders.createLimitClose(account,opened.positionId(),key(),new LimitCloseRequest(n("1.3"),n("1100")));
        mark(btc,"940");drain();
        var history=orders.history(account,null,20);
        var stopped=history.stream().filter(o->"STOP_LOSS".equals(o.reason())&&o.status().equals("FILLED")).findFirst().orElseThrow();
        eq(stopped.quantity(),"1.3");assertThat(history.stream().filter(o->o.orderId().equals(reserved.orderId())).findFirst().orElseThrow().reason()).isEqualTo("STOP_LOSS");
        assertThat(jdbc.queryForObject("select reserved_close_quantity from trading.position where id=?",BigDecimal.class,opened.positionId())).isZero();
        assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }

    @Test void liquidationWinsGapAndNeverPretendsStopFilled()throws Exception{
        var opened=open(account,btc,Position.Side.LONG,"1");stops.put(account,opened.positionId(),key(),new StopLossRequest(n("950"),0L));
        orders.createLimitClose(account,opened.positionId(),key(),new LimitCloseRequest(n("1"),n("1100")));
        mark(btc,"800");drain();
        var done=stops.get(account,opened.positionId());assertThat(done.status()).isEqualTo("EXPIRED");assertThat(done.reason()).isEqualTo("POSITION_LIQUIDATED");assertThat(done.triggerOrderId()).isNull();
        assertThat(orders.history(account,null,20).stream().filter(o->o.status().equals("FILLED")))
                .anyMatch(o->o.action().equals("LIQUIDATE")).noneMatch(o->"STOP_LOSS".equals(o.reason()));
        assertThat(fillCount(account)).isEqualTo(2);assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }

    @Test void oldArmingTickCannotTriggerNewOrReplacedStopAndProfitProtectionIsAllowed()throws Exception{
        var opened=open(account,btc,Position.Side.LONG,"1");
        var old=mark(btc,"980");drain();mark(btc,"1100");drain();
        var first=stops.put(account,opened.positionId(),key(),new StopLossRequest(n("1020"),0L));
        trigger.process(account,old,Map.of(btc,old));assertThat(stops.get(account,opened.positionId()).status()).isEqualTo("ACTIVE");
        var second=stops.put(account,opened.positionId(),key(),new StopLossRequest(n("1030"),first.version()));
        trigger.process(account,old,Map.of(btc,old));assertThat(stops.get(account,opened.positionId())).isEqualTo(second);
        mark(btc,"1025");drain();assertThat(stops.get(account,opened.positionId()).status()).isEqualTo("TRIGGERED");
        assertThat(events.after(account,0,100).stream().filter(e->e.stopLoss()!=null).map(e->e.stopLoss().stopPrice()))
                .containsExactly(first.stopPrice(),second.stopPrice(),second.stopPrice());
    }

    @Test void oldStopNeverTransfersToNewLifecycleCreatedByPendingOpenOnSameTick()throws Exception{
        var opened=open(account,btc,Position.Side.LONG,"1");stops.put(account,opened.positionId(),key(),new StopLossRequest(n("950"),0L));
        orders.create(account,key(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,n("0.2"),10,n("949")));
        mark(btc,"940");drain();
        var fresh=accounts.summary(account).positions();assertThat(fresh).hasSize(1);
        assertThat(fresh.get(0).id()).isNotEqualTo(opened.positionId());assertThat(fresh.get(0).stopLoss().status()).isEqualTo("NONE");
        assertThat(fresh.get(0).stopLoss().version()).isZero();assertThat(stops.get(account,opened.positionId()).status()).isEqualTo("TRIGGERED");
        assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }

    @Test void failedFillRollsBackStopCancelReservationsWalletAndEventsThenReplaysOnce()throws Exception{
        var opened=open(account,btc,Position.Side.LONG,"1");var active=stops.put(account,opened.positionId(),key(),new StopLossRequest(n("950"),0L));
        var pending=orders.createLimitClose(account,opened.positionId(),key(),new LimitCloseRequest(n("0.7"),n("1100")));
        long before=jdbc.queryForObject("select count(*) from trading.trading_event where account_id=?",Long.class,account);
        doThrow(new IllegalStateException("test stop fill failure")).when(fills).save(any());mark(btc,"940");worker.runOnce();
        assertThat(stops.get(account,opened.positionId())).isEqualTo(active);assertThat(orders.pending(account)).anyMatch(o->o.orderId().equals(pending.orderId()));
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_event where account_id=?",Long.class,account)).isEqualTo(before);
        reset(fills);jdbc.update("update trading.risk_account_work set next_attempt_at=clock_timestamp() where account_id=?",account);drain();
        assertThat(stops.get(account,opened.positionId()).status()).isEqualTo("TRIGGERED");assertThat(fillCount(account)).isEqualTo(2);
        assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }

    @Test void cancelAndUpdateAndReceivedTickSerializeWithoutDuplicateExit()throws Exception{
        var opened=open(account,btc,Position.Side.LONG,"1");stops.put(account,opened.positionId(),key(),new StopLossRequest(n("950"),0L));
        var pool=Executors.newFixedThreadPool(3);var start=new CountDownLatch(1);
        try{
            var actions=List.<Runnable>of(()->stops.delete(account,opened.positionId(),key(),1L),
                    ()->stops.put(account,opened.positionId(),key(),new StopLossRequest(n("960"),1L)),()->mark(btc,"940"));
            var tasks=new ArrayList<Future<?>>();for(var action:actions)tasks.add(pool.submit(()->{try{start.await();action.run();}catch(BusinessException rejection){assertThat(rejection.getCode()).isIn(ErrorCode.STOP_LOSS_VERSION_CONFLICT,ErrorCode.ACCOUNT_RISK_PENDING,ErrorCode.POSITION_NOT_OPEN,ErrorCode.ENGINE_RECOVERING,ErrorCode.TRADING_BUSY);}catch(InterruptedException interrupted){throw new RuntimeException(interrupted);}}));
            start.countDown();for(var task:tasks)task.get(15,TimeUnit.SECONDS);drain();mark(btc,"940");drain();
            assertThat(fillCount(account)).isBetween(1L,2L);assertThat(stops.get(account,opened.positionId()).status()).isIn("CANCELED","TRIGGERED");
            assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
        }finally{pool.shutdownNow();}
    }

    @Test void versionsIdempotencyOwnershipValidationAndDeleteCorsAreExplicit()throws Exception{
        var opened=open(account,btc,Position.Side.LONG,"1");String path="/api/v1/trading/account/positions/"+opened.positionId()+"/stop-loss";
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(get(path).header("Authorization","Bearer "+actor.token())).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("NONE")).andExpect(jsonPath("$.version").value(0)).andExpect(jsonPath("$.stopPrice").isEmpty());
        for(String incomplete:List.of("{\"stopPrice\":\"950\"}","{\"expectedVersion\":0}"))
            mvc.perform(put(path).header("Authorization","Bearer "+actor.token()).header("Idempotency-Key",key()).contentType("application/json").content(incomplete))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_STOP_LOSS"));
        String key=key();var original=stops.put(account,opened.positionId(),key,new StopLossRequest(n("950"),0L));
        assertThat(stops.put(account,opened.positionId(),key,new StopLossRequest(n("950.0"),0L))).isEqualTo(original);
        rejects(()->stops.put(account,opened.positionId(),key,new StopLossRequest(n("960"),0L)),ErrorCode.IDEMPOTENCY_CONFLICT);
        rejects(()->stops.put(account,opened.positionId(),key(),new StopLossRequest(n("960"),0L)),ErrorCode.STOP_LOSS_VERSION_CONFLICT);
        rejects(()->stops.put(account,opened.positionId(),key(),new StopLossRequest(n("1000"),1L)),ErrorCode.STOP_LOSS_NOT_PROTECTIVE);
        rejects(()->stops.put(account,opened.positionId(),key(),new StopLossRequest(n("800"),1L)),ErrorCode.STOP_LOSS_BEYOND_LIQUIDATION);
        for(String price:List.of("0","-1","1.0000000000000000001","100000000000000000000"))
            rejects(()->stops.put(account,opened.positionId(),key(),new StopLossRequest(n(price),1L)),ErrorCode.INVALID_STOP_LOSS);
        var foreign=members.open(MEMBERS.incrementAndGet());rejects(()->stops.get(foreign.accountId(),opened.positionId()),ErrorCode.POSITION_NOT_FOUND);
        rejects(()->stops.delete(foreign.accountId(),opened.positionId(),key(),1L),ErrorCode.POSITION_NOT_FOUND);
        mvc.perform(options(path).header("Origin","http://localhost:3000").header("Access-Control-Request-Method","DELETE"))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin","http://localhost:3000"));
        mvc.perform(delete(path).param("expectedVersion","1").header("Authorization","Bearer "+actor.token()).header("Idempotency-Key",key()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELED"));
        mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andExpect(jsonPath("$.paths['/api/v1/trading/account/positions/{positionId}/stop-loss'].put").exists())
                .andExpect(jsonPath("$.components.schemas.StopLossRequest.required").value(org.hamcrest.Matchers.containsInAnyOrder("stopPrice","expectedVersion")));
    }

    @RepeatedTest(3) void manualCloseRestartGuestRetryAndFinalWithdrawalExpireStopWithoutFakeFill()throws Exception{
        var first=open(account,btc,Position.Side.LONG,"1");stops.put(account,first.positionId(),key(),new StopLossRequest(n("950"),0L));
        orders.close(account,first.positionId(),key());assertThat(stops.get(account,first.positionId()).reason()).isEqualTo("POSITION_CLOSED");
        var second=open(account,btc,Position.Side.LONG,"1");stops.put(account,second.positionId(),key(),new StopLossRequest(n("950"),0L));
        long fillsBefore=fillCount(account);
        Instant t0=Instant.now(),database=jdbc.queryForObject("select clock_timestamp()",java.sql.Timestamp.class).toInstant(),t1=Instant.now();
        System.out.println("SL_CLOCK_OBSERVATION serverT0="+t0+" database="+database+" serverT1="+t1+" state="+jdbc.queryForMap("select status,reserved_close_quantity,opened_at from trading.position where id=?",second.positionId()));
        rounds.restart(account,key());assertThat(fillCount(account)).isEqualTo(fillsBefore);
        assertThat(stops.get(account,second.positionId()).reason()).isEqualTo("MEMBER_RESTART");
        var third=open(account,btc,Position.Side.LONG,"1");stops.put(account,third.positionId(),key(),new StopLossRequest(n("950"),0L));
        withdrawal.withdraw(member);assertThat(jdbc.queryForObject("select stop_loss_reason from trading.position where id=?",String.class,third.positionId())).isEqualTo("MEMBER_WITHDRAWAL");
        var guest=accounts.createGuest();var fourth=open(guest.accountId(),btc,Position.Side.SHORT,"1");
        stops.put(guest.accountId(),fourth.positionId(),key(),new StopLossRequest(n("1050"),0L));retries.retry(guest.accountId(),key());
        assertThat(stops.get(guest.accountId(),fourth.positionId()).reason()).isEqualTo("GUEST_RETRY");assertThat(fillCount(guest.accountId())).isEqualTo(1);
    }

    @Test void privateWebsocketReplaysImmutableStopSnapshotWithNullOrderAndVersion()throws Exception{
        var opened=open(account,btc,Position.Side.LONG,"1");var active=stops.put(account,opened.positionId(),key(),new StopLossRequest(n("950"),0L));
        stops.put(account,opened.positionId(),key(),new StopLossRequest(n("960"),active.version()));
        var received=new LinkedBlockingQueue<JsonNode>();var buffer=new StringBuilder();
        WebSocket socket=HttpClient.newHttpClient().newWebSocketBuilder().header("Origin","http://localhost:3000").buildAsync(URI.create("ws://localhost:"+port+"/ws/trading"),new WebSocket.Listener(){
            public void onOpen(WebSocket ws){ws.request(1);}
            public CompletionStage<?> onText(WebSocket ws,CharSequence data,boolean last){buffer.append(data);if(last){try{received.add(json.readTree(buffer.toString()));buffer.setLength(0);}catch(Exception error){return CompletableFuture.failedFuture(error);}}ws.request(1);return null;}
        }).get(10,TimeUnit.SECONDS);
        try{
            socket.sendText(json.writeValueAsString(Map.of("type","AUTHENTICATE","credential",actor.token(),"afterEventId","0")),true).join();
            var snapshots=new ArrayList<JsonNode>();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);
            while(snapshots.size()<2 && System.nanoTime()<deadline){var frame=received.poll(1,TimeUnit.SECONDS);if(frame!=null&&frame.path("data").path("type").asText().equals("STOP_LOSS_CHANGED"))snapshots.add(frame.path("data"));}
            assertThat(snapshots).hasSize(2);assertThat(snapshots.get(0).path("order").isNull()).isTrue();
            assertThat(snapshots.get(0).path("stopLoss").path("version").asLong()).isEqualTo(1);eq(snapshots.get(0).path("stopLoss").path("stopPrice").asText(),"950");
            assertThat(snapshots.get(1).path("stopLoss").path("version").asLong()).isEqualTo(2);
        }finally{socket.abort();}
    }

    @ParameterizedTest @EnumSource(Position.Side.class)
    void exactBoundaryAlsoTriggersAndOppositeDirectionAndOtherSymbolStayUntouched(Position.Side side)throws Exception{
        var target=open(account,btc,side,"1");var opposite=open(account,btc,side==Position.Side.LONG?Position.Side.SHORT:Position.Side.LONG,"1");
        var other=open(account,eth,Position.Side.LONG,"1");stops.put(account,other.positionId(),key(),new StopLossRequest(n("95"),0L));
        String boundary=side==Position.Side.LONG?"950":"1050";stops.put(account,target.positionId(),key(),new StopLossRequest(n(boundary),0L));
        mark(btc,boundary);drain();
        assertThat(stops.get(account,target.positionId()).status()).isEqualTo("TRIGGERED");
        assertThat(stops.get(account,other.positionId()).status()).isEqualTo("ACTIVE");
        assertThat(accounts.summary(account).positions()).extracting(p->p.id()).containsExactlyInAnyOrder(opposite.positionId(),other.positionId());
        assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }

    @Test void twelveAccountTickKeepsBoundedQueriesAndNoDuplicateSettlement()throws Exception{
        var ids=new ArrayList<Long>();ids.add(account);
        for(int i=1;i<12;i++)ids.add(members.open(MEMBERS.incrementAndGet()).accountId());
        for(long id:ids){var opened=open(id,btc,Position.Side.LONG,"0.01");stops.put(id,opened.positionId(),key(),new StopLossRequest(n("950"),0L));}
        long started=System.nanoTime();long statements,reads;
        try(var counter=RiskSqlCounter.start()){
            mark(btc,"940");
            await().pollInSameThread().atMost(Duration.ofSeconds(15)).pollInterval(Duration.ofMillis(20)).until(()->{
                worker.runOnce();return jdbc.queryForObject("select count(*) from trading.risk_account_work where status='PENDING' and account_id in ("+String.join(",",Collections.nCopies(ids.size(),"?"))+")",Long.class,ids.toArray())==0;
            });
            statements=counter.count();reads=counter.selectCount();
        }
        long elapsedMs=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started);
        for(long id:ids){assertThat(fillCount(id)).isEqualTo(2);assertThat(ledger.check(id).status()).isEqualTo("MATCHED");}
        var plan=jdbc.queryForObject("explain(analyze,buffers,format json) select account_id from trading.position where status='OPEN' and trading_symbol_id=?",String.class,btc);
        System.out.println("STOP_LOSS_QUERY_MEASUREMENT accounts=12 ticks=1 statements="+statements+" reads="+reads+" ingressToWorkerReturnMs="+elapsedMs+" plan="+plan);
        assertThat(reads).isPositive().isLessThan(12*50+100);assertThat(plan).contains("Actual Rows","Shared Hit Blocks");
        assertThat(jdbc.queryForObject("select count(*) from trading.position_stop_loss_command where account_id in ("+String.join(",",Collections.nCopies(ids.size(),"?"))+")",Long.class,ids.toArray())).isEqualTo(12);
    }

    @Test void earlierDatabaseLifecycleTimeIsDiagnosedAndRollsBackWithoutChangingStopOrRound() {
        var opened=open(account,btc,Position.Side.LONG,"1");var active=stops.put(account,opened.positionId(),key(),new StopLossRequest(n("950"),0L));
        Instant openedAt=jdbc.queryForObject("select opened_at from trading.position where id=?",java.sql.Timestamp.class,opened.positionId()).toInstant();
        doReturn(java.sql.Timestamp.from(openedAt.minusMillis(1))).when(jdbc).queryForObject("select clock_timestamp()",java.sql.Timestamp.class);
        assertThatThrownBy(()->rounds.restart(account,key())).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("status=OPEN, hasReservation=false, closesBeforeOpen=true");
        reset(jdbc);
        assertThat(stops.get(account,opened.positionId())).isEqualTo(active);
        assertThat(rounds.list(account,null,100).content()).hasSize(1);assertThat(fillCount(account)).isEqualTo(1);
        assertThat(ledger.check(account).status()).isEqualTo("MATCHED");
    }

    private OrderResponse open(long id,long symbol,Position.Side side,String quantity){return orders.create(id,key(),new CreateOrderRequest(TradingOrder.Type.MARKET,symbol,side,n(quantity),leverages.current(id,symbol,side),null));}
    private LatestMarkPrice mark(long symbol,String value){Instant now=Instant.now();var tick=new LatestMarkPrice(symbol,n(value),now,now);assertThat(prices.update(tick)).isTrue();return tick;}
    private void drain()throws Exception{await().atMost(Duration.ofSeconds(15)).pollInterval(Duration.ofMillis(20)).until(()->{worker.runOnce();return jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id=? and status='PENDING'",Long.class,account)==0 && gate.status().equals("READY");});}
    private long fillCount(long id){return jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,id);}
    private long symbol(String symbol){return jdbc.queryForObject("select id from trading.trading_symbol where symbol=?",Long.class,symbol);}
    private static String key(){return UUID.randomUUID().toString();}
    private static BigDecimal n(String number){return new BigDecimal(number);}
    private static void eq(String actual,String expected){assertThat(n(actual)).isEqualByComparingTo(expected);}
    private static void rejects(Runnable action,ErrorCode code){assertThatThrownBy(action::run).isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getCode()).isEqualTo(code));}
}
