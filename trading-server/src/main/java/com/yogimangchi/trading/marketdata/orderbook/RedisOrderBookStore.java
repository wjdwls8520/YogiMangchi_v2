package com.yogimangchi.trading.marketdata.orderbook;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;

/** Independent, lossy UI path. No market-price gate, execution events or Redis Stream writes. */
@Component
public class RedisOrderBookStore implements AutoCloseable {
    public static final String CHANNEL = "trading:market:v1:orderbook:fanout";
    private static final Logger log = LoggerFactory.getLogger(RedisOrderBookStore.class);
    private static final DefaultRedisScript<Long> WRITE = new DefaultRedisScript<>("""
            local previous = redis.call('GET', KEYS[2])
            if previous then
                local id, event = string.match(previous, '^(%d+):(%d+)$')
                if not id or #id > #ARGV[1] or (#id == #ARGV[1] and id >= ARGV[1])
                    or tonumber(event) > tonumber(ARGV[2]) then return 0 end
            end
            local time = redis.call('TIME')
            local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
            local received, event = tonumber(ARGV[3]), tonumber(ARGV[2])
            local ttl = received + 3000 - now
            if ttl <= 0 or received > now + 1000 or event < received - 3000 or event > received + 10000 then return -1 end
            redis.call('SET', KEYS[1], ARGV[4], 'PX', math.min(ttl, 3000))
            redis.call('SET', KEYS[2], ARGV[1] .. ':' .. ARGV[2], 'EX', 86400)
            redis.call('PUBLISH', KEYS[3], ARGV[4])
            return 1
            """, Long.class);
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final RedisMessageListenerContainer subscriber = new RedisMessageListenerContainer();
    private final ArrayBlockingQueue<OrderBookSnapshot> pending = new ArrayBlockingQueue<>(128);
    private final CopyOnWriteArrayList<Consumer<OrderBookSnapshot>> listeners = new CopyOnWriteArrayList<>();
    private final Map<Long, OrderBookSnapshot> delivered = new LinkedHashMap<>();
    private final ScheduledExecutorService publisher = Executors.newSingleThreadScheduledExecutor(task -> daemon(task, "orderbook-redis"));
    private final ThreadPoolExecutor delivery = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(128), task -> daemon(task, "orderbook-fanout"), new ThreadPoolExecutor.DiscardOldestPolicy());
    private volatile boolean closed;
    private long retryAfter;

    public RedisOrderBookStore(RedisConnectionFactory connections, ObjectMapper mapper) {
        redis = new StringRedisTemplate(connections); this.mapper = mapper;
        subscriber.setConnectionFactory(connections);
        subscriber.setTaskExecutor(delivery);
        subscriber.setRecoveryInterval(5000);
        subscriber.setMaxSubscriptionRegistrationWaitingTime(1000);
        subscriber.setErrorHandler(error -> log.debug("[Order book] subscriber unavailable: {}", error.getClass().getSimpleName()));
        subscriber.addMessageListener((message, pattern) -> receive(new String(message.getBody(), StandardCharsets.UTF_8)), new ChannelTopic(CHANNEL));
    }
    public static String snapshotKey(long id) { return "trading:market:v1:orderbook:" + id; }
    public static String watermarkKey(long id) { return "trading:market:v1:orderbook-watermark:" + id; }

    @PostConstruct public void start() {
        subscriber.afterPropertiesSet();
        publisher.scheduleWithFixedDelay(this::pump, 0, 50, TimeUnit.MILLISECONDS);
    }
    public AutoCloseable subscribe(Consumer<OrderBookSnapshot> listener) {
        listeners.add(listener); return () -> listeners.remove(listener);
    }
    public void accept(OrderBookSnapshot book) {
        if (closed || !book.isFreshAt(Instant.now())) return;
        if (!pending.offer(book)) { pending.poll(); pending.offer(book); }
    }
    public Map<Long, OrderBookSnapshot> read(Set<Long> ids) {
        if (ids.isEmpty() || ids.size() > 32) return Map.of();
        try {
            List<Long> ordered = ids.stream().sorted().toList();
            List<String> values = redis.opsForValue().multiGet(ordered.stream().map(RedisOrderBookStore::snapshotKey).toList());
            var result = new HashMap<Long, OrderBookSnapshot>();
            for (int i = 0; values != null && i < values.size(); i++) {
                if (values.get(i) == null || values.get(i).length() > 32_768) continue;
                try {
                    var book = mapper.readValue(values.get(i), OrderBookSnapshot.class);
                    if (book.tradingSymbolId() == ordered.get(i) && book.isFreshAt(Instant.now())) result.put(book.tradingSymbolId(), book);
                } catch (java.io.IOException | RuntimeException invalid) { /* Treat corrupt optional UI data as missing. */ }
            }
            return Map.copyOf(result);
        } catch (RuntimeException failure) { return Map.of(); }
    }
    private void pump() {
        if (closed || System.nanoTime() < retryAfter) return;
        try {
            if (!subscriber.isRunning()) subscriber.start();
            for (int i = 0; i < 64; i++) {
                var book = pending.poll();
                if (book == null) return;
                if (book.isFreshAt(Instant.now())) publish(book);
            }
        } catch (Exception failure) {
            pending.clear(); retryAfter = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            log.warn("[Order book] Redis unavailable; retry in 5s: {}", failure.getClass().getSimpleName());
        }
    }
    Long publish(OrderBookSnapshot book) throws com.fasterxml.jackson.core.JsonProcessingException {
        return redis.execute(WRITE, List.of(snapshotKey(book.tradingSymbolId()), watermarkKey(book.tradingSymbolId()), CHANNEL),
                Long.toString(book.providerUpdateId()), Long.toString(book.eventTime().toEpochMilli()),
                Long.toString(book.receivedAt().toEpochMilli()), mapper.writeValueAsString(book));
    }
    private void receive(String json) {
        try {
            if (closed || json.length() > 32_768) return;
            var book = mapper.readValue(json, OrderBookSnapshot.class);
            if (!book.isFreshAt(Instant.now()) || !book.newerThan(delivered.get(book.tradingSymbolId()))) return;
            delivered.put(book.tradingSymbolId(), book);
            if (delivered.size() > 128) delivered.remove(delivered.keySet().iterator().next());
            for (var listener : listeners) {
                try { listener.accept(book); } catch (RuntimeException failure) { log.debug("[Order book] listener failed"); }
            }
        } catch (java.io.IOException | RuntimeException failure) { log.debug("[Order book] invalid shared snapshot ignored"); }
    }
    private static Thread daemon(Runnable task, String name) { var thread = new Thread(task, name); thread.setDaemon(true); return thread; }
    @PreDestroy @Override public void close() {
        closed = true; pending.clear(); listeners.clear(); publisher.shutdownNow();
        try { subscriber.destroy(); }
        catch (Exception failure) { log.debug("[Order book] subscriber shutdown failed"); }
        finally { delivery.shutdownNow(); }
    }
}
