package com.yogimangchi.trading.tradingaccount.service;

import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** One bounded batch per hour, on its own thread; no work on the price/trigger schedulers. */
@Component
public class UnusedGuestCleanupScheduler {
    private static final Logger log = LoggerFactory.getLogger(UnusedGuestCleanupScheduler.class);
    private final UnusedGuestCleanupService cleanup;
    private final boolean enabled;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(task -> {
        var thread = new Thread(task, "unused-guest-cleanup"); thread.setDaemon(true); return thread;
    });
    private boolean started;
    private boolean closed;

    public UnusedGuestCleanupScheduler(UnusedGuestCleanupService cleanup,
            @Value("${trading.guest-cleanup.enabled:true}") boolean enabled) {
        this.cleanup = cleanup; this.enabled = enabled;
    }

    @EventListener(ApplicationReadyEvent.class)
    public synchronized void start() {
        if (!enabled || started || closed) return;
        started = true;
        executor.scheduleWithFixedDelay(this::runBatch, 1, 60, TimeUnit.MINUTES);
    }

    void runBatch() {
        try {
            int deleted = cleanup.cleanupBatch();
            if (deleted > 0) log.info("[Guest cleanup] unused expired accounts removed count={}", deleted);
        } catch (RuntimeException failure) {
            log.warn("[Guest cleanup] batch rolled back; next hourly run will retry cause={}", failure.getClass().getSimpleName());
            log.debug("[Guest cleanup] failure detail", failure);
        }
    }

    @PreDestroy
    public synchronized void close() { closed = true; executor.shutdownNow(); }
}
