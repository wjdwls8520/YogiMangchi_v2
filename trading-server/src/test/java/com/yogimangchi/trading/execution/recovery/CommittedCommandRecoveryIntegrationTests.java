package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.HttpServer;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.*;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.*;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;

/** Real HTTP, commit, deliberately truncated response and real PG/JVM admission contention. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
        "trading.member-auth.enabled=true","trading.risk-journal.enabled=true","trading.trigger.enabled=false",
        "trading.reconciliation.enabled=false","trading.guest-cleanup.enabled=false",
        "binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(DurableRiskIntegrationTests.Infrastructure.class)
class CommittedCommandRecoveryIntegrationTests {
    @DynamicPropertySource static void jwt(DynamicPropertyRegistry settings){MemberTradingSoakTests.jwt(settings);}
    static final AtomicLong MEMBERS=new AtomicLong(95_000_000);
    @Autowired JdbcTemplate jdbc; @Autowired ObjectMapper json; @Autowired LatestPriceStore prices;
    @Autowired RedisMarketDataBridge bridge; @Autowired DurableRiskWorker worker; @Autowired TradingEngineGate gate;
    @Autowired PlatformTransactionManager transactions; @LocalServerPort int port;
    final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    MemberTradingSoakTests.Actor owner,other; long btc;
    record Command(String method,String path,String body,String conflictingPath,String conflictingBody) { }

    @BeforeEach void setup()throws Exception{
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc));
        await().atMost(Duration.ofSeconds(12)).until(()->bridge.health().state()==RedisMarketDataBridge.State.HEALTHY);
        refreshMark();
        owner=actor();other=actor();
    }
    @AfterEach void stop(){prices.markUnavailable();}

    @ParameterizedTest
    @CsvSource({"OPEN,PG","CLOSE,PG","CLOSE_ALL,PG","LIMIT_CLOSE,PG","STOP_PUT,PG","STOP_DELETE,PG",
            "OPEN,GATE","CLOSE,GATE","CLOSE_ALL,GATE","LIMIT_CLOSE,GATE","STOP_PUT,GATE","STOP_DELETE,GATE"})
    void committedResultSurvivesLostResponseAndAdmissionContention(String kind,String contention)throws Exception{
        Command command=command(kind); String key=UUID.randomUUID().toString();
        refreshMark();
        JsonNode original=commitAndLoseResponse(command,key);
        if(kind.equals("STOP_PUT")) {
            assertStatus(send(owner,"PUT",command.path(),"{\"stopPrice\":\"940\",\"expectedVersion\":1}",UUID.randomUUID().toString()),200);
        } else if(kind.equals("STOP_DELETE")) {
            assertStatus(send(owner,"PUT",command.path().split("\\?")[0],"{\"stopPrice\":\"940\",\"expectedVersion\":2}",UUID.randomUUID().toString()),200);
        }
        var committed=snapshot(owner.id); var otherBefore=snapshot(other.id);
        var pool=Executors.newSingleThreadExecutor();var held=new CountDownLatch(1);var release=new CountDownLatch(1);
        Future<?> blocker=pool.submit(()->hold(contention,held,release));
        try {
            assertThat(held.await(5,TimeUnit.SECONDS)).isTrue();
            var retry=send(owner,command.method(),command.path(),command.body(),key);
            assertStatus(retry,contention.equals("PG")?409:503);
            assertThat(json.readTree(retry.body()).path("code").asText()).isEqualTo(contention.equals("PG")?"TRADING_BUSY":"ENGINE_RECOVERING");
            assertThat(snapshot(owner.id)).isEqualTo(committed);
            System.out.println("TR01_REPLAY_REPRO kind="+kind+" contention="+contention+" committedResponseLost=true retryStatus="+retry.statusCode()+" outcome="+json.readTree(retry.body()).path("outcome").asText());
            assertThat(json.readTree(retry.body()).path("outcome").asText()).isEqualTo("UNKNOWN");
            assertThat(json.readTree(retry.body()).path("attemptOutcome").asText()).isEqualTo("NOT_ACCEPTED");
            // The fence still protects any fresh financial write; authentication runs before it.
            var firstAttempt=send(owner,command.method(),command.path(),command.body(),UUID.randomUUID().toString());
            assertStatus(firstAttempt,retry.statusCode());
            assertThat(json.readTree(firstAttempt.body()).path("attemptOutcome").asText()).isEqualTo("NOT_ACCEPTED");
            assertStatus(send(null,command.method(),command.path(),command.body(),key),401);
            assertStatus(send(other,command.method(),command.path(),command.body(),key),retry.statusCode());
            assertThat(snapshot(owner.id)).isEqualTo(committed);assertThat(snapshot(other.id)).isEqualTo(otherBefore);
        } finally {release.countDown();blocker.get(10,TimeUnit.SECONDS);pool.shutdownNow();}
        var recovered=send(owner,command.method(),command.path(),command.body(),key);
        assertStatus(recovered,200);assertThat(json.readTree(recovered.body())).isEqualTo(original);
        var conflict=send(owner,command.method(),command.conflictingPath(),command.conflictingBody(),key);
        assertStatus(conflict,409);assertThat(json.readTree(conflict.body()).path("code").asText()).isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(json.readTree(conflict.body()).path("outcome").asText()).isEqualTo("NOT_ACCEPTED");
        assertThat(json.readTree(conflict.body()).has("attemptOutcome")).isFalse();
        assertThat(snapshot(owner.id)).isEqualTo(committed);
        if(!kind.equals("OPEN"))assertStatus(send(other,command.method(),command.path(),command.body(),key),404);
        assertThat(snapshot(other.id)).isEqualTo(otherBefore);
    }

    private JsonNode commitAndLoseResponse(Command command,String key)throws Exception{
        var retained=new AtomicReference<String>();var calls=new AtomicInteger();
        var proxy=HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(),0),0);
        proxy.createContext("/lost",exchange->{
            try {
                calls.incrementAndGet();var response=send(owner,command.method(),command.path(),command.body(),key);
                if(response.statusCode()!=200)throw new IllegalStateException("Fixture command was not committed");
                retained.set(response.body());byte[] body=response.body().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200,body.length+1L);exchange.getResponseBody().write(body);
            } catch(Exception failure){throw new IOException("Controlled lost response",failure);}
            finally{exchange.close();}
        });proxy.start();
        try {
            var request=HttpRequest.newBuilder(URI.create("http://localhost:"+proxy.getAddress().getPort()+"/lost"))
                    .timeout(Duration.ofSeconds(5)).POST(HttpRequest.BodyPublishers.noBody()).build();
            assertThatThrownBy(()->http.send(request,HttpResponse.BodyHandlers.ofString())).isInstanceOf(IOException.class);
            assertThat(calls.get()).isEqualTo(1);assertThat(retained.get()).isNotNull();
            return json.readTree(retained.get());
        } finally {proxy.stop(0);}
    }
    private void hold(String mode,CountDownLatch held,CountDownLatch release){
        if(mode.equals("PG"))new TransactionTemplate(transactions).executeWithoutResult(status->{
            jdbc.queryForList("select pg_advisory_xact_lock(?)",RiskAdmission.INGRESS_LOCK);held.countDown();awaitRelease(release);
        });
        else {
            var ordering=(ReentrantReadWriteLock)ReflectionTestUtils.getField(gate,"ordering");
            ordering.writeLock().lock();try{held.countDown();awaitRelease(release);}finally{ordering.writeLock().unlock();}
        }
    }
    private static void awaitRelease(CountDownLatch release){try{if(!release.await(8,TimeUnit.SECONDS))throw new IllegalStateException("Test latch timed out");}catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}}
    private Command command(String kind)throws Exception{
        String open="{\"type\":\"MARKET\",\"tradingSymbolId\":"+btc+",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":1}";
        if(kind.equals("OPEN"))return new Command("POST","/api/v1/trading/account/orders",open,"/api/v1/trading/account/orders",open.replace("\"quantity\":\"1\"","\"quantity\":\"2\""));
        var created=send(owner,"POST","/api/v1/trading/account/orders",open,UUID.randomUUID().toString());assertStatus(created,200);
        long position=json.readTree(created.body()).path("positionId").asLong();String path="/api/v1/trading/account/positions/"+position;
        if(kind.equals("CLOSE"))return new Command("POST",path+"/close","{\"quantity\":\"0.25\"}",path+"/close","{\"quantity\":\"0.2\"}");
        if(kind.equals("CLOSE_ALL"))return new Command("POST",path+"/close",null,path+"/close","{\"quantity\":\"0.2\"}");
        if(kind.equals("LIMIT_CLOSE"))return new Command("POST",path+"/close-orders","{\"quantity\":\"0.25\",\"limitPrice\":\"1100\"}",path+"/close-orders","{\"quantity\":\"0.2\",\"limitPrice\":\"1100\"}");
        path+="/stop-loss";
        if(kind.equals("STOP_PUT"))return new Command("PUT",path,"{\"stopPrice\":\"950\",\"expectedVersion\":0}",path,"{\"stopPrice\":\"940\",\"expectedVersion\":0}");
        assertStatus(send(owner,"PUT",path,"{\"stopPrice\":\"950\",\"expectedVersion\":0}",UUID.randomUUID().toString()),200);
        return new Command("DELETE",path+"?expectedVersion=1",null,path+"?expectedVersion=2",null);
    }
    private MemberTradingSoakTests.Actor actor()throws Exception{
        var actor=new MemberTradingSoakTests.Actor(MEMBERS.incrementAndGet(),btc);
        var provisioned=send(actor,"POST","/api/v1/trading/accounts/member",null,null);assertStatus(provisioned,200);
        actor.id=json.readTree(provisioned.body()).path("accountId").asLong();return actor;
    }
    private HttpResponse<String> send(MemberTradingSoakTests.Actor actor,String method,String path,String body,String key)throws Exception{
        var request=HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(5));
        if(actor!=null)request.header("Authorization","Bearer "+actor.token());if(key!=null)request.header("Idempotency-Key",key);
        if(body!=null)request.header("Content-Type","application/json");
        return http.send(request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    private static void assertStatus(HttpResponse<String> response,int expected){assertThat(response.statusCode()).as("HTTP status").isEqualTo(expected);}
    private Map<String,Object> snapshot(long account){
        var result=new LinkedHashMap<String,Object>(jdbc.queryForMap("select balance,used_margin,reserved_margin,realized_pnl,fees_paid,settlement_adjustment from trading.wallet where account_id=?",account));
        result.put("orders",jdbc.queryForObject("select count(*) from trading.trading_order where account_id=?",Long.class,account));
        result.put("fills",jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,account));
        result.put("events",jdbc.queryForObject("select count(*) from trading.trading_event where account_id=?",Long.class,account));
        result.put("commands",jdbc.queryForObject("select count(*) from trading.position_stop_loss_command where account_id=?",Long.class,account));return result;
    }
    private void refreshMark()throws Exception{
        Instant now=Instant.now();assertThat(prices.update(new LatestMarkPrice(btc,new BigDecimal("1000"),now,now))).isTrue();
        await().atMost(Duration.ofSeconds(10)).until(()->{worker.runOnce();return gate.status().equals("READY")&&jdbc.queryForObject("select count(*) from trading.risk_account_work where status='PENDING'",Long.class)==0;});
    }
}
