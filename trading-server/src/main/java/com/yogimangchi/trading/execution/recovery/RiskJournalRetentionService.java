package com.yogimangchi.trading.execution.recovery;

import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Objects;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Bounded retention purge for terminal durable risk work ({@code DONE}, {@code RETIRED}) and
 * unreferenced price journal events. Financial ledger records, active/historical risk holds,
 * current price heads, and unresolved risk work are never modified or deleted.
 */
@Service
@ConditionalOnProperty(name = "trading.risk-journal.enabled", havingValue = "true", matchIfMissing = true)
public class RiskJournalRetentionService {
    private static final Logger log = LoggerFactory.getLogger(RiskJournalRetentionService.class);
    private static final int MIN_BATCH_SIZE = 1;
    private static final int MAX_BATCH_SIZE = 5000;
    public static final Duration NOTIFICATION_RETENTION = Duration.ofDays(90);
    public static final Duration IDEMPOTENCY_COMMAND_RETENTION = Duration.ofDays(30);

    public record RetentionPurgeResult(int purgedAttempts, int purgedWorks, int purgedEvents) { }

    public record AuxiliaryPurgeResult(
            int purgedNotifications,
            int purgedIdempotentCommands,
            int purgedStopLossCommands,
            int purgedTakeProfitCommands) { }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final boolean enabled;
    private final Duration retentionDuration;
    private final int batchSize;
    private final long intervalMs;
    private final long initialDelayMs;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(task -> {
        var thread = new Thread(task, "risk-journal-retention");
        thread.setDaemon(true);
        return thread;
    });
    private boolean started;
    private volatile boolean closed;

    @Autowired
    public RiskJournalRetentionService(
            JdbcTemplate jdbc,
            PlatformTransactionManager transactions,
            @Value("${trading.risk.retention.enabled:true}") boolean enabled,
            @Value("${trading.risk.retention.duration:PT72H}") Duration retentionDuration,
            @Value("${trading.risk.retention.batch-size:500}") int batchSize,
            @Value("${trading.risk.retention.interval-ms:3600000}") long intervalMs,
            @Value("${trading.risk.retention.initial-delay-ms:120000}") long initialDelayMs) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
        this.tx = new TransactionTemplate(Objects.requireNonNull(transactions, "transactions"));
        this.tx.setTimeout(10);
        this.enabled = enabled;
        this.retentionDuration = Objects.requireNonNull(retentionDuration, "retentionDuration").isNegative()
                ? Duration.ZERO : retentionDuration;
        this.batchSize = Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, batchSize));
        this.intervalMs = Math.max(1000L, intervalMs);
        this.initialDelayMs = Math.max(0L, initialDelayMs);
    }

    public RiskJournalRetentionService(
            JdbcTemplate jdbc,
            PlatformTransactionManager transactions,
            boolean enabled,
            Duration retentionDuration,
            int batchSize) {
        this(jdbc, transactions, enabled, retentionDuration, batchSize, 3_600_000L, 120_000L);
    }

    @EventListener(ApplicationReadyEvent.class)
    public synchronized void start() {
        if (!enabled || started || closed) return;
        started = true;
        executor.scheduleWithFixedDelay(this::runScheduledPurge, initialDelayMs, intervalMs, TimeUnit.MILLISECONDS);
    }

    @Scheduled(
            fixedDelayString = "${trading.risk.retention.interval-ms:3600000}",
            initialDelayString = "${trading.risk.retention.initial-delay-ms:120000}")
    public void runScheduledPurge() {
        if (!enabled || closed) return;
        try {
            Instant now = Instant.now();
            RetentionPurgeResult result = purgeExpired(now);
            if (result.purgedWorks() > 0 || result.purgedEvents() > 0 || result.purgedAttempts() > 0) {
                log.info("[Risk retention] purgedWorks={} purgedAttempts={} purgedEvents={}",
                        result.purgedWorks(), result.purgedAttempts(), result.purgedEvents());
            }
            AuxiliaryPurgeResult aux = purgeAuxiliaryExpired(now);
            if (aux.purgedNotifications() > 0 || aux.purgedIdempotentCommands() > 0
                    || aux.purgedStopLossCommands() > 0 || aux.purgedTakeProfitCommands() > 0) {
                log.info("[Risk retention] auxiliary purgedNotifications={} purgedIdempotent={} purgedSlCmd={} purgedTpCmd={}",
                        aux.purgedNotifications(), aux.purgedIdempotentCommands(),
                        aux.purgedStopLossCommands(), aux.purgedTakeProfitCommands());
            }
        } catch (RuntimeException failure) {
            log.warn("[Risk retention] purge batch deferred cause={}", failure.getClass().getSimpleName());
        }
    }

    public synchronized RetentionPurgeResult purgeExpired(Instant now) {
        if (closed) return new RetentionPurgeResult(0, 0, 0);
        OffsetDateTime cutoff = Objects.requireNonNull(now, "now").minus(retentionDuration).atOffset(ZoneOffset.UTC);
        RetentionPurgeResult result = tx.execute(status -> {
            jdbc.execute("SET LOCAL lock_timeout='500ms'");
            jdbc.execute("SET LOCAL statement_timeout='5s'");

            long dispatchCursorEventId = Objects.requireNonNullElse(
                    jdbc.queryForObject("SELECT COALESCE((SELECT event_id FROM trading.risk_dispatch_cursor WHERE id = 1), 0)", Long.class),
                    0L);
            long minUnresolvedWorkEventId = Objects.requireNonNullElse(
                    jdbc.queryForObject(
                            "SELECT COALESCE(MIN(event_id), ?) FROM trading.risk_account_work WHERE status IN ('PENDING', 'HELD')",
                            Long.class,
                            Long.MAX_VALUE),
                    Long.MAX_VALUE);

            // Do not pin safeMaxEventId to MIN(risk_price_head.event_id): idle symbols legitimately stop advancing
            // their head while active symbols continue journaling. Head rows are protected individually below.
            long safeMaxEventId = Math.min(dispatchCursorEventId, minUnresolvedWorkEventId);
            if (safeMaxEventId <= 0) {
                return new RetentionPurgeResult(0, 0, 0);
            }

            var expiredWorks = jdbc.queryForList("""
                    SELECT w.account_id, w.event_id
                    FROM trading.risk_account_work w
                    WHERE w.status IN ('DONE', 'RETIRED')
                      AND w.completed_at IS NOT NULL
                      AND w.completed_at < ?
                      AND w.event_id < ?
                      AND NOT EXISTS (
                          SELECT 1 FROM trading.risk_price_head h
                          WHERE h.event_id = w.event_id
                      )
                      AND NOT EXISTS (
                          SELECT 1 FROM trading.risk_hold h
                          WHERE h.account_id = w.account_id AND h.event_id = w.event_id
                      )
                    ORDER BY w.completed_at, w.event_id, w.account_id
                    LIMIT ?
                    FOR UPDATE OF w SKIP LOCKED
                    """, cutoff, safeMaxEventId, batchSize);

            int purgedAttempts = 0;
            int purgedWorks = 0;
            if (!expiredWorks.isEmpty()) {
                Long[] accountIds = new Long[expiredWorks.size()];
                Long[] eventIds = new Long[expiredWorks.size()];
                for (int i = 0; i < expiredWorks.size(); i++) {
                    var row = expiredWorks.get(i);
                    accountIds[i] = ((Number) row.get("account_id")).longValue();
                    eventIds[i] = ((Number) row.get("event_id")).longValue();
                }
                purgedAttempts = jdbc.update("""
                        DELETE FROM trading.risk_work_attempt a
                        USING unnest(?::bigint[], ?::bigint[]) AS t(account_id, event_id)
                        WHERE a.account_id = t.account_id AND a.event_id = t.event_id
                        """, (Object) accountIds, (Object) eventIds);
                purgedWorks = jdbc.update("""
                        DELETE FROM trading.risk_account_work w
                        USING unnest(?::bigint[], ?::bigint[]) AS t(account_id, event_id)
                        WHERE w.account_id = t.account_id
                          AND w.event_id = t.event_id
                          AND w.status IN ('DONE', 'RETIRED')
                        """, (Object) accountIds, (Object) eventIds);
            }

            int purgedEvents = jdbc.update("""
                    DELETE FROM trading.risk_price_event e
                    WHERE e.id IN (
                        SELECT candidate.id
                        FROM trading.risk_price_event candidate
                        WHERE candidate.recorded_at < ?
                          AND candidate.id < ?
                          AND NOT EXISTS (SELECT 1 FROM trading.risk_price_head h WHERE h.event_id = candidate.id)
                          AND NOT EXISTS (SELECT 1 FROM trading.risk_account_work w WHERE w.event_id = candidate.id)
                          AND NOT EXISTS (SELECT 1 FROM trading.risk_hold rh WHERE rh.event_id = candidate.id)
                        ORDER BY candidate.recorded_at, candidate.id
                        LIMIT ?
                    )
                    """, cutoff, safeMaxEventId, batchSize);

            return new RetentionPurgeResult(purgedAttempts, purgedWorks, purgedEvents);
        });
        return Objects.requireNonNullElse(result, new RetentionPurgeResult(0, 0, 0));
    }

    /**
     * Bounded periodic purge for expired non-ledger operational tables:
     * - trading.notification (>90d)
     * - trading.idempotent_command (>30d)
     * - trading.position_stop_loss_command (>30d)
     * - trading.position_take_profit_command (>30d)
     * Core financial ledger tables (trading_order, fill, position, member_trading_round) are never touched.
     */
    public synchronized AuxiliaryPurgeResult purgeAuxiliaryExpired(Instant now) {
        if (closed) {
            return new AuxiliaryPurgeResult(0, 0, 0, 0);
        }
        Instant ref = Objects.requireNonNull(now, "now");
        OffsetDateTime notificationCutoff = ref.minus(NOTIFICATION_RETENTION).atOffset(ZoneOffset.UTC);
        OffsetDateTime commandCutoff = ref.minus(IDEMPOTENCY_COMMAND_RETENTION).atOffset(ZoneOffset.UTC);
        AuxiliaryPurgeResult result = tx.execute(status -> {
            jdbc.execute("SET LOCAL lock_timeout='500ms'");
            jdbc.execute("SET LOCAL statement_timeout='5s'");

            int purgedNotifs = jdbc.update("""
                    DELETE FROM trading.notification n
                    WHERE n.id IN (
                        SELECT id FROM trading.notification
                        WHERE created_at < ?
                        ORDER BY created_at, id
                        LIMIT ?
                    )
                    """, notificationCutoff, batchSize);

            int purgedIdemp = jdbc.update("""
                    DELETE FROM trading.idempotent_command ic
                    WHERE (ic.account_id, ic.request_key) IN (
                        SELECT account_id, request_key FROM trading.idempotent_command
                        WHERE created_at < ?
                        ORDER BY created_at
                        LIMIT ?
                    )
                    """, commandCutoff, batchSize);

            int purgedSlCmd = jdbc.update("""
                    DELETE FROM trading.position_stop_loss_command sc
                    WHERE (sc.account_id, sc.request_key) IN (
                        SELECT account_id, request_key FROM trading.position_stop_loss_command
                        WHERE created_at < ?
                        ORDER BY created_at
                        LIMIT ?
                    )
                    """, commandCutoff, batchSize);

            int purgedTpCmd = jdbc.update("""
                    DELETE FROM trading.position_take_profit_command tc
                    WHERE (tc.account_id, tc.request_key) IN (
                        SELECT account_id, request_key FROM trading.position_take_profit_command
                        WHERE created_at < ?
                        ORDER BY created_at
                        LIMIT ?
                    )
                    """, commandCutoff, batchSize);

            return new AuxiliaryPurgeResult(purgedNotifs, purgedIdemp, purgedSlCmd, purgedTpCmd);
        });
        return Objects.requireNonNullElse(result, new AuxiliaryPurgeResult(0, 0, 0, 0));
    }

    @PreDestroy
    public synchronized void close() {
        closed = true;
        executor.shutdownNow();
    }
}
