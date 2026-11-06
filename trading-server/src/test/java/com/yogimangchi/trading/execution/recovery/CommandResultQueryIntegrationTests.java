package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.yogimangchi.trading.commandresult.*;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.tradingaccount.service.MemberWithdrawal;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static com.yogimangchi.trading.commandresult.CommandResultRequest.Operation.*;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"trading.member-auth.enabled=true","trading.risk-journal.enabled=true",
        "trading.trigger.enabled=false","trading.reconciliation.enabled=false","trading.guest-cleanup.enabled=false",
        "binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(DurableRiskIntegrationTests.Infrastructure.class)
class CommandResultQueryIntegrationTests {
    @DynamicPropertySource static void jwt(DynamicPropertyRegistry settings){MemberTradingSoakTests.jwt(settings);}
    static final AtomicLong MEMBERS=new AtomicLong(97_000_000);
    @LocalServerPort int port; @Autowired ObjectMapper json; @Autowired JdbcTemplate jdbc;
    @Autowired LatestPriceStore prices; @Autowired RedisMarketDataBridge bridge; @Autowired DurableRiskWorker worker;
    @Autowired TradingEngineGate gate; @Autowired PlatformTransactionManager transactions;
    @Autowired CommandResultQueryService queries; @Autowired MemberWithdrawal withdrawal;
    final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    record Identity(String token,long account,Long member) { }
    record Subject(CommandResultRequest.Operation operation,String key,ObjectNode request,JsonNode original) { }
    Identity owner,other;long btc;

    @BeforeEach void setup()throws Exception{
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc));await().atMost(Duration.ofSeconds(12)).until(()->bridge.health().state()==RedisMarketDataBridge.State.HEALTHY);
        mark("1000");owner=member();other=member();
    }
    @AfterEach void stop(){prices.markUnavailable();}

    @ParameterizedTest @EnumSource(CommandResultRequest.Operation.class)
    void allDurableResultsAreReadableUnderActualIngressAndGateContentionWithoutWrites(CommandResultRequest.Operation operation)throws Exception{
        if(operation==GUEST_RETRY)owner=guest();
        Subject subject=subject(operation);
        String base=subject.request().has("positionId")?"/api/v1/trading/account/positions/"+subject.request().path("positionId").asLong()+"/stop-loss":null;
        if(operation==STOP_LOSS_PUT)ok(mutate("PUT",base,node("stopPrice","940","expectedVersion",1),key()),200);
        if(operation==STOP_LOSS_DELETE)ok(mutate("PUT",base,node("stopPrice","940","expectedVersion",2),key()),200);
        if(operation==MEMBER_RESTART||operation==GUEST_RETRY)open(); // Original reset response must not become the current wallet.
        var before=snapshot(owner.account());var pool=Executors.newSingleThreadExecutor();var held=new CountDownLatch(1);var release=new CountDownLatch(1);
        Future<?> blocker=pool.submit(()->new TransactionTemplate(transactions).executeWithoutResult(status->{
            jdbc.queryForList("select pg_advisory_xact_lock(?)",RiskAdmission.INGRESS_LOCK);
            var ordering=(ReentrantReadWriteLock)ReflectionTestUtils.getField(gate,"ordering");ordering.writeLock().lock();
            try{held.countDown();if(!release.await(5,TimeUnit.SECONDS))throw new IllegalStateException("Test release timed out");}
            catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}finally{ordering.writeLock().unlock();}
        }));
        try{
            assertThat(held.await(5,TimeUnit.SECONDS)).isTrue();
            var response=query(owner,subject);ok(response,200);
            assertThat(response.headers().firstValue("Cache-Control")).hasValue("no-store");
            var result=json.readTree(response.body());assertThat(result.path("status").asText()).isEqualTo("FOUND");
            assertThat(result.path("operation").asText()).isEqualTo(operation.name());assertThat(Instant.parse(result.path("observedAt").asText())).isBeforeOrEqualTo(Instant.now());
            assertThat(result.path("resultKind").asText()).isEqualTo(operation==OPEN||operation==CLOSE||operation==LIMIT_CLOSE?"ORDER_CURRENT":"ORIGINAL_SNAPSHOT");
            assertThat(result.path("result")).isEqualTo(subject.original());
            assertThat(snapshot(owner.account())).isEqualTo(before);
            ok(query(null,subject),401);
        }finally{release.countDown();blocker.get(8,TimeUnit.SECONDS);pool.shutdownNow();}
        System.out.println("TR04_READ_ONLY operation="+operation+" foundUnderPGAndGate=true financialSnapshotUnchanged=true");
    }

    @Test void missingAndOtherOwnerKeysAreInconclusiveAndNeverExecuteAnOrder()throws Exception{
        Subject found=subject(OPEN);var before=snapshot(other.account());
        for(var request:List.of(found,new Subject(OPEN,key(),found.request(),null))){
            var response=query(other,request);ok(response,200);var value=json.readTree(response.body());
            assertThat(value.path("status").asText()).isEqualTo("NOT_OBSERVED");
            assertThat(value.has("result")).isTrue();assertThat(value.path("result").isNull()).isTrue();assertThat(value.path("resultKind").isNull()).isTrue();
        }
        assertThat(snapshot(other.account())).isEqualTo(before);
        ok(send(other,"GET","/api/v1/trading/account/orders/"+found.original().path("orderId").asLong(),null,null),404);
    }

    @Test void canonicalDecimalAllAndOperationHashConflictsMatchRetainedExecutionKeys()throws Exception{
        Subject opened=subject(OPEN);var equivalent=opened.request().deepCopy();equivalent.put("quantity","1.0000");
        ok(query(owner,new Subject(OPEN,opened.key(),equivalent,null)),200);
        equivalent.put("quantity","1E+0");ok(query(owner,new Subject(OPEN,opened.key(),equivalent,null)),200);
        equivalent.put("quantity","2");conflict(query(owner,new Subject(OPEN,opened.key(),equivalent,null)));
        var position=opened.original().path("positionId").asLong();
        conflict(query(owner,new Subject(CLOSE,opened.key(),node("positionId",position),null)));
        String closeKey=key();var full=mutate("POST","/api/v1/trading/account/positions/"+position+"/close",null,closeKey);ok(full,200);
        var lookup=query(owner,new Subject(CLOSE,closeKey,node("positionId",position),null));ok(lookup,200);
        assertThat(json.readTree(lookup.body()).path("result")).isEqualTo(json.readTree(full.body()));
        conflict(query(owner,new Subject(CLOSE,closeKey,node("positionId",position,"quantity","1"),null)));
        // A prior accepted ALL limit close has the same canonical request without a quantity.
        var next=open();long nextPosition=next.path("positionId").asLong();String limitKey=key();
        var limit=mutate("POST","/api/v1/trading/account/positions/"+nextPosition+"/close-orders",node("limitPrice","1100"),limitKey);ok(limit,200);
        ok(query(owner,new Subject(LIMIT_CLOSE,limitKey,node("positionId",nextPosition,"limitPrice","1100.00"),null)),200);
        conflict(query(owner,new Subject(LIMIT_CLOSE,limitKey,node("positionId",nextPosition,"limitPrice","1100","quantity","1"),null)));
    }

    @Test void legacyOrderAndKeylessCancelReturnAuthoritativeCurrentCommittedValues()throws Exception{
        var request=openRequest("LIMIT");request.put("limitPrice","990");String key=key();var response=mutate("POST","/api/v1/trading/account/orders",request,key);ok(response,200);
        long id=json.readTree(response.body()).path("orderId").asLong();
        // Disposable legacy fixture: the order exists without any historical notification snapshot.
        jdbc.update("delete from trading.trading_event where order_id=?",id);
        var leverage=mutate("PUT","/api/v1/trading/account/symbols/"+btc+"/leverage",node("side","LONG","leverage",2),null);ok(leverage,200);
        var pending=query(owner,new Subject(OPEN,key,request,null));ok(pending,200);
        var current=json.readTree(pending.body()).path("result");assertThat(current.path("leverage").asInt()).isEqualTo(2);assertThat(current.path("requestedLeverage").asInt()).isEqualTo(1);
        var canceled=mutate("POST","/api/v1/trading/account/orders/"+id+"/cancel",null,null);ok(canceled,200);
        var read=send(owner,"GET","/api/v1/trading/account/orders/"+id,null,null);ok(read,200);
        assertThat(json.readTree(read.body())).isEqualTo(json.readTree(canceled.body()));
        var found=query(owner,new Subject(OPEN,key,request,null));ok(found,200);
        assertThat(json.readTree(found.body()).path("result")).isEqualTo(json.readTree(canceled.body()));
    }

    @Test void repeatableReadDoesNotMixOldOrderWithAFillCommittedAfterTheOwnershipSnapshot()throws Exception{
        var request=openRequest("LIMIT");request.put("limitPrice","990");String key=key();ok(mutate("POST","/api/v1/trading/account/orders",request,key),200);
        var observedOwner=new CountDownLatch(1);var release=new CountDownLatch(1);var pool=Executors.newSingleThreadExecutor();
        // Pause after the real ownership SELECT establishes the service's PostgreSQL snapshot.
        var reading=pool.submit(()->{try(var hook=RiskSqlCounter.afterNextSelect(()->{
            observedOwner.countDown();try{if(!release.await(5,TimeUnit.SECONDS))throw new IllegalStateException("Snapshot test release timed out");}
            catch(InterruptedException failure){Thread.currentThread().interrupt();throw new IllegalStateException(failure);}
        })){return queries.query(owner.account(),new CommandResultRequest(OPEN,key,request));}});
        try{
            assertThat(observedOwner.await(5,TimeUnit.SECONDS)).isTrue();mark("980");release.countDown();
            var before=json.valueToTree(reading.get(5,TimeUnit.SECONDS).result());assertThat(before.path("status").asText()).isEqualTo("PENDING");assertThat(before.path("fill").isNull()).isTrue();
        }finally{release.countDown();pool.shutdownNow();}
        var after=query(owner,new Subject(OPEN,key,request,null));ok(after,200);
        assertThat(json.readTree(after.body()).path("result").path("status").asText()).isEqualTo("FILLED");
        assertThat(json.readTree(after.body()).path("result").path("fill").isObject()).isTrue();
    }

    @Test void requestShapeAccountTypeAndWithdrawnIdentityStayProtected()throws Exception{
        Subject subject=subject(OPEN);var extra=subject.request().deepCopy().put("accountId",other.account());
        var bad=query(owner,new Subject(OPEN,subject.key(),extra,null));ok(bad,400);assertThat(json.readTree(bad.body()).path("code").asText()).isEqualTo("INVALID_COMMAND_RESULT_REQUEST");
        ok(query(owner,new Subject(OPEN,"bad",subject.request(),null)),400);
        ok(query(owner,new Subject(OPEN,subject.key(),node("quantity",true),null)),400);
        for(String extraField:List.of("accountId","token","requestHash","extra")){
            var envelope=node("operation","OPEN","idempotencyKey",subject.key(),"request",subject.request(),extraField,"not-allowed");
            ok(send(owner,"POST","/api/v1/trading/account/command-results/query",envelope,null),400);
        }
        ok(query(owner,new Subject(GUEST_RETRY,key(),node(),null)),403);
        Identity member=owner;owner=guest();ok(query(owner,new Subject(MEMBER_RESTART,key(),node(),null)),403);owner=member;
        var before=snapshot(owner.account());
        try(var counter=RiskSqlCounter.start()){
            queries.query(owner.account(),new CommandResultRequest(OPEN,subject.key(),subject.request()));
            assertThat(counter.count()).isEqualTo(counter.selectCount());assertThat(counter.selectCount()).isBetween(2L,3L);
        }
        assertThat(snapshot(owner.account())).isEqualTo(before);
        withdrawal.withdraw(owner.member());ok(query(owner,subject),401);
        assertThatThrownBy(()->queries.query(owner.account(),new CommandResultRequest(OPEN,subject.key(),subject.request())))
                .isInstanceOfSatisfying(com.yogimangchi.trading.error.BusinessException.class,e->assertThat(e.getCode()).isEqualTo(com.yogimangchi.trading.error.ErrorCode.ACCOUNT_NOT_ACTIVE));
    }

    @Test void extremeDecimalExponentsAreBoundedHttpInputErrors()throws Exception{
        var before=snapshot(owner.account());
        for(String exponent:List.of("1e2147483647","100e2147483647","1e-2147483647")){
            var request=openRequest("LIMIT");request.put("limitPrice",exponent);
            var response=query(owner,new Subject(OPEN,key(),request,null));ok(response,400);
            assertThat(json.readTree(response.body()).path("code").asText()).isEqualTo("INVALID_COMMAND_RESULT_REQUEST");
            ok(query(owner,new Subject(STOP_LOSS_PUT,key(),node("positionId",1,"stopPrice",exponent,"expectedVersion",0),null)),400);
            ok(query(owner,new Subject(OPEN,key(),openRequest("MARKET").put("quantity",exponent),null)),400);
        }
        assertThat(snapshot(owner.account())).isEqualTo(before);
    }

    @Test void existingKeyNamespacesAndBankruptHistoryArePreserved()throws Exception{
        Subject order=subject(OPEN);long position=order.original().path("positionId").asLong();
        var stopRequest=node("positionId",position,"stopPrice","950","expectedVersion",0);
        var stopMissing=query(owner,new Subject(STOP_LOSS_PUT,order.key(),stopRequest,null));ok(stopMissing,200);
        assertThat(json.readTree(stopMissing.body()).path("status").asText()).isEqualTo("NOT_OBSERVED");
        ok(mutate("PUT","/api/v1/trading/account/positions/"+position+"/stop-loss",node("stopPrice","950","expectedVersion",0),order.key()),200);
        ok(query(owner,new Subject(STOP_LOSS_PUT,order.key(),stopRequest,null)),200);
        conflict(query(owner,new Subject(STOP_LOSS_PUT,order.key(),stopRequest.deepCopy().put("stopPrice","940"),null)));
        conflict(query(owner,new Subject(STOP_LOSS_DELETE,order.key(),node("positionId",position,"expectedVersion",0),null)));
        // Disposable account status fixture: history remains readable without granting a mutation.
        jdbc.update("update trading.trading_account set status='BANKRUPT' where id=?",owner.account());
        ok(query(owner,order),200);ok(send(owner,"GET","/api/v1/trading/account/orders/"+order.original().path("orderId").asLong(),null,null),200);
    }

    @Test void runtimeOpenApiDocumentsInconclusiveLookupAndExactOperations()throws Exception{
        var response=send(null,"GET","/v3/api-docs",null,null);ok(response,200);var api=json.readTree(response.body());
        java.nio.file.Files.writeString(java.nio.file.Path.of(".gradle/tr04-runtime-openapi.json"),response.body());
        var operation=api.path("paths").path("/api/v1/trading/account/command-results/query").path("post");
        assertThat(operation.path("security").isEmpty()).isFalse();assertThat(operation.path("description").asText()).contains("NOT_OBSERVED","No ingress/risk gate");
        assertThat(api.path("components").path("schemas").path("CommandResultRequest").path("properties").path("operation").path("enum").size()).isEqualTo(7);
        assertThat(api.path("paths").path("/api/v1/trading/account/orders/{orderId}").path("get").isObject()).isTrue();
        ok(send(owner,"POST","/api/v1/trading/account/command-results/unimplemented",node(),null),403);
    }

    private Subject subject(CommandResultRequest.Operation operation)throws Exception{
        String key=key();if(operation==OPEN){var request=openRequest("MARKET");var result=mutate("POST","/api/v1/trading/account/orders",request,key);ok(result,200);return new Subject(operation,key,request,json.readTree(result.body()));}
        if(operation==MEMBER_RESTART||operation==GUEST_RETRY){var result=mutate("POST","/api/v1/trading/account/"+(operation==MEMBER_RESTART?"restart":"retry"),null,key);ok(result,200);return new Subject(operation,key,node(),json.readTree(result.body()));}
        long position=open().path("positionId").asLong();String path="/api/v1/trading/account/positions/"+position;
        ObjectNode request;HttpResponse<String> result;
        if(operation==CLOSE){request=node("positionId",position,"quantity","0.25");result=mutate("POST",path+"/close",node("quantity","0.25"),key);}
        else if(operation==LIMIT_CLOSE){request=node("positionId",position,"quantity","0.25","limitPrice","1100");result=mutate("POST",path+"/close-orders",node("quantity","0.25","limitPrice","1100"),key);}
        else if(operation==STOP_LOSS_PUT){request=node("positionId",position,"stopPrice","950","expectedVersion",0);result=mutate("PUT",path+"/stop-loss",node("stopPrice","950","expectedVersion",0),key);}
        else{ok(mutate("PUT",path+"/stop-loss",node("stopPrice","950","expectedVersion",0),key()),200);request=node("positionId",position,"expectedVersion",1);result=mutate("DELETE",path+"/stop-loss?expectedVersion=1",null,key);}
        ok(result,200);return new Subject(operation,key,request,json.readTree(result.body()));
    }
    private ObjectNode openRequest(String type){return node("type",type,"tradingSymbolId",btc,"side","LONG","quantity","1","leverage",1);}
    private JsonNode open()throws Exception{var response=mutate("POST","/api/v1/trading/account/orders",openRequest("MARKET"),key());ok(response,200);return json.readTree(response.body());}
    private Identity member()throws Exception{var actor=new MemberTradingSoakTests.Actor(MEMBERS.incrementAndGet(),btc);String token=actor.token();var response=send(new Identity(token,0,actor.member),"POST","/api/v1/trading/accounts/member",null,null);ok(response,200);return new Identity(token,json.readTree(response.body()).path("accountId").asLong(),actor.member);}
    private Identity guest()throws Exception{var response=send(null,"POST","/api/v1/trading/accounts/guest",null,null);ok(response,201);var data=json.readTree(response.body());return new Identity(data.path("accessToken").asText(),data.path("accountId").asLong(),null);}
    private HttpResponse<String> query(Identity identity,Subject subject)throws Exception{return send(identity,"POST","/api/v1/trading/account/command-results/query",node("operation",subject.operation().name(),"idempotencyKey",subject.key(),"request",subject.request()),null);}
    private HttpResponse<String> mutate(String method,String path,JsonNode body,String key)throws Exception{return send(owner,method,path,body,key);}
    private HttpResponse<String> send(Identity identity,String method,String path,JsonNode body,String key)throws Exception{
        var request=HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(3));if(identity!=null)request.header("Authorization","Bearer "+identity.token());if(key!=null)request.header("Idempotency-Key",key);if(body!=null)request.header("Content-Type","application/json");
        return http.send(request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
    }
    private ObjectNode node(Object... values){var result=json.createObjectNode();for(int i=0;i<values.length;i+=2)result.set(values[i].toString(),json.valueToTree(values[i+1]));return result;}
    private void conflict(HttpResponse<String> response)throws Exception{ok(response,409);assertThat(json.readTree(response.body()).path("code").asText()).isEqualTo("IDEMPOTENCY_CONFLICT");}
    private static void ok(HttpResponse<String> response,int expected){assertThat(response.statusCode()).as("HTTP status").isEqualTo(expected);}
    private Map<String,Object> snapshot(long account){var result=new LinkedHashMap<String,Object>(jdbc.queryForMap("select balance,used_margin,reserved_margin,realized_pnl,fees_paid,settlement_adjustment from trading.wallet where account_id=?",account));for(String table:List.of("trading_order","position","trading_event","position_stop_loss_command","member_restart","guest_retry"))result.put(table,jdbc.queryForObject("select count(*) from trading."+table+" where account_id=?",Long.class,account));result.put("fills",jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,account));return result;}
    private void mark(String amount)throws Exception{Instant now=Instant.now();assertThat(prices.update(new LatestMarkPrice(btc,new BigDecimal(amount),now,now))).isTrue();await().atMost(Duration.ofSeconds(10)).until(()->{worker.runOnce();return gate.status().equals("READY")&&jdbc.queryForObject("select count(*) from trading.risk_account_work where status='PENDING'",Long.class)==0;});}
    private static String key(){return UUID.randomUUID().toString();}
}
