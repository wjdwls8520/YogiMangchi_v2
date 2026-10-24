package com.yogimangchi.trading.reconciliation;

import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Bounded keyset scan. A busy account is revisited on the next cycle. */
@Component
public class LedgerReconciliationWorker {
    private static final Logger log = LoggerFactory.getLogger(LedgerReconciliationWorker.class);
    private final JdbcTemplate jdbc;
    private final LedgerReconciler reconciler;
    private final boolean enabled;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(task -> {
        var thread = new Thread(task, "ledger-reconciliation");
        thread.setDaemon(true);
        return thread;
    });
    private boolean closed;

    public LedgerReconciliationWorker(JdbcTemplate jdbc, LedgerReconciler reconciler,
            @Value("${trading.reconciliation.enabled:true}") boolean enabled) {
        this.jdbc = jdbc;
        this.reconciler = reconciler;
        this.enabled = enabled;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        if(enabled) executor.scheduleWithFixedDelay(this::pump, 60, 60, TimeUnit.SECONDS);
    }

    private void pump() {
        try {
            runBatch();
        } catch(Exception failure) {
            log.warn("[Ledger check] scan unavailable cause={}", failure.getClass().getSimpleName());
        }
    }

    public synchronized int runBatch() {
        if(closed) return 0;
        long after = jdbc.queryForObject("select last_account_id from trading.ledger_reconciliation_cursor where id=1", Long.class);
        var ids = jdbc.queryForList("select id from trading.trading_account where id>? order by id limit 25", Long.class, after);
        for(long id : ids) {
            try {
                reconciler.check(id);
            } catch(Exception failure) {
                log.warn("[Ledger check] account={} deferred cause={}", id, failure.getClass().getSimpleName());
            }
            jdbc.update("update trading.ledger_reconciliation_cursor set last_account_id=? where id=1", id);
        }
        if(ids.isEmpty()) jdbc.update("update trading.ledger_reconciliation_cursor set last_account_id=0 where id=1");
        return ids.size();
    }

    @PreDestroy
    public synchronized void close() {
        closed = true;
        executor.shutdownNow();
    }
}
