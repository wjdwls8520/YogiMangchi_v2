package com.yogimangchi.trading.marketdata.ticker;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/** Display-only latest values: bounded, lossy on overload, with no Stream or execution-engine side effects. */
@Component
public class RedisTickerStore {
    private static final Logger log = LoggerFactory.getLogger(RedisTickerStore.class);
    private static final DefaultRedisScript<Long> WRITE = new DefaultRedisScript<>("""
            local previous = redis.call('GET', KEYS[2])
            if previous and tonumber(previous) >= tonumber(ARGV[1]) then return 0 end
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            local ttl = math.min(tonumber(ARGV[1]), tonumber(ARGV[2])) + tonumber(ARGV[4]) - now
            if ttl <= 0 or tonumber(ARGV[1]) > now + 1000 or tonumber(ARGV[2]) > now + 1000 then return -1 end
            redis.call('SET', KEYS[1], ARGV[3], 'PX', math.min(ttl, tonumber(ARGV[4])))
            redis.call('SET', KEYS[2], ARGV[1], 'EX', 86400)
            return 1
            """, Long.class);
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final ArrayBlockingQueue<MarketTicker> pending = new ArrayBlockingQueue<>(256);
    private final ScheduledExecutorService publisher = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "market-ticker-redis");
        thread.setDaemon(true);
        return thread;
    });
    private volatile boolean closed;
    private long retryAfter;

    public RedisTickerStore(RedisConnectionFactory connections, ObjectMapper mapper) {
        this.redis = new StringRedisTemplate(connections);
        this.mapper = mapper;
    }

    public static String snapshotKey(long id) { return "trading:market:v1:ticker:" + id; }
    public static String watermarkKey(long id) { return "trading:market:v1:ticker-watermark:" + id; }

    @PostConstruct
    public void start() { publisher.scheduleWithFixedDelay(this::pump, 0, 50, TimeUnit.MILLISECONDS); }

    /** Called on the Binance executor: never performs I/O or waits for the Redis worker. */
    public void accept(MarketTicker ticker) {
        if (closed || !ticker.isFreshAt(Instant.now())) return;
        if (!pending.offer(ticker)) {
            pending.poll();
            pending.offer(ticker);
        }
    }

    private void pump() {
        if (closed || System.nanoTime() < retryAfter) return;
        for (int i = 0; i < 64; i++) {
            MarketTicker ticker = pending.poll();
            if (ticker == null) return;
            if (!ticker.isFreshAt(Instant.now())) continue;
            try {
                redis.execute(WRITE, List.of(snapshotKey(ticker.tradingSymbolId()), watermarkKey(ticker.tradingSymbolId())),
                        Long.toString(ticker.eventTime().toEpochMilli()), Long.toString(ticker.receivedAt().toEpochMilli()),
                        mapper.writeValueAsString(ticker), Long.toString(MarketTicker.FRESHNESS.toMillis()));
            } catch (JsonProcessingException | RuntimeException exception) {
                // Do not retry a stale backlog indefinitely. The next provider update restores the latest value.
                pending.clear();
                retryAfter = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
                log.warn("[Redis ticker] publish unavailable; retry in 5s: {}", exception.getClass().getSimpleName());
                return;
            }
        }
    }

    @PreDestroy
    public void close() { closed = true; pending.clear(); publisher.shutdownNow(); }
}
