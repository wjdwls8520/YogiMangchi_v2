package com.yogimangchi.trading.ops;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.markprice.BinanceMarkPriceClient;
import com.yogimangchi.trading.binance.orderbook.BinanceOrderBookClient;
import com.yogimangchi.trading.execution.recovery.DurableRiskWorker;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.marketdata.overview.MarketOverviewCollector;
import com.yogimangchi.trading.marketdata.websocket.MarketWebSocketHandler;
import com.yogimangchi.trading.notification.TradingNotificationSseService;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import com.yogimangchi.trading.tradingevent.websocket.TradingEventWebSocketHandler;
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryUsage;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.info.BuildProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AdminOpsService {
    private static final Logger log = LoggerFactory.getLogger(AdminOpsService.class);
    private static final int DEFAULT_RECONCILE_SWEEP_LIMIT = 50;
    private static final int MAX_RECONCILE_SWEEP_LIMIT = 200;

    public record EngineStatus(String engineStatus, String marketClockStatus, Long clockSkewMs) { }

    public record Dependencies(String db, String redis, String binanceMarkWs, String binanceOrderBookWs) { }

    public record RiskHoldItem(
            long holdId,
            long accountId,
            Long tradingSymbolId,
            Long eventId,
            String reason,
            Instant heldAt) { }

    public record RiskHoldsSummary(long unresolvedCount, List<RiskHoldItem> items) { }

    public record PendingRiskWorkSummary(long pendingCount, long heldCount) { }

    public record ActiveWebSockets(int market, int trading) { }

    public record RuntimeTelemetry(
            long heapUsedMb,
            long heapMaxMb,
            double heapUsagePercent,
            long uptimeSeconds,
            int activeThreads,
            String buildVersion,
            Instant buildTime) { }

    public record HikariTelemetry(int active, int idle, int total, int max, int pending) { }

    public record RedisTelemetry(String status, Long latencyMs, long gapSequence) { }

    public record BinanceTelemetry(
            String markState,
            long markReconnectCount,
            Long markLastTickAgeMs,
            String markLastDisconnectReason,
            boolean orderBookConnected,
            long orderBookReconnectCount,
            String orderBookLastDisconnectReason) { }

    public record LedgerMismatchItem(long accountId, List<String> failedChecks, Instant checkedAt) { }

    public record SseTelemetry(int tradingNotificationSseCount) { }

    public record MarketOverviewTelemetry(boolean healthy, int staleGroupCount, String lastError) { }

    public record OpsSummaryResponse(
            EngineStatus status,
            Dependencies dependencies,
            DurableRiskWorker.Measurements workerMeasurements,
            RiskHoldsSummary riskHolds,
            PendingRiskWorkSummary pendingRiskWork,
            long ledgerMismatches,
            ActiveWebSockets activeWebSockets,
            List<OpsErrorBuffer.ErrorEntry> recentErrors,
            Instant capturedAt,
            List<OpsErrorBuffer.ErrorEntry> criticalErrors,
            RuntimeTelemetry runtime,
            HikariTelemetry hikari,
            Long dbLatencyMs,
            RedisTelemetry redis,
            BinanceTelemetry binance,
            List<LedgerMismatchItem> ledgerMismatchDetails,
            Instant lastReconciliationAt,
            SseTelemetry sse,
            MarketOverviewTelemetry marketOverview,
            OpsErrorBuffer.ErrorMetrics errorMetrics,
            OpsAlertService.AlertTelemetry alerts) { }

    public record HoldReleaseResult(
            long accountId,
            String reconciliationStatus,
            List<String> failedChecks,
            int releasedCount,
            String resolutionReference,
            Instant checkedAt) {
        public boolean released() {
            return "MATCHED".equals(reconciliationStatus);
        }
    }

    public record ReconcileNowResult(
            int checkedCount,
            int matchedCount,
            int mismatchCount,
            int unverifiedCount,
            int deferredCount,
            List<LedgerMismatchItem> mismatches,
            Instant completedAt) { }

    private final JdbcTemplate jdbc;
    private final TradingEngineGate gate;
    private final LatestPriceStore prices;
    private final ObjectProvider<RedisMarketDataBridge> redisBridge;
    private final ObjectProvider<BinanceMarkPriceClient> markPriceClient;
    private final ObjectProvider<BinanceOrderBookClient> orderBookClient;
    private final ObjectProvider<DurableRiskWorker> riskWorker;
    private final ObjectProvider<MarketWebSocketHandler> marketWs;
    private final ObjectProvider<TradingEventWebSocketHandler> tradingWs;
    private final OpsErrorBuffer errorBuffer;
    private final LedgerReconciler reconciler;
    private final AccountLock locks;
    private final TransactionTemplate tx;
    private final ObjectProvider<OpsAlertService> alertServiceProvider;
    private final ObjectProvider<TradingNotificationSseService> sseServiceProvider;
    private final ObjectProvider<MarketOverviewCollector> overviewCollectorProvider;
    private final ObjectProvider<DataSource> dataSourceProvider;
    private final ObjectProvider<BuildProperties> buildPropertiesProvider;
    private final ObjectProvider<AdminAuditLogService> auditLogProvider;
    private final ObjectMapper json;

    public AdminOpsService(
            JdbcTemplate jdbc,
            TradingEngineGate gate,
            LatestPriceStore prices,
            ObjectProvider<RedisMarketDataBridge> redisBridge,
            ObjectProvider<BinanceMarkPriceClient> markPriceClient,
            ObjectProvider<BinanceOrderBookClient> orderBookClient,
            ObjectProvider<DurableRiskWorker> riskWorker,
            ObjectProvider<MarketWebSocketHandler> marketWs,
            ObjectProvider<TradingEventWebSocketHandler> tradingWs,
            OpsErrorBuffer errorBuffer,
            LedgerReconciler reconciler,
            AccountLock locks,
            PlatformTransactionManager txManager) {
        this(jdbc, gate, prices, redisBridge, markPriceClient, orderBookClient, riskWorker, marketWs, tradingWs,
                errorBuffer, reconciler, locks, txManager, null, null, null, null, null, null, new ObjectMapper());
    }

    @Autowired
    public AdminOpsService(
            JdbcTemplate jdbc,
            TradingEngineGate gate,
            LatestPriceStore prices,
            ObjectProvider<RedisMarketDataBridge> redisBridge,
            ObjectProvider<BinanceMarkPriceClient> markPriceClient,
            ObjectProvider<BinanceOrderBookClient> orderBookClient,
            ObjectProvider<DurableRiskWorker> riskWorker,
            ObjectProvider<MarketWebSocketHandler> marketWs,
            ObjectProvider<TradingEventWebSocketHandler> tradingWs,
            OpsErrorBuffer errorBuffer,
            LedgerReconciler reconciler,
            AccountLock locks,
            PlatformTransactionManager txManager,
            ObjectProvider<OpsAlertService> alertServiceProvider,
            ObjectProvider<TradingNotificationSseService> sseServiceProvider,
            ObjectProvider<MarketOverviewCollector> overviewCollectorProvider,
            ObjectProvider<DataSource> dataSourceProvider,
            ObjectProvider<BuildProperties> buildPropertiesProvider,
            ObjectProvider<AdminAuditLogService> auditLogProvider,
            ObjectMapper json) {
        this.jdbc = jdbc;
        this.gate = gate;
        this.prices = prices;
        this.redisBridge = redisBridge;
        this.markPriceClient = markPriceClient;
        this.orderBookClient = orderBookClient;
        this.riskWorker = riskWorker;
        this.marketWs = marketWs;
        this.tradingWs = tradingWs;
        this.errorBuffer = errorBuffer;
        this.reconciler = reconciler;
        this.locks = locks;
        this.tx = new TransactionTemplate(txManager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
        this.tx.setTimeout(10);
        this.alertServiceProvider = alertServiceProvider;
        this.sseServiceProvider = sseServiceProvider;
        this.overviewCollectorProvider = overviewCollectorProvider;
        this.dataSourceProvider = dataSourceProvider;
        this.buildPropertiesProvider = buildPropertiesProvider;
        this.auditLogProvider = auditLogProvider;
        this.json = json != null ? json : new ObjectMapper();
    }

    public OpsSummaryResponse summary() {
        var clock = prices.marketClockSnapshot();
        EngineStatus engineStatus = new EngineStatus(gate.status(), clock.status().name(), clock.skewMs());

        DbProbe dbProbe = probeDb();
        String dbStatus = dbProbe.status();
        Long dbLatencyMs = dbProbe.latencyMs();

        RedisMarketDataBridge bridge = redisBridge != null ? redisBridge.getIfAvailable() : null;
        String redisStatus = bridge == null ? "UNAVAILABLE" : bridge.health().state().name();
        Long redisLatencyMs = bridge != null ? bridge.pingLatencyMs() : null;
        long redisGapSequence = bridge != null ? bridge.health().gapSequence() : 0L;

        BinanceMarkPriceClient markClient = markPriceClient != null ? markPriceClient.getIfAvailable() : null;
        String markWsStatus = markClient == null ? "DISABLED" : markClient.connectionStatus();
        BinanceOrderBookClient bookClient = orderBookClient != null ? orderBookClient.getIfAvailable() : null;
        String bookWsStatus = bookClient == null ? "DISABLED" : bookClient.connectionStatus();

        BinanceTelemetry binance = new BinanceTelemetry(
                markWsStatus,
                markClient != null ? markClient.reconnectCount() : 0L,
                markClient != null ? markClient.lastTickAgeMs() : null,
                markClient != null ? markClient.lastDisconnectReason() : null,
                bookClient != null && "CONNECTED".equals(bookWsStatus),
                bookClient != null ? bookClient.reconnectCount() : 0L,
                bookClient != null ? bookClient.lastDisconnectReason() : null);

        DurableRiskWorker worker = riskWorker != null ? riskWorker.getIfAvailable() : null;
        DurableRiskWorker.Measurements measurements = worker != null ? worker.measurements() : null;

        long unresolvedHolds = 0L;
        List<RiskHoldItem> topHolds = List.of();
        long pendingWork = 0L;
        long heldWork = 0L;
        long ledgerMismatches = 0L;
        List<LedgerMismatchItem> mismatchDetails = List.of();
        Instant lastReconciliationAt = null;

        if ("UP".equals(dbStatus)) {
            try {
                Long holdsCount = jdbc.queryForObject(
                        "SELECT COUNT(*) FROM trading.risk_hold WHERE resolved_at IS NULL",
                        Long.class);
                unresolvedHolds = holdsCount == null ? 0L : holdsCount;
                topHolds = jdbc.query("""
                        SELECT id, account_id, trading_symbol_id, event_id, reason, held_at
                        FROM trading.risk_hold
                        WHERE resolved_at IS NULL
                        ORDER BY held_at DESC, id DESC
                        LIMIT 20
                        """, (rs, n) -> {
                    Timestamp heldTs = rs.getTimestamp("held_at");
                    return new RiskHoldItem(
                            rs.getLong("id"),
                            rs.getLong("account_id"),
                            rs.getObject("trading_symbol_id", Long.class),
                            rs.getObject("event_id", Long.class),
                            rs.getString("reason"),
                            heldTs != null ? heldTs.toInstant() : null);
                });

                var workRow = jdbc.queryForMap("""
                        SELECT COUNT(*) FILTER (WHERE status = 'PENDING') AS pending_count,
                               COUNT(*) FILTER (WHERE status = 'HELD') AS held_count
                        FROM trading.risk_account_work
                        WHERE status IN ('PENDING', 'HELD')
                        """);
                pendingWork = workRow.get("pending_count") == null ? 0L : ((Number) workRow.get("pending_count")).longValue();
                heldWork = workRow.get("held_count") == null ? 0L : ((Number) workRow.get("held_count")).longValue();

                Long mismatches = jdbc.queryForObject(
                        "SELECT COUNT(*) FROM trading.ledger_reconciliation WHERE status = 'MISMATCH'",
                        Long.class);
                ledgerMismatches = mismatches == null ? 0L : mismatches;
                mismatchDetails = queryLedgerMismatchDetails();

                Timestamp lastReconTs = jdbc.queryForObject(
                        "SELECT MAX(checked_at) FROM trading.ledger_reconciliation",
                        Timestamp.class);
                lastReconciliationAt = lastReconTs != null ? lastReconTs.toInstant() : null;
            } catch (RuntimeException ex) {
                log.warn("[AdminOps] database diagnostics query failed mid-summary cause={}", ex.getClass().getSimpleName());
                dbStatus = "DOWN";
                dbLatencyMs = null;
            }
        }

        Dependencies dependencies = new Dependencies(dbStatus, redisStatus, markWsStatus, bookWsStatus);

        MarketWebSocketHandler marketHandler = marketWs != null ? marketWs.getIfAvailable() : null;
        TradingEventWebSocketHandler tradingHandler = tradingWs != null ? tradingWs.getIfAvailable() : null;
        ActiveWebSockets activeWs = new ActiveWebSockets(
                marketHandler != null ? marketHandler.connectedClients() : 0,
                tradingHandler != null ? tradingHandler.connectedClients() : 0);

        TradingNotificationSseService sseService = sseServiceProvider != null ? sseServiceProvider.getIfAvailable() : null;
        SseTelemetry sse = new SseTelemetry(sseService != null ? sseService.activeConnectionCount() : 0);

        MarketOverviewCollector overviewCollector = overviewCollectorProvider != null ? overviewCollectorProvider.getIfAvailable() : null;
        MarketOverviewTelemetry marketOverview;
        if (overviewCollector == null) {
            marketOverview = new MarketOverviewTelemetry(false, 0, "DISABLED");
        } else {
            var health = overviewCollector.health();
            marketOverview = new MarketOverviewTelemetry(health.healthy(), health.staleGroupCount(), health.lastError());
        }

        OpsAlertService alertService = alertServiceProvider != null ? alertServiceProvider.getIfAvailable() : null;
        OpsAlertService.AlertTelemetry alertTelemetry = alertService != null
                ? alertService.telemetry()
                : new OpsAlertService.AlertTelemetry(false, null, "DISABLED", List.of());

        return new OpsSummaryResponse(
                engineStatus,
                dependencies,
                measurements,
                new RiskHoldsSummary(unresolvedHolds, topHolds),
                new PendingRiskWorkSummary(pendingWork, heldWork),
                ledgerMismatches,
                activeWs,
                errorBuffer.recent(),
                Instant.now(),
                errorBuffer.recentCritical(),
                collectRuntimeTelemetry(),
                collectHikariTelemetry(),
                dbLatencyMs,
                new RedisTelemetry(redisStatus, redisLatencyMs, redisGapSequence),
                binance,
                mismatchDetails,
                lastReconciliationAt,
                sse,
                marketOverview,
                errorBuffer.metrics(),
                alertTelemetry);
    }

    public OpsAlertService.TestAlertResponse dispatchTestAlert(Long adminMemberId) {
        OpsAlertService alertService = alertServiceProvider != null ? alertServiceProvider.getIfAvailable() : null;
        OpsAlertService.TestAlertResponse response = alertService != null
                ? alertService.sendTestAlert(adminMemberId)
                : new OpsAlertService.TestAlertResponse(false, false, false, 0, "NONE", "DISABLED",
                        "OpsAlertService unavailable", Instant.now());
        recordAuditSafe(adminMemberId, "OPS_TEST_ALERT", "OPS_ALERT", "WEBHOOK",
                "enabled=" + response.enabled() + " dispatched=" + response.dispatched()
                        + " success=" + response.success() + " status=" + response.status());
        return response;
    }

    public ReconcileNowResult reconcileNow(Long adminMemberId, Long accountId, Integer limit) {
        List<Long> targetAccountIds;
        if (accountId != null && accountId > 0) {
            targetAccountIds = List.of(accountId);
        } else {
            int boundedLimit = limit == null ? DEFAULT_RECONCILE_SWEEP_LIMIT
                    : Math.max(1, Math.min(MAX_RECONCILE_SWEEP_LIMIT, limit));
            targetAccountIds = jdbc.queryForList("""
                    SELECT a.id
                    FROM trading.trading_account a
                    LEFT JOIN trading.ledger_reconciliation lr ON lr.account_id = a.id
                    ORDER BY CASE WHEN lr.status = 'MISMATCH' THEN 0 ELSE 1 END,
                             lr.checked_at ASC NULLS FIRST,
                             a.id ASC
                    LIMIT ?
                    """, Long.class, boundedLimit);
        }

        int checked = 0;
        int matched = 0;
        int mismatch = 0;
        int unverified = 0;
        int deferred = 0;
        for (Long id : targetAccountIds) {
            try {
                LedgerReconciler.Result result = reconciler.reconcile(id);
                checked++;
                switch (result.status()) {
                    case "MATCHED" -> matched++;
                    case "MISMATCH" -> mismatch++;
                    default -> unverified++;
                }
            } catch (RuntimeException ex) {
                deferred++;
                log.warn("[AdminOps] on-demand reconcile deferred accountId={} cause={}", id, ex.getClass().getSimpleName());
            }
        }
        List<LedgerMismatchItem> freshMismatches = queryLedgerMismatchDetails();
        recordAuditSafe(adminMemberId, "OPS_RECONCILE_NOW", "LEDGER_RECONCILIATION",
                accountId != null && accountId > 0 ? Long.toString(accountId) : "SWEEP",
                "checked=" + checked + " matched=" + matched + " mismatch=" + mismatch
                        + " unverified=" + unverified + " deferred=" + deferred);
        return new ReconcileNowResult(checked, matched, mismatch, unverified, deferred, freshMismatches, Instant.now());
    }

    public HoldReleaseResult releaseHoldsIfMatched(long accountId, Long adminMemberId, String requestedReference) {
        // Step 1: Run an independent fresh reconciliation first. If MISMATCH, commits evidence/hold and stops.
        LedgerReconciler.Result initial = reconciler.reconcile(accountId);
        if (!"MATCHED".equals(initial.status())) {
            log.warn("[AdminOps] hold release refused accountId={} adminMemberId={} status={} failedChecks={}",
                    accountId, adminMemberId, initial.status(), initial.failedChecks());
            return new HoldReleaseResult(
                    accountId,
                    initial.status(),
                    initial.failedChecks(),
                    0,
                    null,
                    Instant.now());
        }

        String reference = resolveReference(adminMemberId, requestedReference);

        // Step 2: Re-verify under AccountLock in the same commit that clears unresolved holds.
        HoldReleaseResult result = tx.execute(status -> {
            locks.lockIncludingWithdrawn(accountId);
            LedgerReconciler.Result verified = reconciler.checkInTransaction(accountId);
            if (!"MATCHED".equals(verified.status())) {
                log.warn("[AdminOps] hold release refused after lock recheck accountId={} status={} failedChecks={}",
                        accountId, verified.status(), verified.failedChecks());
                return new HoldReleaseResult(
                        accountId,
                        verified.status(),
                        verified.failedChecks(),
                        0,
                        null,
                        Instant.now());
            }

            int releasedCount = jdbc.update("""
                    UPDATE trading.risk_hold
                    SET resolved_at = clock_timestamp(),
                        resolution_reference = ?
                    WHERE account_id = ?
                      AND resolved_at IS NULL
                    """, reference, accountId);

            jdbc.update("""
                    UPDATE trading.risk_account_work
                    SET status = 'PENDING',
                        retry_limit = GREATEST(retry_limit, attempts + 3),
                        next_attempt_at = clock_timestamp()
                    WHERE account_id = ?
                      AND status = 'HELD'
                    """, accountId);

            AdminAuditLogService audit = auditLogProvider != null ? auditLogProvider.getIfAvailable() : null;
            if (audit != null) {
                audit.record(adminMemberId, "RISK_HOLD_RELEASE", "TRADING_ACCOUNT",
                        Long.toString(accountId),
                        "releasedCount=" + releasedCount + " reference=" + reference);
            }

            log.info("[AdminOps] released holds accountId={} adminMemberId={} releasedCount={} reference={}",
                    accountId, adminMemberId, releasedCount, reference);
            return new HoldReleaseResult(
                    accountId,
                    verified.status(),
                    verified.failedChecks(),
                    releasedCount,
                    reference,
                    Instant.now());
        });
        return result;
    }

    private List<LedgerMismatchItem> queryLedgerMismatchDetails() {
        return jdbc.query("""
                SELECT account_id, failed_checks::text AS failed_checks_json, checked_at
                FROM trading.ledger_reconciliation
                WHERE status = 'MISMATCH'
                ORDER BY checked_at DESC, account_id ASC
                LIMIT 20
                """, (rs, n) -> {
            Timestamp checkedTs = rs.getTimestamp("checked_at");
            return new LedgerMismatchItem(
                    rs.getLong("account_id"),
                    parseFailedChecks(rs.getString("failed_checks_json")),
                    checkedTs != null ? checkedTs.toInstant() : null);
        });
    }

    private List<String> parseFailedChecks(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return List.of();
        }
        try {
            List<String> parsed = json.readValue(rawJson, new TypeReference<List<String>>() { });
            return parsed == null ? List.of() : List.copyOf(parsed);
        } catch (Exception ex) {
            return List.of();
        }
    }

    private record DbProbe(String status, Long latencyMs) { }

    private DbProbe probeDb() {
        long start = System.nanoTime();
        try {
            Integer one = jdbc.queryForObject("SELECT 1", Integer.class);
            long latencyMs = TimeUnit.NANOSECONDS.toMillis(Math.max(0L, System.nanoTime() - start));
            return Integer.valueOf(1).equals(one) ? new DbProbe("UP", latencyMs) : new DbProbe("DOWN", null);
        } catch (RuntimeException ex) {
            log.warn("[AdminOps] database health probe failed cause={}", ex.getClass().getSimpleName());
            return new DbProbe("DOWN", null);
        }
    }

    private RuntimeTelemetry collectRuntimeTelemetry() {
        MemoryUsage heap = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
        long usedBytes = Math.max(0L, heap.getUsed());
        long maxBytes = heap.getMax() > 0 ? heap.getMax() : Runtime.getRuntime().maxMemory();
        long usedMb = usedBytes / (1024L * 1024L);
        long maxMb = maxBytes > 0 ? maxBytes / (1024L * 1024L) : 0L;
        double usagePct = maxBytes > 0 ? Math.round((usedBytes * 1000.0) / maxBytes) / 10.0 : 0.0;
        long uptimeSeconds = ManagementFactory.getRuntimeMXBean().getUptime() / 1000L;
        int activeThreads = ManagementFactory.getThreadMXBean().getThreadCount();
        BuildProperties build = buildPropertiesProvider != null ? buildPropertiesProvider.getIfAvailable() : null;
        return new RuntimeTelemetry(
                usedMb,
                maxMb,
                usagePct,
                uptimeSeconds,
                activeThreads,
                build != null ? build.getVersion() : null,
                build != null ? build.getTime() : null);
    }

    private HikariTelemetry collectHikariTelemetry() {
        DataSource dataSource = dataSourceProvider != null ? dataSourceProvider.getIfAvailable() : null;
        if (dataSource == null) {
            return new HikariTelemetry(0, 0, 0, 0, 0);
        }
        try {
            HikariDataSource hikari = OpsResourceWatchdog.unwrapHikari(dataSource);
            if (hikari == null) {
                return new HikariTelemetry(0, 0, 0, 0, 0);
            }
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();
            if (pool == null) {
                return new HikariTelemetry(0, 0, 0, hikari.getMaximumPoolSize(), 0);
            }
            return new HikariTelemetry(
                    pool.getActiveConnections(),
                    pool.getIdleConnections(),
                    pool.getTotalConnections(),
                    hikari.getMaximumPoolSize(),
                    pool.getThreadsAwaitingConnection());
        } catch (RuntimeException ex) {
            return new HikariTelemetry(0, 0, 0, 0, 0);
        }
    }

    private void recordAuditSafe(Long adminMemberId, String action, String targetType, String targetId, String detail) {
        AdminAuditLogService audit = auditLogProvider != null ? auditLogProvider.getIfAvailable() : null;
        if (audit == null) {
            return;
        }
        try {
            audit.record(adminMemberId, action, targetType, targetId, detail);
        } catch (RuntimeException ex) {
            log.warn("[AdminOps] audit log write skipped action={} cause={}", action, ex.getClass().getSimpleName());
        }
    }

    private static String resolveReference(Long adminMemberId, String requestedReference) {
        if (requestedReference != null) {
            String cleaned = requestedReference.replaceAll("[\\p{Cntrl}]", " ").strip();
            if (cleaned.length() >= 8) {
                return cleaned.length() > 450 ? cleaned.substring(0, 450) : cleaned;
            }
        }
        return "ADMIN_OPS_RELEASE:member=" + (adminMemberId != null ? adminMemberId : 0L) + ":ledger=MATCHED";
    }
}
