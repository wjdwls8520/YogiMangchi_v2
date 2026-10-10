package com.yogimangchi.trading.marketdata;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;

/** Bounded asynchronous bridge. A Redis outage never holds the Binance callback or a PostgreSQL transaction. */
@Component
@ConditionalOnProperty(name = "marketdata.redis.enabled", havingValue = "true", matchIfMissing = true)
public class RedisMarketDataBridge {
    public static final String STREAM_KEY = "trading:market:v1:events";
    public static final String CHANNEL = "trading:market:v1:fanout";
    public static final long STREAM_MAX_LENGTH = 100_000;
    private static final Logger log = LoggerFactory.getLogger(RedisMarketDataBridge.class);
    private static final Duration RETRY_DELAY = Duration.ofSeconds(5);
    private static final DefaultRedisScript<Long> PRICE_SCRIPT = new DefaultRedisScript<>("""
            local previous = redis.call('GET', KEYS[2])
            if previous and tonumber(previous) >= tonumber(ARGV[1]) then return 0 end
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            local ttl = math.min(tonumber(ARGV[1]), tonumber(ARGV[2])) + 5000 - now
            if ttl <= 0 or tonumber(ARGV[1]) > now + 1000 or tonumber(ARGV[2]) > now + 1000 then return -1 end
            ttl = math.min(ttl, 5000)
            redis.call('SET', KEYS[1], ARGV[3], 'PX', ttl)
            redis.call('SET', KEYS[2], ARGV[1], 'EX', 86400)
            redis.call('SET', KEYS[3], 'FRESH', 'PX', ttl)
            redis.call('XADD', KEYS[4], 'MAXLEN', ARGV[4], '*', 'payload', ARGV[3])
            redis.call('PUBLISH', KEYS[5], ARGV[3])
            return 1
            """, Long.class);
    private static final DefaultRedisScript<Long> STATE_SCRIPT = new DefaultRedisScript<>("""
            for i = 3, #KEYS, 2 do
                redis.call('DEL', KEYS[i])
                redis.call('SET', KEYS[i+1], ARGV[3], 'EX', 30)
            end
            redis.call('XADD', KEYS[1], 'MAXLEN', ARGV[2], '*', 'payload', ARGV[1])
            redis.call('PUBLISH', KEYS[2], ARGV[1])
            return 1
            """, Long.class);

    public enum State { STARTING, HEALTHY, UNAVAILABLE }
    public record Health(State state, long gapSequence) { }

    private final RedisConnectionFactory connectionFactory;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final MarketDataFanout fanout;
    private final ArrayBlockingQueue<MarketDataEvent> pending = new ArrayBlockingQueue<>(1024);
    private final ScheduledExecutorService publisher = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "market-data-redis");
        thread.setDaemon(true);
        return thread;
    });
    private final ThreadPoolExecutor subscriberExecutor = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(1024), runnable -> {
                Thread thread = new Thread(runnable, "market-data-redis-subscriber");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.CallerRunsPolicy());
    private final RedisMessageListenerContainer subscriber = new RedisMessageListenerContainer();
    private final AtomicLong gapSequence = new AtomicLong();
    private volatile State state = State.STARTING;
    private volatile long retryAfter;
    private long lastHealthCheck;
    private volatile boolean closed;

    public RedisMarketDataBridge(RedisConnectionFactory connectionFactory, ObjectMapper mapper, MarketDataFanout fanout) {
        this.connectionFactory = connectionFactory;
        this.redis = new StringRedisTemplate(connectionFactory);
        this.mapper = mapper;
        this.fanout = fanout;
    }

    @PostConstruct
    public void start() {
        subscriber.setConnectionFactory(connectionFactory);
        subscriber.setTaskExecutor(subscriberExecutor);
        subscriber.setRecoveryInterval(RETRY_DELAY.toMillis());
        subscriber.setMaxSubscriptionRegistrationWaitingTime(1000);
        subscriber.setErrorHandler(ex -> unavailable("subscriber " + ex.getClass().getSimpleName()));
        subscriber.addMessageListener((message, pattern) -> {
            try {
                fanout.publish(mapper.readValue(new String(message.getBody(), StandardCharsets.UTF_8), MarketDataEvent.class));
            } catch (JsonProcessingException | IllegalArgumentException ex) {
                log.warn("[Redis market data] invalid shared event ignored");
            }
        }, new ChannelTopic(CHANNEL));
        subscriber.afterPropertiesSet();
        publisher.scheduleWithFixedDelay(this::pump, 0, 50, TimeUnit.MILLISECONDS);
    }

    @EventListener
    public void accept(MarketDataEvent event) {
        if (closed) {
            return;
        }
        if (!pending.offer(event)) {
            unavailable("publisher queue full");
            fanout.publish(event);
        }
    }

    public Health health() {
        return new Health(state, gapSequence.get());
    }

    /** A cache miss or failure is never a usable execution price. Prefer the local store on this single node. */
    public LatestPriceStore.Snapshot readSharedSnapshot(long symbolId) {
        try {
            List<String> values = redis.opsForValue().multiGet(List.of(snapshotKey(symbolId), stateKey(symbolId)));
            String json = values.get(0);
            String status = values.get(1);
            if (json == null || !"FRESH".equals(status)) {
                return new LatestPriceStore.Snapshot(status == null ? LatestPriceStore.Status.MISSING
                        : LatestPriceStore.Status.UNAVAILABLE, Optional.empty());
            }
            LatestMarkPrice price = mapper.readValue(json, MarketDataEvent.class).price();
            Instant now = Instant.now();
            boolean fresh = LatestPriceStore.isFreshAt(price, now);
            return new LatestPriceStore.Snapshot(fresh ? LatestPriceStore.Status.FRESH
                    : LatestPriceStore.Status.STALE, Optional.of(price));
        } catch (Exception ex) {
            unavailable("snapshot read " + ex.getClass().getSimpleName());
            return new LatestPriceStore.Snapshot(LatestPriceStore.Status.UNAVAILABLE, Optional.empty());
        }
    }

    public static String snapshotKey(long symbolId) { return "trading:market:v1:snapshot:" + symbolId; }
    public static String watermarkKey(long symbolId) { return "trading:market:v1:watermark:" + symbolId; }
    private static String stateKey(long symbolId) { return "trading:market:v1:state:" + symbolId; }

    private void pump() {
        if (closed) {
            return;
        }
        try {
            if (state != State.HEALTHY && System.nanoTime() >= retryAfter) {
                retryAfter = System.nanoTime() + RETRY_DELAY.toNanos();
                try (var connection = connectionFactory.getConnection()) {
                    connection.ping();
                }
                if (!subscriber.isRunning()) {
                    subscriber.start();
                }
                if (!subscriber.isListening()) {
                    throw new IllegalStateException("Pub/Sub subscription unavailable");
                }
                state = State.HEALTHY;
                lastHealthCheck = System.nanoTime();
                log.info("[Redis market data] HEALTHY gapSequence={}", gapSequence.get());
            }
            if (state == State.HEALTHY && System.nanoTime() - lastHealthCheck >= TimeUnit.SECONDS.toNanos(1)) {
                lastHealthCheck = System.nanoTime();
                try (var connection = connectionFactory.getConnection()) {
                    connection.ping();
                }
                if (!subscriber.isListening()) {
                    throw new IllegalStateException("Pub/Sub subscription unavailable");
                }
            }
            for (int count = 0; count < 64; count++) {
                MarketDataEvent event = pending.poll();
                if (event == null) {
                    break;
                }
                if (state != State.HEALTHY) {
                    // Current single-node display/market reads use the local cache. Replay is explicitly degraded.
                    gapSequence.incrementAndGet();
                    fanout.publish(event);
                    continue;
                }
                try {
                    publish(event);
                } catch (RuntimeException | JsonProcessingException ex) {
                    unavailable("publish " + ex.getClass().getSimpleName());
                    fanout.publish(event);
                }
            }
        } catch (RuntimeException ex) {
            unavailable("connect " + ex.getClass().getSimpleName());
        }
    }

    private void publish(MarketDataEvent event) throws JsonProcessingException {
        String payload = mapper.writeValueAsString(event);
        if (event.type() == MarketDataEvent.Type.PRICE) {
            LatestMarkPrice price = event.price();
            Long accepted = redis.execute(PRICE_SCRIPT, List.of(snapshotKey(price.tradingSymbolId()),
                    watermarkKey(price.tradingSymbolId()), stateKey(price.tradingSymbolId()), STREAM_KEY, CHANNEL),
                    Long.toString(price.eventTime().toEpochMilli()), Long.toString(price.receivedAt().toEpochMilli()),
                    payload, Long.toString(STREAM_MAX_LENGTH));
            if (Long.valueOf(-1).equals(accepted)) {
                gapSequence.incrementAndGet();
            }
        } else {
            var keys = new java.util.ArrayList<>(List.of(STREAM_KEY, CHANNEL));
            for (Long id : event.tradingSymbolIds()) {
                keys.add(snapshotKey(id));
                keys.add(stateKey(id));
            }
            redis.execute(STATE_SCRIPT, keys, payload, Long.toString(STREAM_MAX_LENGTH), event.type().name());
        }
    }

    private synchronized void unavailable(String reason) {
        if (closed) {
            return;
        }
        if (state != State.UNAVAILABLE) {
            gapSequence.incrementAndGet();
            retryAfter = System.nanoTime() + RETRY_DELAY.toNanos();
            log.warn("[Redis market data] UNAVAILABLE reason={} localFallback=true replayContinuity=false", reason);
        }
        state = State.UNAVAILABLE;
    }

    @PreDestroy
    public void close() {
        closed = true;
        publisher.shutdownNow();
        try {
            subscriber.destroy();
        } catch (Exception ex) {
            log.warn("[Redis market data] subscriber shutdown failed type={}", ex.getClass().getSimpleName());
        } finally {
            subscriberExecutor.shutdownNow();
        }
    }
}
