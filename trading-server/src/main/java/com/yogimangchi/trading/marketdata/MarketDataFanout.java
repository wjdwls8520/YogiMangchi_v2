package com.yogimangchi.trading.marketdata;

import jakarta.annotation.PreDestroy;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** UI delivery only. Execution workers consume the replay stream instead of this lossy channel. */
@Component
public class MarketDataFanout {
    private static final Logger log = LoggerFactory.getLogger(MarketDataFanout.class);
    private final CopyOnWriteArrayList<Consumer<MarketDataEvent>> listeners = new CopyOnWriteArrayList<>();
    private final Map<String, Boolean> delivered = new LinkedHashMap<>();
    private final ThreadPoolExecutor dispatcher = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(1024), runnable -> {
                Thread thread = new Thread(runnable, "market-data-fanout");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.DiscardOldestPolicy());

    /** A consumer must only enqueue to its bounded client queue; never perform socket or DB I/O here. */
    public AutoCloseable subscribe(Consumer<MarketDataEvent> listener) {
        listeners.add(listener);
        return () -> listeners.remove(listener);
    }

    public synchronized void publish(MarketDataEvent event) {
        if (dispatcher.isShutdown() || delivered.putIfAbsent(event.eventId(), true) != null) {
            return;
        }
        if (delivered.size() > 8192) {
            delivered.remove(delivered.keySet().iterator().next());
        }
        dispatcher.execute(() -> {
            for (Consumer<MarketDataEvent> listener : listeners) {
                try {
                    listener.accept(event);
                } catch (RuntimeException ex) {
                    log.warn("[Market fanout] subscriber failed type={}", ex.getClass().getSimpleName());
                }
            }
        });
    }

    @PreDestroy
    public void close() {
        listeners.clear();
        dispatcher.shutdownNow();
    }
}
