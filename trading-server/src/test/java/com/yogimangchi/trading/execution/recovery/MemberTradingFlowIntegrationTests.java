package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.*;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.execution.trigger.AccountTriggerService;
import com.yogimangchi.trading.tradingaccount.service.MemberWithdrawal;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@SpringBootTest(properties={"trading.risk-journal.enabled=true","trading.member-auth.enabled=true","trading.trigger.enabled=false","trading.reconciliation.enabled=false","trading.guest-cleanup.enabled=false","binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@AutoConfigureMockMvc @Import(DurableRiskIntegrationTests.Infrastructure.class)
class MemberTradingFlowIntegrationTests {
    @DynamicPropertySource static void jwt(DynamicPropertyRegistry settings){MemberTradingSoakTests.jwt(settings);}
    static final AtomicLong MEMBERS=new AtomicLong(92_000_000);
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired LatestPriceStore prices;
    @Autowired RedisMarketDataBridge bridge;
    @Autowired DurableRiskWorker worker;
    @Autowired RiskWorkRunner runner;
    @Autowired com.yogimangchi.trading.execution.trigger.TradingEngineGate gate;
    @Autowired LedgerReconciler ledger;
    @Autowired MemberWithdrawal withdrawal;
    @MockitoSpyBean AccountTriggerService trigger;
    MemberTradingSoakTests.Actor actor;long btc;
    @BeforeEach void setup()throws Exception{
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc));await().atMost(Duration.ofSeconds(12)).until(()->bridge.health().state()==RedisMarketDataBridge.State.HEALTHY);
        mark("1000");actor=new MemberTradingSoakTests.Actor(MEMBERS.incrementAndGet(),btc);
        actor.id=call(post("/api/v1/trading/accounts/member"),null,null,200).path("accountId").asLong();
        assertThat(actor.id).isPositive();assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
    }
    @AfterEach void stop(){reset(trigger);prices.markUnavailable();}
    @Test void memberDirectionsKeepIndependentMarginLiquidationReservationAndAbsolutePnl()throws Exception{
        leverage("LONG",15);leverage("SHORT",7);
        var longOrder=open("LONG","1",15,null);var shortOrder=open("SHORT","1",7,null);
        var pending=open("LONG","0.1",15,"990");var shortPending=open("SHORT","0.1",7,"1010");
        mark("1001");var before=call(get("/api/v1/trading/account/summary"),null,null,200);
        var shortBefore=position(before,shortOrder.path("positionId").asLong());var longBefore=position(before,longOrder.path("positionId").asLong());
        var historyBefore=jdbc.queryForList("select id,leverage,requested_leverage,filled_price,quantity,status from trading.trading_order where account_id=? and status='FILLED' order by id",actor.id);
        leverage("LONG",20);var after=call(get("/api/v1/trading/account/summary"),null,null,200);
        assertThat(position(after,shortOrder.path("positionId").asLong())).isEqualTo(shortBefore);
        var longAfter=position(after,longOrder.path("positionId").asLong());
        assertThat(longAfter.path("unrealizedPnl")).isEqualTo(longBefore.path("unrealizedPnl"));assertThat(longAfter.path("margin")).isNotEqualTo(longBefore.path("margin"));assertThat(longAfter.path("liquidationPrice")).isNotEqualTo(longBefore.path("liquidationPrice"));
        assertThat(jdbc.queryForList("select id,leverage,requested_leverage,filled_price,quantity,status from trading.trading_order where account_id=? and status='FILLED' order by id",actor.id)).isEqualTo(historyBefore);
        assertThat(jdbc.queryForObject("select leverage from trading.trading_order where id=?",Integer.class,pending.path("orderId").asLong())).isEqualTo(20);
        assertThat(jdbc.queryForObject("select leverage from trading.trading_order where id=?",Integer.class,shortPending.path("orderId").asLong())).isEqualTo(7);
        var api=call(get("/v3/api-docs"),null,null,200);assertThat(api.path("paths").path("/api/v1/trading/account/symbols/{symbolId}/leverage").path("get").path("parameters").toString()).contains("side","required");
        assertThat(api.path("paths").path("/api/v1/trading/account/symbols/{symbolId}/leverage").path("get").path("description").asText()).contains("member Access JWT");
        assertThat(api.path("paths").path("/api/v1/trading/account/symbols/{symbolId}/leverage").path("put").path("description").asText()).contains("ACCOUNT_RISK_PENDING","ACCOUNT_RECOVERY_HELD");
        call(get("/api/v1/trading/account/symbols/"+btc+"/leverage"),null,null,400);
        assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
    }
    @Test void bothLimitDirectionsCrossAndPartialLimitClosesRetainCurrentRoundEvents()throws Exception{
        leverage("LONG",15);leverage("SHORT",7);
        var buy=open("LONG","1",15,"990");var sell=open("SHORT","1",7,"1010");
        mark("980");mark("1020");assertStatus(buy,"FILLED");assertStatus(sell,"FILLED");
        long longPosition=jdbc.queryForObject("select position_id from trading.trading_order where id=?",Long.class,buy.path("orderId").asLong());
        long shortPosition=jdbc.queryForObject("select position_id from trading.trading_order where id=?",Long.class,sell.path("orderId").asLong());
        call(post("/api/v1/trading/account/positions/"+longPosition+"/close-orders"),"{\"quantity\":\"0.5\",\"limitPrice\":\"1030\"}",key(),200);
        mark("1040");
        call(post("/api/v1/trading/account/positions/"+shortPosition+"/close-orders"),"{\"quantity\":\"0.5\",\"limitPrice\":\"970\"}",key(),200);
        mark("960");
        close(longPosition,null);close(shortPosition,null);
        var events=call(get("/api/v1/trading/account/events?limit=100"),null,null,200);
        assertThat(events.size()).isEqualTo(10);for(var event:events){assertThat(event.path("roundId").asLong()).isPositive();assertThat(event.path("roundNumber").asInt()).isEqualTo(1);}
        var performance=call(get("/api/v1/trading/account/performance/symbols"),null,null,200);
        assertThat(performance.path("totals").path("fillCount").asLong()).isEqualTo(6);
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='OPEN'",Long.class,actor.id)).isZero();assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
    }
    @Test void responseLossReplayAndConcurrentSameKeyCannotChargeTwiceAndOwnershipIsEnforced()throws Exception{
        String key=key(),body=body("LONG","1",10,null);
        var first=call(post("/api/v1/trading/account/orders"),body,key,200);
        var pool=Executors.newFixedThreadPool(2);
        try{
            var a=pool.submit(()->call(post("/api/v1/trading/account/orders"),body,key,200));var b=pool.submit(()->call(post("/api/v1/trading/account/orders"),body,key,200));
            assertThat(a.get().path("orderId")).isEqualTo(first.path("orderId"));assertThat(b.get().path("fill").path("fillId")).isEqualTo(first.path("fill").path("fillId"));
        }finally{pool.shutdownNow();}
        assertThat(jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,actor.id)).isEqualTo(1);
        call(post("/api/v1/trading/account/orders"),body("SHORT","1",10,null),key,409);
        var own=actor;actor=new MemberTradingSoakTests.Actor(MEMBERS.incrementAndGet(),btc);actor.id=call(post("/api/v1/trading/accounts/member"),null,null,200).path("accountId").asLong();
        closeExpected(first.path("positionId").asLong(),null,404);call(get("/api/v1/trading/account/orders"),null,null,200);assertThat(call(get("/api/v1/trading/account/events"),null,null,200).size()).isZero();
        assertThat(mvc.perform(get("/api/v1/trading/account/summary")).andReturn().getResponse().getStatus()).isEqualTo(401);
        assertThat(mvc.perform(get("/api/v1/symbols")).andReturn().getResponse().getStatus()).isEqualTo(200);actor=own;assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
    }
    @Test void feeInclusiveConcurrentMemberOrdersRejectOnlyUnaffordableChange()throws Exception{
        leverage("LONG",1);leverage("SHORT",1);open("LONG","8",1,null);
        var pool=Executors.newFixedThreadPool(2);var start=new CountDownLatch(1);
        try{
            var a=pool.submit(()->{start.await();return rawOrder(body("LONG","1",1,null));});var b=pool.submit(()->{start.await();return rawOrder(body("SHORT","1",1,null));});start.countDown();
            var results=List.of(a.get(),b.get());assertThat(results.stream().filter(n->n.path("status").asText().equals("FILLED")).count()).isEqualTo(1);
            assertThat(results.stream().filter(n->n.path("code").asText().equals("INSUFFICIENT_MARGIN")).count()).isEqualTo(1);
        }finally{pool.shutdownNow();}
        assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");var wallet=call(get("/api/v1/trading/account/wallet"),null,null,200);assertThat(new BigDecimal(wallet.path("availableBalance").asText())).isNotNegative();
    }
    @Test void memberLiquidationAdjustmentsAndRestartCapitalAreNotTradingProfit()throws Exception{
        leverage("LONG",100);open("LONG","1",100,null);mark("900");
        var p=call(get("/api/v1/trading/account/performance/symbols"),null,null,200).path("totals");
        assertThat(new BigDecimal(p.path("grossRealizedPnl").asText())).isEqualByComparingTo("-100");assertThat(new BigDecimal(p.path("fees").asText())).isEqualByComparingTo("0.95");assertThat(new BigDecimal(p.path("settlementAdjustment").asText())).isEqualByComparingTo("90.45");
        var restart=call(post("/api/v1/trading/account/restart"),null,key(),200);long round=restart.path("roundId").asLong();
        var current=call(get("/api/v1/trading/account/performance/symbols?roundId="+round),null,null,200);assertThat(current.path("totals").path("fillCount").asLong()).isZero();assertThat(new BigDecimal(current.path("capitalAdjustment").asText())).isEqualByComparingTo("10.5");
        call(post("/api/v1/trading/account/restart"),null,key(),429);assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
        withdrawal.withdraw(actor.member);withdrawal.withdraw(actor.member);
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='OPEN'",Long.class,actor.id)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'",Long.class,actor.id)).isZero();
        assertThat(mvc.perform(get("/api/v1/trading/account/wallet").header("Authorization","Bearer "+actor.token())).andReturn().getResponse().getStatus()).isBetween(400,499);
        assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
    }
    @Test void failedMemberRiskWorkRollsBackThenRetriesWithoutChangingItsRound()throws Exception{
        var pending=open("LONG","1",10,"990");long round=jdbc.queryForObject("select id from trading.member_trading_round where account_id=? and status='ACTIVE'",Long.class,actor.id);
        doThrow(new IllegalStateException("disposable failure fixture")).when(trigger).processRecorded(any(RiskReplayPermit.class));
        Instant now=Instant.now();prices.update(new LatestMarkPrice(btc,new BigDecimal("980"),now,now));worker.runOnce();assertStatus(pending,"PENDING");
        assertThat(jdbc.queryForObject("select count(*) from trading.fill where round_id=?",Long.class,round)).isZero();reset(trigger);
        jdbc.update("update trading.risk_account_work set next_attempt_at=clock_timestamp() where account_id=? and status='PENDING'",actor.id);worker.runOnce();assertStatus(pending,"FILLED");
        assertThat(jdbc.queryForObject("select count(*) from trading.fill where round_id=?",Long.class,round)).isEqualTo(1);worker.runOnce();assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
    }
    @Test void receivedMemberLiquidationStillCommitsAfterCurrentPriceExpires()throws Exception{
        leverage("LONG",15);open("LONG","1",15,null);
        for(String value:List.of("900","1020")){Instant now=Instant.now();prices.update(new LatestMarkPrice(btc,new BigDecimal(value),now,now));}
        Thread.sleep(6100);worker.runOnce();
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='LIQUIDATED'",Long.class,actor.id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,actor.id)).isEqualTo(2);
        var rejected=call(post("/api/v1/trading/account/orders"),body("LONG","1",15,null),key(),503);
        assertThat(rejected.path("code").asText()).isEqualTo("PRICE_NOT_FRESH");assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
    }
    @Test void reconnectAndWorkerRecreationPreserveMemberHoldUntilFinalWithdrawal()throws Exception{
        open("LONG","1",10,null);open("LONG","1",10,"990");
        prices.markUnavailable();prices.beginSubscription(Set.of(btc));mark("1020");
        var state=call(get("/api/v1/trading/account/recovery"),null,null,200);assertThat(state.path("status").asText()).isEqualTo("REVIEW_REQUIRED");assertThat(state.path("holds").toString()).contains("PROVIDER_CONTINUITY_UNKNOWN");
        var restarted=new DurableRiskWorker(jdbc,json,runner,gate,bridge,false);restarted.runOnce();
        var rejected=call(post("/api/v1/trading/account/orders"),body("LONG","1",10,null),key(),503);assertThat(rejected.path("code").asText()).isEqualTo("ACCOUNT_RECOVERY_HELD");
        assertThat(jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,actor.id)).isEqualTo(1);
        withdrawal.withdraw(actor.member);withdrawal.withdraw(actor.member);restarted.runOnce();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id=? and status in ('PENDING','HELD')",Long.class,actor.id)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'",Long.class,actor.id)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='OPEN'",Long.class,actor.id)).isZero();assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");restarted.close();
    }
    @Test void memberCloseReservationAndMarketCloseRaceCannotExitMoreThanThePosition()throws Exception{
        long position=open("LONG","1",10,null).path("positionId").asLong();
        var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try{
            var reserve=pool.submit(()->{start.await();return raw(post("/api/v1/trading/account/positions/"+position+"/close-orders"),"{\"quantity\":\"0.7\",\"limitPrice\":\"1100\"}");});
            var close=pool.submit(()->{start.await();return raw(post("/api/v1/trading/account/positions/"+position+"/close"),"{\"quantity\":\"0.5\"}");});start.countDown();
            var responses=List.of(reserve.get(),close.get());assertThat(responses.stream().filter(r->r.status()==200).count()).isEqualTo(1);
            assertThat(responses.stream().filter(r->r.status()==409&&r.body().path("code").asText().equals("CLOSE_QUANTITY_EXCEEDED")).count()).isEqualTo(1);
        }finally{pool.shutdownNow();}
        assertThat(jdbc.queryForObject("select quantity-reserved_close_quantity from trading.position where id=?",BigDecimal.class,position)).isNotNegative();
        assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
    }
    @Test void memberLimitCancelAndCrossingRaceHaveOneConsistentTerminalResult()throws Exception{
        var order=open("LONG","1",10,"990");var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try{
            var cancel=pool.submit(()->{start.await();return raw(post("/api/v1/trading/account/orders/"+order.path("orderId").asLong()+"/cancel"),null);});
            var crossing=pool.submit(()->{start.await();mark("980");return true;});start.countDown();var response=cancel.get();crossing.get();
            assertThat(response.status()==200||response.status()==503&&response.body().path("code").asText().equals("ACCOUNT_RISK_PENDING")).isTrue();
        }finally{pool.shutdownNow();}
        String terminal=jdbc.queryForObject("select status from trading.trading_order where id=?",String.class,order.path("orderId").asLong());assertThat(terminal).isIn("CANCELED","FILLED");
        assertThat(jdbc.queryForObject("select count(*) from trading.fill where order_id=?",Long.class,order.path("orderId").asLong())).isEqualTo(terminal.equals("FILLED")?1L:0L);
        assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
    }
    @Test void memberPartialCloseAndLiquidationRaceSettleEachUnitOnce()throws Exception{
        leverage("LONG",15);long position=open("LONG","1",15,null).path("positionId").asLong();
        var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try{
            var close=pool.submit(()->{start.await();return raw(post("/api/v1/trading/account/positions/"+position+"/close"),"{\"quantity\":\"0.4\"}");});
            var crossing=pool.submit(()->{start.await();mark("900");return true;});start.countDown();var response=close.get();crossing.get();
            assertThat(response.status()==200||Set.of("ACCOUNT_RISK_PENDING","ACCOUNT_AT_RISK","POSITION_NOT_OPEN").contains(response.body().path("code").asText())).isTrue();
        }finally{pool.shutdownNow();}
        assertThat(jdbc.queryForObject("select coalesce(sum(f.quantity),0) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.position_id=? and o.action in ('CLOSE','LIQUIDATE')",BigDecimal.class,position)).isEqualByComparingTo("1");
        assertThat(jdbc.queryForObject("select quantity+margin+reserved_close_quantity from trading.position where id=?",BigDecimal.class,position)).isZero();assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
    }
    private record Reply(int status,JsonNode body) { }
    private Reply raw(MockHttpServletRequestBuilder request,String body)throws Exception{
        request.header("Authorization","Bearer "+actor.token()).header("Idempotency-Key",key());if(body!=null)request.contentType("application/json").content(body);
        var response=mvc.perform(request).andReturn().getResponse();return new Reply(response.getStatus(),json.readTree(response.getContentAsString()));
    }
    private JsonNode rawOrder(String body)throws Exception{return json.readTree(mvc.perform(post("/api/v1/trading/account/orders").header("Authorization","Bearer "+actor.token()).header("Idempotency-Key",key()).contentType("application/json").content(body)).andReturn().getResponse().getContentAsString());}
    private void mark(String value)throws Exception{Instant now=Instant.now();assertThat(prices.update(new LatestMarkPrice(btc,new BigDecimal(value),now,now))).isTrue();for(int i=0;i<100;i++){worker.runOnce();if(jdbc.queryForObject("select count(*) from trading.risk_account_work w where status='PENDING' and not exists(select 1 from trading.risk_hold h where h.account_id=w.account_id and h.resolved_at is null and (h.event_id is null or h.event_id<=w.event_id))",Long.class)==0)return;}throw new AssertionError("risk work not drained");}
    private void leverage(String side,int value)throws Exception{call(put("/api/v1/trading/account/symbols/"+btc+"/leverage"),"{\"side\":\""+side+"\",\"leverage\":"+value+"}",null,200);}
    private JsonNode open(String side,String qty,int leverage,String limit)throws Exception{return call(post("/api/v1/trading/account/orders"),body(side,qty,leverage,limit),key(),200);}
    private String body(String side,String qty,int leverage,String limit)throws Exception{var data=new LinkedHashMap<String,Object>();data.put("type",limit==null?"MARKET":"LIMIT");data.put("tradingSymbolId",btc);data.put("side",side);data.put("quantity",qty);data.put("leverage",leverage);if(limit!=null)data.put("limitPrice",limit);return json.writeValueAsString(data);}
    private void close(long position,String qty)throws Exception{closeExpected(position,qty,200);}
    private void closeExpected(long position,String qty,int expected)throws Exception{call(post("/api/v1/trading/account/positions/"+position+"/close"),qty==null?null:"{\"quantity\":\""+qty+"\"}",key(),expected);}
    private JsonNode call(MockHttpServletRequestBuilder request,String body,String key,int expected)throws Exception{if(actor!=null)request.header("Authorization","Bearer "+actor.token());if(key!=null)request.header("Idempotency-Key",key);if(body!=null)request.contentType("application/json").content(body);var result=mvc.perform(request).andReturn().getResponse();assertThat(result.getStatus()).as(request.toString()+" "+result.getContentAsString()).isEqualTo(expected);return result.getContentAsString().isBlank()?json.createObjectNode():json.readTree(result.getContentAsString());}
    private void assertStatus(JsonNode order,String status){assertThat(jdbc.queryForObject("select status from trading.trading_order where id=?",String.class,order.path("orderId").asLong())).isEqualTo(status);}
    private JsonNode position(JsonNode summary,long id){for(var position:summary.path("positions"))if(position.path("id").asLong()==id)return position;throw new AssertionError("owned position missing");}
    private static String key(){return UUID.randomUUID().toString();}
}
