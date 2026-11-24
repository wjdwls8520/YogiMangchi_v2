package com.yogimangchi.trading.qa;

import com.fasterxml.jackson.databind.*;
import com.yogimangchi.trading.TradingServerApplication;
import com.yogimangchi.trading.binance.candle.BinanceCandleClient;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.marketdata.candle.CandleInterval;
import com.yogimangchi.trading.marketdata.candle.CandleResponse;
import java.io.*;
import java.math.BigDecimal;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.slf4j.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Manual test launcher, not a production component or price-changing HTTP API.
 * Run controlledQa from this service with explicit isolated settings and an ignored scenario file.
 * Only the input feed is controlled; journal, Redis, scheduling and financial execution stay real.
 */
public final class ControlledPriceQa {
    private static final ObjectMapper JSON=new ObjectMapper().enable(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY);
    private static final Logger log=LoggerFactory.getLogger(ControlledPriceQa.class);
    private static final Set<String> ORIGINS=Set.of("http://localhost:3311","http://127.0.0.1:3311");
    private static final String DATABASE_URL="jdbc:postgresql://127.0.0.1:58491/yogimangchi";
    private ControlledPriceQa(){ }
    public static void main(String[] args){
        new SpringApplicationBuilder(TradingServerApplication.class,Configuration.class)
                .initializers(context->validate(context.getEnvironment(),runtimeDirectory())).run(args);
    }
    static Path runtimeDirectory(){return Path.of(".gradle/controlled-qa").toAbsolutePath().normalize();}
    // Runs before any DataSource/Flyway bean can connect to a database.
    static void validate(Environment env,Path directory){
        require(env,"controlled-qa.enabled","true");require(env,"server.address","127.0.0.1");require(env,"server.port","18091");
        require(env,"spring.datasource.url",DATABASE_URL);
        for(String property:List.of("spring.flyway.url","spring.datasource.hikari.jdbc-url")){
            if(env.containsProperty(property))require(env,property,DATABASE_URL);
        }
        for(String property:List.of("spring.datasource.jndi-name","spring.data.redis.url","spring.data.redis.sentinel.master","spring.data.redis.cluster.nodes")){
            if(env.containsProperty(property))throw new IllegalArgumentException("Alternate QA connection is not allowed: "+property);
        }
        require(env,"spring.data.redis.host","127.0.0.1");require(env,"spring.data.redis.port","58492");
        require(env,"spring.jpa.hibernate.ddl-auto","validate");require(env,"spring.flyway.clean-disabled","true");
        require(env,"spring.flyway.default-schema","trading");require(env,"spring.flyway.schemas","trading");
        require(env,"spring.jpa.properties.hibernate.default_schema","trading");
        require(env,"binance.mark-price.enabled","false");require(env,"binance.order-book.enabled","false");
        require(env,"trading.risk-journal.enabled","true");require(env,"trading.trigger.enabled","true");
        require(env,"marketdata.redis.enabled","true");require(env,"trading.member-auth.enabled","true");
        require(env,"trading.member-auth.issuer","http://localhost:18080");
        if(Arrays.asList(env.getActiveProfiles()).contains("prod"))throw new IllegalArgumentException("QA cannot use prod profile");
        for(String property:List.of("trading.http.allowed-origins","marketdata.websocket.allowed-origins")){
            var origins=new HashSet<>(Arrays.asList(env.getRequiredProperty(property).split(",")));
            if(origins.isEmpty()||!ORIGINS.containsAll(origins))throw new IllegalArgumentException("QA origin must use port 3311");
        }
        try{
            var scenario=Path.of(env.getRequiredProperty("controlled-qa.scenario-path")).toRealPath();
            if(!scenario.startsWith(directory.toRealPath())||!Files.isRegularFile(scenario))throw new IllegalArgumentException("QA scenario must be in its ignored runtime directory");
            var publicKey=Path.of(env.getRequiredProperty("trading.member-auth.public-key-path"));
            if(Files.size(publicKey)>8192)throw new IllegalArgumentException("Invalid QA public key");
            String pem=Files.readString(publicKey);
            if(!pem.startsWith("-----BEGIN PUBLIC KEY-----")||pem.contains("PRIVATE KEY"))throw new IllegalArgumentException("QA requires the approved Content public key");
        }catch(IOException failure){throw new IllegalArgumentException("QA input/public key is unavailable");}
    }
    private static void require(Environment env,String key,String value){
        if(!value.equals(env.getProperty(key)))throw new IllegalArgumentException("Unsafe or missing QA setting: "+key);
    }

    enum Phase { NORMAL,OUTAGE,RECOVERY }
    record Scenario(long sequence,Phase phase,boolean available,Map<String,BigDecimal> prices){ }
    static Scenario scenario(byte[] bytes,Set<String> active){
        if(bytes.length>65536)throw new IllegalArgumentException("QA scenario exceeds 64 KiB");
        try{
            JsonNode root=JSON.readTree(bytes);shape(root,Set.of("sequence","phase","available","prices"));
            if(!root.path("sequence").isIntegralNumber()||!root.path("sequence").canConvertToLong()||root.path("sequence").longValue()<0)throw new IllegalArgumentException("Invalid QA sequence");
            Phase phase=Phase.valueOf(root.path("phase").asText());
            if(!root.path("available").isBoolean())throw new IllegalArgumentException("QA availability must be explicit");
            boolean available=root.path("available").booleanValue();
            if((phase==Phase.OUTAGE)==available)throw new IllegalArgumentException("QA phase and availability disagree");
            JsonNode values=root.path("prices");
            if(!values.isObject()||values.isEmpty()||values.size()>active.size())throw new IllegalArgumentException("Invalid QA price set");
            var prices=new TreeMap<String,BigDecimal>();var fields=values.fields();
            while(fields.hasNext()){
                var field=fields.next();JsonNode value=field.getValue();
                if(!active.contains(field.getKey())||!value.isTextual()||value.textValue().length()>80)throw new IllegalArgumentException("Invalid QA symbol/price");
                BigDecimal price=new BigDecimal(value.textValue());TradingMath.validatePrice(price);prices.put(field.getKey(),price);
            }
            return new Scenario(root.path("sequence").longValue(),phase,available,Map.copyOf(prices));
        }catch(IOException|IllegalArgumentException|ArithmeticException failure){throw new IllegalArgumentException("Invalid controlled QA scenario");}
    }
    private static void shape(JsonNode node,Set<String> allowed){
        if(node==null||!node.isObject())throw new IllegalArgumentException("Expected QA object");
        node.fieldNames().forEachRemaining(name->{if(!allowed.contains(name))throw new IllegalArgumentException("Unknown QA field");});
    }

    @TestConfiguration(proxyBeanMethods=false)
    static class Configuration {
        @Bean ControlledFeed controlledFeed(LatestPriceStore prices,JdbcTemplate jdbc,Environment environment){return new ControlledFeed(prices,jdbc,environment);}
        @Bean static ControlledQaTelemetry telemetry(){return new ControlledQaTelemetry();}
        @Bean ControlledQaTelemetry.Requests requests(){return new ControlledQaTelemetry.Requests();}
        // Historical Binance candles are unrelated to the controlled scenario and its trading prices.
        @Bean @Primary BinanceCandleClient controlledCandleHistory(ObjectMapper mapper){
            return new BinanceCandleClient(mapper){
                @Override public List<CandleResponse> load(BinanceSubscriptionTarget target,CandleInterval interval,Instant before){return List.of();}
            };
        }
    }
    static final class ControlledFeed implements AutoCloseable {
        private final LatestPriceStore store;
        private final JdbcTemplate jdbc;
        private final Path path;
        private final Map<String,Long> ids=new TreeMap<>();
        private final ScheduledExecutorService executor=Executors.newSingleThreadScheduledExecutor(r->{var t=new Thread(r,"controlled-qa-feed");t.setDaemon(true);return t;});
        private Scenario last;
        private volatile boolean available;
        private Set<String> subscribed;
        private String failure;
        ControlledFeed(LatestPriceStore store,JdbcTemplate jdbc,Environment environment){
            this.store=store;
            this.jdbc=jdbc;
            path=Path.of(environment.getRequiredProperty("controlled-qa.scenario-path"));
        }
        @EventListener(ApplicationReadyEvent.class) public void start(){
            jdbc.query("select id,symbol from trading.trading_symbol where status='ACTIVE' and provider='BINANCE'",(org.springframework.jdbc.core.RowCallbackHandler)row->ids.put(row.getString("symbol"),row.getLong("id")));
            log.warn("CONTROLLED TEST FEED: port 18091, PostgreSQL 58491, Redis 58492; not Binance data. Financial history is persistent.");
            executor.scheduleWithFixedDelay(this::tick,0,1,TimeUnit.SECONDS);
        }
        private void tick(){
            try(var input=Files.newInputStream(path)){
                Scenario next=scenario(input.readNBytes(65537),ids.keySet());
                if(last!=null&&(next.sequence()<last.sequence()||(next.sequence()==last.sequence()&&!next.equals(last))))throw new IllegalArgumentException("QA scenario must advance sequence");
                if(subscribed!=null&&!subscribed.equals(next.prices().keySet()))throw new IllegalArgumentException("Restart QA before changing the subscription set");
                // After an invalid file, an explicit new sequence is required to resume.
                if(failure!=null&&last!=null&&next.sequence()<=last.sequence())return;
                last=next;failure=null;ControlledQaTelemetry.phase=next.phase().name();
                if(!next.available()){
                    if(available){
                        store.markUnavailable();available=false;
                        ControlledQaTelemetry.record("feed",Map.of("sequence",next.sequence(),"phase",next.phase(),"available",false,"receivedAt",Instant.now().toString()));
                    }
                    return;
                }
                if(!available){
                    subscribed=next.prices().keySet();var symbols=new HashSet<Long>();subscribed.forEach(symbol->symbols.add(ids.get(symbol)));
                    store.beginSubscription(symbols);available=true;
                }
                for(var price:new TreeMap<>(next.prices()).entrySet()){
                    Instant now=Instant.now();
                    if(!store.update(new LatestMarkPrice(ids.get(price.getKey()),price.getValue(),now,now)))throw new IllegalStateException("QA tick was not accepted");
                }
                ControlledQaTelemetry.record("feed",Map.of("sequence",next.sequence(),"phase",next.phase(),"available",true,"symbols",next.prices().keySet(),"receivedAt",Instant.now().toString()));
            }catch(Exception problem){
                if(available){
                    available=false;
                    try{store.markUnavailable();}
                    catch(RuntimeException journalFailure){log.warn("Controlled QA unavailable state could not be journaled cause={}",journalFailure.getClass().getSimpleName());}
                }
                ControlledQaTelemetry.phase="INPUT_BLOCKED";
                String type=problem.getClass().getSimpleName();
                if(!type.equals(failure))log.error("Controlled QA input blocked; advance a valid scenario sequence. cause={}",type);
                failure=type;
            }
        }
        @Override public void close(){executor.shutdownNow();if(available)store.markUnavailable();}
    }
}
