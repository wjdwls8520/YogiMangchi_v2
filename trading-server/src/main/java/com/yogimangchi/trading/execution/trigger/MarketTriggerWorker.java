package com.yogimangchi.trading.execution.trigger;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.*;
import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Single ordered reader with a durable PostgreSQL checkpoint. Pub/Sub is never an execution queue. */
@Component
public class MarketTriggerWorker {
    private static final Logger log = LoggerFactory.getLogger(MarketTriggerWorker.class);
    private static final DefaultRedisScript<List> READ = new DefaultRedisScript<>("""
            if ARGV[1] ~= '0-0' and #redis.call('XRANGE',KEYS[1],ARGV[1],ARGV[1],'COUNT',1)==0 then
                return {'GAP'}
            end
            local entries=redis.call('XRANGE',KEYS[1],'('..ARGV[1],'+','COUNT',64)
            local result={}
            for _,entry in ipairs(entries) do
                local payload=''
                for i=1,#entry[2],2 do if entry[2][i]=='payload' then payload=entry[2][i+1] end end
                table.insert(result,entry[1]); table.insert(result,payload)
            end
            return result
            """, List.class);
    private final StringRedisTemplate redis;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final RedisMarketDataBridge bridge;
    private final TradingEngineGate gate;
    private final TriggerCandidates candidates;
    private final AccountTriggerService processor;
    private final boolean enabled;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "trading-price-trigger"); thread.setDaemon(true); return thread;
    });
    private Map<Long, LatestMarkPrice> book = new HashMap<>();
    private String cursor;
    private long observedGap = -1;
    private int failures;
    private boolean staleReplayReported;
    private long retryAfter;
    private volatile boolean closed;

    public MarketTriggerWorker(StringRedisTemplate redis, JdbcTemplate jdbc, ObjectMapper json, RedisMarketDataBridge bridge,
            TradingEngineGate gate, TriggerCandidates candidates, AccountTriggerService processor,
            @Value("${trading.trigger.enabled:true}") boolean enabled) {
        this.redis=redis; this.jdbc=jdbc; this.json=json; this.bridge=bridge; this.gate=gate;
        this.candidates=candidates; this.processor=processor; this.enabled=enabled;
    }
    @EventListener(ApplicationReadyEvent.class)
    public void start() { if (enabled) executor.scheduleWithFixedDelay(this::pump, 0, 50, TimeUnit.MILLISECONDS); }

    private void pump() {
        if (System.nanoTime() < retryAfter) return;
        try { runOnce(); failures=0; }
        catch (Exception exception) {
            gate.recovering();
            failures = Math.min(6, failures+1);
            int seconds = Math.min(30, 1 << (failures-1));
            retryAfter = System.nanoTime()+TimeUnit.SECONDS.toNanos(seconds);
            log.warn("[Trading trigger] processing failed cursor={} retrySeconds={} cause={}", cursor, seconds,
                    exception.getClass().getSimpleName());
            log.debug("[Trading trigger] failure detail", exception);
        }
    }

    // Package visibility permits deterministic integration tests without a competing scheduler.
    synchronized void runOnce() throws Exception {
        if (closed) return;
        if (bridge.health().state() != RedisMarketDataBridge.State.HEALTHY) { gate.recovering(); return; }
        if (cursor == null) {
            jdbc.query("select stream_id,price_book from trading.market_trigger_cursor where id=1", row -> {
                try {
                    Map<Long, LatestMarkPrice> restored = json.readValue(row.getString(2), new TypeReference<HashMap<Long,LatestMarkPrice>>() { });
                    if (restored == null) throw new IllegalStateException("Missing checkpoint price book");
                    book = restored;
                    cursor = row.getString(1);
                }
                catch (Exception exception) { throw new IllegalStateException("Invalid trigger checkpoint", exception); }
            });
        }
        long gap = bridge.health().gapSequence();
        if (observedGap != gap) {
            gate.recovering();
            if (observedGap >= 0 || gap > 0) {
                book.clear();
                jdbc.update("update trading.market_trigger_cursor set gap_count=gap_count+1 where id=1");
                log.warn("[Trading trigger] producer continuity gap; reconciling PostgreSQL exposure with fresh prices");
            }
            observedGap = gap;
        }
        List<?> values = redis.execute(READ, List.of(RedisMarketDataBridge.STREAM_KEY), cursor);
        if (values == null) throw new IllegalStateException("Missing stream response");
        if (values.size() == 1 && "GAP".equals(values.get(0))) {
            gate.recovering(); book.clear(); cursor="0-0";
            jdbc.update("update trading.market_trigger_cursor set stream_id='0-0',price_book='{}',gap_count=gap_count+1,updated_at=now() where id=1");
            log.warn("[Trading trigger] checkpoint trimmed or stream lost; historical crossings cannot be reconstructed");
            return;
        }
        for (int index=0; index<values.size(); index+=2) {
            if (closed) return;
            try (var ordering = gate.enterPriceEvent()) {
            String id = values.get(index).toString();
            MarketDataEvent event = json.readValue(values.get(index+1).toString(), MarketDataEvent.class);
            Map<Long, LatestMarkPrice> next = new HashMap<>(book);
            if (event.type() != MarketDataEvent.Type.PRICE) {
                event.tradingSymbolIds().forEach(next::remove);
            } else {
                LatestMarkPrice tick = event.price();
                LatestMarkPrice previous = next.get(tick.tradingSymbolId());
                if (previous == null || tick.eventTime().isAfter(previous.eventTime())) {
                    next.put(tick.tradingSymbolId(), tick);
                    if (LatestPriceStore.isFreshAt(tick, Instant.now())) {
                        staleReplayReported = false;
                        long after=0;
                        while (true) {
                            if (closed) return;
                            List<Long> page = candidates.accounts(tick, after);
                            if (page.isEmpty()) break;
                            for (Long accountId : page) {
                                if (closed) return;
                                processor.process(accountId, tick, Map.copyOf(next));
                            }
                            after=page.get(page.size()-1);
                        }
                    } else if (!staleReplayReported) {
                        staleReplayReported = true;
                        jdbc.update("update trading.market_trigger_cursor set gap_count=gap_count+1 where id=1");
                        log.warn("[Trading trigger] replay price expired; no stale execution, awaiting fresh exposure reconciliation");
                    }
                }
            }
            // Financial transactions have all committed. Failure before this write replays the event safely.
            jdbc.update("update trading.market_trigger_cursor set stream_id=?,price_book=?,updated_at=now() where id=1", id, json.writeValueAsString(next));
            book=next; cursor=id;
            }
        }
        if (!closed) gate.processed(book, observedGap);
    }
    @PreDestroy public void close() { closed=true; gate.recovering(); executor.shutdownNow(); }
}
