package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.*;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import java.math.*;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.context.*;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;

/** Opt-in: real Binance ingress + real HTTP/JWT/private WS; no user database or Content secrets. */
@Tag("soak")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"trading.risk-journal.enabled=true","trading.member-auth.enabled=true","trading.trigger.enabled=false","trading.reconciliation.enabled=false","trading.guest-cleanup.enabled=false","binance.mark-price.enabled=true","binance.order-book.enabled=false"})
@Import(DurableRiskIntegrationTests.Infrastructure.class)
class MemberTradingSoakTests {
    static final RSAKey KEY=key();
    static final Path PUBLIC_KEY=publicFile();
    static final JwtEncoder ENCODER=new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(KEY)));
    @DynamicPropertySource static void jwt(DynamicPropertyRegistry settings){
        settings.add("trading.member-auth.public-key-path",PUBLIC_KEY::toString);
        settings.add("trading.member-auth.issuer",()->"https://content.test");
    }
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired LatestPriceStore prices;
    @Autowired RedisMarketDataBridge bridge;
    @Autowired DurableRiskWorker worker;
    @Autowired TradingEngineGate gate;
    @Autowired LedgerReconciler ledger;
    final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    final ScheduledExecutorService background=Executors.newScheduledThreadPool(2);
    final ExecutorService clients=Executors.newFixedThreadPool(8);
    final AtomicBoolean paused=new AtomicBoolean();
    final ConcurrentLinkedQueue<String> failures=new ConcurrentLinkedQueue<>();
    final List<Actor> normal=new CopyOnWriteArrayList<>(),held=new ArrayList<>(),steady=new ArrayList<>();
    final Metric response=new Metric(),logical=new Metric(),execution=new Metric(),delivery=new Metric();
    final Map<String,LongAdder> rejections=new ConcurrentHashMap<>();
    final List<Map<String,Object>> progress=new CopyOnWriteArrayList<>();
    final AtomicLong completedCycles=new AtomicLong(),submittedOrders=new AtomicLong(),transitions=new AtomicLong();
    long started,btc,eth;boolean completed;

    @Test void thirtyMinutesOfRealPricesWithHeldHistoryAndMemberTrades()throws Exception{
        int seconds=Integer.parseInt(System.getenv().getOrDefault("TRADING_SOAK_SECONDS","1800"));
        assertThat(seconds).as("Minimum continuous verification duration").isGreaterThanOrEqualTo(1800);
        btc=symbol("BTC");eth=symbol("ETH");
        background.scheduleWithFixedDelay(()->{if(!paused.get())try{worker.runOnce();}catch(Exception failure){failures.add("worker:"+failure.getClass().getSimpleName());}},0,50,TimeUnit.MILLISECONDS);
        await().atMost(Duration.ofSeconds(60)).until(()->fresh(btc)&&fresh(eth)&&gate.status().equals("READY"));
        for(int i=0;i<6;i++){
            var actor=actor(80_000_000L+i,btc);held.add(actor);
            var opened=call(actor,"POST","/api/v1/trading/account/orders",openBody(actor,"LONG"),200,true);
            assertThat(opened.path("status").asText()).isEqualTo("FILLED");actor.anchorPosition=opened.path("positionId").asLong();
            jdbc.update("insert into trading.risk_hold(account_id,reason,evidence) values(?,'SOAK_REVIEW_FIXTURE','{\"fixture\":true}')",actor.id);
        }
        paused.set(true);worker.measurements();
        prices.beginSubscription(Set.copyOf(jdbc.queryForList("select id from trading.trading_symbol where status='ACTIVE'",Long.class)));
        Instant afterAllEntries=Instant.now();
        await().atMost(Duration.ofSeconds(15)).until(()->fresh(btc)&&prices.findAll(Set.of(btc)).get(btc).latestPrice().orElseThrow().receivedAt().isAfter(afterAllEntries));
        seedHistory();enableOneFixtureReplay();paused.set(false);
        for(int i=0;i<8;i++){var actor=actor(81_000_000L+i,i%2==0?btc:eth);normal.add(actor);connect(actor);}
        for(int i=0;i<2;i++){
            var actor=actor(82_000_000L+i,i==0?btc:eth);steady.add(actor);connect(actor);
            actor.anchorPosition=measured(actor,"POST","/api/v1/trading/account/orders",openBody(actor,"LONG"),"FILLED").path("positionId").asLong();
        }
        long initialJournal=jdbc.queryForObject("select count(*) from trading.risk_price_event where event_key not like 'soak-history-%'",Long.class);
        started=System.nanoTime();
        background.scheduleWithFixedDelay(()->{try{for(var actor:steady)refreshSocket(actor);sample();}catch(Exception failure){failures.add("sample:"+failure.getClass().getSimpleName());}},0,10,TimeUnit.SECONDS);
        // A finite worker pause creates a backlog while actual Binance ingestion continues.
        background.schedule(()->paused.set(true),60,TimeUnit.SECONDS);
        background.schedule(()->{try{sample();}catch(Exception error){failures.add("pause-sample");}finally{paused.set(false);}},63,TimeUnit.SECONDS);
        background.schedule(()->paused.set(true),seconds/2,TimeUnit.SECONDS);
        background.schedule(()->{try{sample();}catch(Exception error){failures.add("pause-sample");}finally{paused.set(false);}},seconds/2+3,TimeUnit.SECONDS);
        background.schedule(this::providerGap,seconds/3,TimeUnit.SECONDS);
        background.schedule(this::providerGap,seconds*2/3,TimeUnit.SECONDS);
        var tasks=new ArrayList<Future<?>>();
        for(var actor:normal)tasks.add(clients.submit(()->{
            long cycle=0;
            try{
                while(System.nanoTime()-started<TimeUnit.SECONDS.toNanos(seconds)){
                    long cycleStart=System.nanoTime();cycle(actor,cycle++);completedCycles.incrementAndGet();
                    long rest=TimeUnit.SECONDS.toNanos(8)-(System.nanoTime()-cycleStart);
                    if(rest>0)TimeUnit.NANOSECONDS.sleep(rest);
                }
            }catch(Throwable failure){failures.add("client:"+actor.id+":"+failure.getClass().getSimpleName()+":"+failure.getMessage());}
        }));
        for(var task:tasks)task.get(seconds+90L,TimeUnit.SECONDS);
        assertThat(failures).isEmpty();
        var replayed=held.get(held.size()-1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_account_work where account_id=? and status in ('PENDING','HELD')",Long.class,replayed.id)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and resolved_at is null",Long.class,replayed.id)).isZero();
        call(replayed,"POST","/api/v1/trading/account/positions/"+replayed.anchorPosition+"/close",null,200,true);
        assertThat(ledger.check(replayed.id).status()).isEqualTo("MATCHED");
        assertThat(failures).isEmpty();
        for(var actor:steady){refreshSocket(actor);measured(actor,"POST","/api/v1/trading/account/positions/"+actor.anchorPosition+"/close",null,"FILLED");}
        paused.set(false);
        await().atMost(Duration.ofSeconds(20)).until(()->pendingNormal()==0);
        for(var actor:all()){
            assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='OPEN'",Long.class,actor.id)).isZero();
            assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'",Long.class,actor.id)).isZero();
            assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");
        }
        long newJournal=jdbc.queryForObject("select count(*) from trading.risk_price_event where event_key not like 'soak-history-%'",Long.class)-initialJournal;
        assertThat(newJournal).as("Real continuous provider events").isGreaterThan(seconds*5L);
        assertThat(completedCycles.get()).isGreaterThan(seconds/8L*4);
        assertThat(progress.stream().mapToLong(x->((Number)x.get("pending")).longValue()).max().orElse(0)).as("Finite pause really creates measurable healthy backlog").isGreaterThanOrEqualTo(4);
        assertThat(failures).isEmpty();assertThat(pendingNormal()).isZero();
        assertThat(worker.measurements().lockTimeouts()).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id in ("+slots(normal.size()+steady.size())+") and resolved_at is null",Long.class,ids())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id in ("+slots(normal.size()+steady.size())+") and resolution_reference like 'AUTO_OBSERVED_MARK_V1:%'",Long.class,ids())).isGreaterThanOrEqualTo(4);
        assertThat(jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id in ("+slots(normal.size()+steady.size())+")",Long.class,ids())).isEqualTo(jdbc.queryForObject("select count(*) from trading.trading_order where status='FILLED' and account_id in ("+slots(normal.size()+steady.size())+")",Long.class,ids()));
        long duplicates=jdbc.queryForObject("select count(*) from (select f.order_id from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id in ("+slots(normal.size()+steady.size())+") group by f.order_id having count(*)<>1) bad",Long.class,ids());
        assertThat(duplicates).isZero();
        sample();writeResult("complete",newJournal);completed=true;System.out.println("MEMBER_SOAK_COMPLETE "+Files.readString(Path.of(".gradle/member-soak-result.json")));
    }
    void cycle(Actor actor,long number)throws Exception{
        refreshSocket(actor);
        String side=number%2==0?"LONG":"SHORT";
        var opened=measured(actor,"POST","/api/v1/trading/account/orders",openBody(actor,side),"FILLED");
        // Response-loss replay uses the exact original key. No second Fill may appear.
        if(number%10==0){var replay=callWithKey(actor,"POST","/api/v1/trading/account/orders",openBody(actor,side),200,true,actor.lastKey);assertThat(replay.path("orderId").asLong()).isEqualTo(opened.path("orderId").asLong());}
        long position=opened.path("positionId").asLong();
        measured(actor,"POST","/api/v1/trading/account/orders",openBody(actor,side),"FILLED");
        measured(actor,"POST","/api/v1/trading/account/positions/"+position+"/close",json.writeValueAsString(Map.of("quantity",quantity(actor))),"FILLED");
        BigDecimal mark=prices.findAll(Set.of(actor.symbol)).get(actor.symbol).latestPrice().orElseThrow().domainMarkPrice();
        String limit=mark.multiply(new BigDecimal(side.equals("LONG")?"0.995":"1.005")).setScale(18,RoundingMode.HALF_EVEN).toPlainString();
        String body=json.writeValueAsString(Map.of("type","LIMIT","tradingSymbolId",actor.symbol,"side",side,"quantity",quantity(actor),"leverage",side.equals("LONG")?15:7,"limitPrice",limit));
        var pending=measured(actor,"POST","/api/v1/trading/account/orders",body,"PENDING");
        measured(actor,"POST","/api/v1/trading/account/orders/"+pending.path("orderId").asLong()+"/cancel",null,"CANCELED");
        String exitLimit=mark.multiply(new BigDecimal(side.equals("LONG")?"1.005":"0.995")).setScale(18,RoundingMode.HALF_EVEN).toPlainString();
        var close=measured(actor,"POST","/api/v1/trading/account/positions/"+position+"/close-orders",json.writeValueAsString(Map.of("quantity",quantity(actor),"limitPrice",exitLimit)),"PENDING");
        measured(actor,"POST","/api/v1/trading/account/orders/"+close.path("orderId").asLong()+"/cancel",null,"CANCELED");
        measured(actor,"POST","/api/v1/trading/account/positions/"+position+"/close",null,"FILLED");
        if(number%10==0){call(actor,"GET","/api/v1/trading/account/performance/symbols",null,200,false);assertThat(ledger.check(actor.id).status()).isEqualTo("MATCHED");}
    }
    JsonNode measured(Actor actor,String method,String path,String body,String transition)throws Exception{
        long start=System.nanoTime();JsonNode value=call(actor,method,path,body,200,true);long done=System.nanoTime();
        logical.add(done-start);submittedOrders.incrementAndGet();
        assertThat(value.path("status").asText()).isEqualTo(transition);
        String key=value.path("orderId").asText()+"|"+transition;
        await().atMost(Duration.ofSeconds(5)).until(()->actor.received.containsKey(key));
        long delivered=actor.received.remove(key);delivery.add(Math.max(0,delivered-start));transitions.incrementAndGet();
        if(transition.equals("FILLED"))execution.add(done-start); // Successful response observes the committed Fill, not its pre-commit executedAt timestamp.
        return value;
    }
    Actor actor(long member,long symbol)throws Exception{
        var actor=new Actor(member,symbol);actor.id=call(actor,"POST","/api/v1/trading/accounts/member",null,200,false).path("accountId").asLong();
        for(String side:List.of("LONG","SHORT"))call(actor,"PUT","/api/v1/trading/account/symbols/"+symbol+"/leverage",json.writeValueAsString(Map.of("side",side,"leverage",side.equals("LONG")?15:7)),200,true);
        return actor;
    }
    String openBody(Actor actor,String side)throws Exception{return json.writeValueAsString(Map.of("type","MARKET","tradingSymbolId",actor.symbol,"side",side,"quantity",quantity(actor),"leverage",side.equals("LONG")?15:7));}
    String quantity(Actor actor){return actor.symbol==btc?"0.0005":"0.02";}
    JsonNode call(Actor actor,String method,String path,String body,int expected,boolean retry)throws Exception{return callWithKey(actor,method,path,body,expected,retry,UUID.randomUUID().toString());}
    JsonNode callWithKey(Actor actor,String method,String path,String body,int expected,boolean retry,String key)throws Exception{
        actor.lastKey=key;actor.operationStartedMillis=System.currentTimeMillis();
        for(int attempt=0;attempt<60;attempt++){
            var builder=HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(8)).header("Authorization","Bearer "+actor.token()).header("Idempotency-Key",key);
            if(body!=null)builder.header("Content-Type","application/json");
            long start=System.nanoTime();var result=http.send(builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());response.add(System.nanoTime()-start);
            var node=result.body().isBlank()?json.createObjectNode():json.readTree(result.body());
            if(result.statusCode()==expected)return node;
            String code=node.path("code").asText(Integer.toString(result.statusCode()));rejections.computeIfAbsent(code,k->new LongAdder()).increment();
            if(retry&&List.of("ACCOUNT_RISK_PENDING","ENGINE_RECOVERING","TRADING_BUSY","PRICE_NOT_FRESH").contains(code)){Thread.sleep(75);continue;}
            throw new AssertionError(method+" "+path+" status="+result.statusCode()+" code="+code);
        }
        throw new AssertionError("persistent admission rejection: "+path);
    }
    void seedHistory()throws Exception{
        String payload=json.writeValueAsString(MarketDataEvent.price(prices.findAll(Set.of(btc)).get(btc).latestPrice().orElseThrow()));
        jdbc.update("insert into trading.risk_price_event(event_key,kind,payload,occurred_at) select 'soak-history-'||g,'PRICE',?::jsonb,clock_timestamp() from generate_series(1,20000) g",payload);
        for(var actor:held)jdbc.update("insert into trading.risk_account_work(account_id,event_id,round_id) select ?,e.id,(select id from trading.member_trading_round where account_id=? and status='ACTIVE') from trading.risk_price_event e where event_key like 'soak-history-%'",actor.id,actor.id);
        // Fixture-only history precedes every normal account. No active normal work is skipped.
        jdbc.update("update trading.risk_dispatch_cursor set event_id=(select max(id) from trading.risk_price_event) where id=1");
    }
    void enableOneFixtureReplay(){
        // Five accounts retain 100k manual-held rows. One account replays its 20k accepted fixture
        // rows alongside normal member traffic; these synthetic rows are not counted as provider ingress.
        var replayed=held.get(held.size()-1);
        jdbc.update("update trading.risk_hold set resolved_at=clock_timestamp(),resolution_reference='SOAK_FIXTURE_AUTO_REPLAY' where account_id=? and reason='SOAK_REVIEW_FIXTURE' and resolved_at is null",replayed.id);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_hold where account_id=? and reason='PROVIDER_CONTINUITY_UNKNOWN' and resolved_at is null",Long.class,replayed.id)).isEqualTo(1);
    }
    void providerGap(){
        try{prices.markUnavailable();prices.beginSubscription(Set.copyOf(jdbc.queryForList("select id from trading.trading_symbol where status='ACTIVE'",Long.class)));}
        catch(Exception failure){failures.add("provider-gap:"+failure.getClass().getSimpleName());}
    }
    void sample()throws Exception{
        var snapshot=new LinkedHashMap<String,Object>();snapshot.put("elapsedSeconds",TimeUnit.NANOSECONDS.toSeconds(System.nanoTime()-started));
        var backlog=jdbc.queryForMap("select count(*) pending,coalesce(max(extract(epoch from(clock_timestamp()-e.recorded_at))),0) oldest_seconds from trading.risk_account_work w join trading.risk_price_event e on e.id=w.event_id where w.status='PENDING' and w.account_id in ("+slots(normal.size()+steady.size())+")",ids());
        snapshot.putAll(backlog);snapshot.put("cycles",completedCycles.get());snapshot.put("failures",List.copyOf(failures));snapshot.put("worker",worker.measurements());progress.add(snapshot);
        Files.createDirectories(Path.of(".gradle"));Files.writeString(Path.of(".gradle/member-soak-progress.json"),json.writeValueAsString(progress));
        if(((Number)snapshot.get("elapsedSeconds")).longValue()%60<10)System.out.println("MEMBER_SOAK_PROGRESS "+json.writeValueAsString(snapshot));
    }
    void writeResult(String status,long newJournal)throws Exception{
        var result=new LinkedHashMap<String,Object>();result.put("status",status);result.put("branch",System.getenv("TRADING_VERIFICATION_BRANCH"));result.put("commit",System.getenv("TRADING_VERIFICATION_COMMIT"));result.put("port",port);
        result.put("actualProvider",true);result.put("workerDelayMs",50);result.put("controlledAvailabilityGaps",2);result.put("autoRecoveredHolds",jdbc.queryForObject("select count(*) from trading.risk_hold where account_id in ("+slots(normal.size()+steady.size())+") and resolution_reference like 'AUTO_OBSERVED_MARK_V1:%'",Long.class,ids()));result.put("elapsedSeconds",TimeUnit.NANOSECONDS.toSeconds(System.nanoTime()-started));result.put("normalMembers",normal.size()+steady.size());result.put("cyclingMembers",normal.size());result.put("steadyMembers",steady.size());result.put("heldMembers",held.size()-1);result.put("automaticReplayMembers",1);result.put("fixturePending",120000);result.put("manualHeldFixtureWork",100000);result.put("automaticReplayFixtureWork",20000);result.put("newProviderEvents",newJournal);result.put("completedCycles",completedCycles.get());result.put("mutations",submittedOrders.get());result.put("receivedTransitions",transitions.get());
        result.put("responseMs",response.summary());result.put("logicalMutationMs",logical.summary());result.put("executionMs",execution.summary());result.put("privateWsMs",delivery.summary());result.put("rejections",rejections);result.put("worker",worker.measurements());result.put("failures",failures);result.put("progress",progress);
        Files.writeString(Path.of(".gradle/member-soak-result.json"),json.writerWithDefaultPrettyPrinter().writeValueAsString(result));
    }
    long pendingNormal(){return jdbc.queryForObject("select count(*) from trading.risk_account_work where status='PENDING' and account_id in ("+slots(normal.size()+steady.size())+")",Long.class,ids());}
    Object[] ids(){return all().stream().map(a->a.id).toArray();}
    List<Actor> all(){return java.util.stream.Stream.concat(normal.stream(),steady.stream()).toList();}
    String slots(int size){return String.join(",",Collections.nCopies(size,"?"));}
    long symbol(String symbol){return jdbc.queryForObject("select id from trading.trading_symbol where symbol=?",Long.class,symbol);}
    boolean fresh(long symbol){return prices.findAll(Set.of(symbol)).get(symbol).status()==LatestPriceStore.Status.FRESH;}
    void refreshSocket(Actor actor)throws Exception{actor.token();if(actor.socket==null||actor.socketGeneration!=actor.generation)connect(actor);else actor.socket.sendText("{\"type\":\"PING\"}",true).join();}
    void connect(Actor actor)throws Exception{
        if(actor.socket!=null)actor.socket.sendClose(1000,"renew").join();
        actor.socket=http.newWebSocketBuilder().header("Origin","http://localhost:3000").connectTimeout(Duration.ofSeconds(5)).buildAsync(URI.create("ws://localhost:"+port+"/ws/trading"),new WebSocket.Listener(){
            final StringBuilder message=new StringBuilder();
            public void onOpen(WebSocket socket){socket.request(1);}
            public CompletionStage<?> onText(WebSocket socket,CharSequence data,boolean last){
                message.append(data);if(last){try{var frame=json.readTree(message.toString());if(frame.path("type").asText().equals("TRADING_EVENT")){
                    var event=frame.path("data");long cursor=event.path("eventId").asLong();actor.cursor.accumulateAndGet(cursor,Math::max);
                    var order=event.path("order");actor.received.putIfAbsent(order.path("orderId").asText()+"|"+order.path("status").asText(),System.nanoTime());
                }}catch(Exception error){failures.add("ws-parse:"+error.getClass().getSimpleName());}message.setLength(0);}socket.request(1);return null;
            }
            public void onError(WebSocket socket,Throwable error){failures.add("ws:"+error.getClass().getSimpleName());}
        }).get(10,TimeUnit.SECONDS);
        actor.socket.sendText(json.writeValueAsString(Map.of("type","AUTHENTICATE","credential",actor.token(),"afterEventId",Long.toString(actor.cursor.get()))),true).join();actor.socketGeneration=actor.generation;
    }
    @AfterEach void stop()throws Exception{
        background.shutdownNow();clients.shutdownNow();for(var actor:all())if(actor.socket!=null)actor.socket.abort();
        if(started!=0&&!completed)writeResult("incomplete",0);
    }
    static final class Metric{
        final ConcurrentLinkedQueue<Long> values=new ConcurrentLinkedQueue<>();void add(long nanos){values.add(Math.max(0,nanos));}
        Map<String,Object> summary(){var sorted=values.stream().sorted().toList();if(sorted.isEmpty())return Map.of("count",0);return Map.of("count",sorted.size(),"p50",at(sorted,.5),"p95",at(sorted,.95),"p99",at(sorted,.99),"max",sorted.get(sorted.size()-1)/1_000_000.0);}
        double at(List<Long> values,double percentile){return values.get(Math.max(0,(int)Math.ceil(percentile*values.size())-1))/1_000_000.0;}
    }
    static final class Actor{
        final long member,symbol;long id,tokenAt,generation,socketGeneration,operationStartedMillis,anchorPosition;String access,lastKey;WebSocket socket;
        final AtomicLong cursor=new AtomicLong();final ConcurrentHashMap<String,Long> received=new ConcurrentHashMap<>();
        Actor(long member,long symbol){this.member=member;this.symbol=symbol;}
        String token(){if(access==null||System.currentTimeMillis()-tokenAt>600_000){tokenAt=System.currentTimeMillis();generation++;var now=Instant.now();var claims=JwtClaimsSet.builder().issuer("https://content.test").subject(Long.toString(member)).issuedAt(now.minusSeconds(2)).expiresAt(now.plusSeconds(898)).audience(List.of("trading")).claim("token_use","access").claim("roles",List.of("MEMBER")).build();access=ENCODER.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(),claims)).getTokenValue();}return access;}
    }
    static RSAKey key(){try{return new RSAKeyGenerator(2048).generate();}catch(Exception error){throw new ExceptionInInitializerError(error);}}
    static Path publicFile(){try{var file=Files.createTempFile("trading-soak-public-",".pem");file.toFile().deleteOnExit();Files.writeString(file,"-----BEGIN PUBLIC KEY-----\n"+Base64.getMimeEncoder(64,new byte[]{'\n'}).encodeToString(KEY.toRSAPublicKey().getEncoded())+"\n-----END PUBLIC KEY-----\n");return file;}catch(Exception error){throw new ExceptionInInitializerError(error);}}
}
