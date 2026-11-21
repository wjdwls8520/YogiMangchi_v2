package com.yogimangchi.trading.ops;

import com.yogimangchi.trading.binance.markprice.BinanceMarkPriceClient;
import com.yogimangchi.trading.binance.orderbook.BinanceOrderBookClient;
import com.yogimangchi.trading.execution.recovery.DurableRiskWorker;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.marketdata.websocket.MarketWebSocketHandler;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import com.yogimangchi.trading.tradingevent.websocket.TradingEventWebSocketHandler;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AdminOpsService {
    private static final Logger log = LoggerFactory.getLogger(AdminOpsService.class);

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

    public record OpsSummaryResponse(
            EngineStatus status,
            Dependencies dependencies,
            DurableRiskWorker.Measurements workerMeasurements,
            RiskHoldsSummary riskHolds,
            PendingRiskWorkSummary pendingRiskWork,
            long ledgerMismatches,
            ActiveWebSockets activeWebSockets,
            List<OpsErrorBuffer.ErrorEntry> recentErrors,
            Instant capturedAt) { }

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
    }

    public OpsSummaryResponse summary() {
        var clock = prices.marketClockSnapshot();
        EngineStatus engineStatus = new EngineStatus(gate.status(), clock.status().name(), clock.skewMs());

        String dbStatus = checkDb();
        RedisMarketDataBridge bridge = redisBridge.getIfAvailable();
        String redisStatus = bridge == null ? "UNAVAILABLE" : bridge.health().state().name();
        BinanceMarkPriceClient markClient = markPriceClient.getIfAvailable();
        String markWsStatus = markClient == null ? "DISABLED" : markClient.connectionStatus();
        BinanceOrderBookClient bookClient = orderBookClient.getIfAvailable();
        String bookWsStatus = bookClient == null ? "DISABLED" : bookClient.connectionStatus();
        Dependencies dependencies = new Dependencies(dbStatus, redisStatus, markWsStatus, bookWsStatus);

        DurableRiskWorker worker = riskWorker.getIfAvailable();
        DurableRiskWorker.Measurements measurements = worker != null ? worker.measurements() : null;

        long unresolvedHolds = 0L;
        List<RiskHoldItem> topHolds = List.of();
        long pendingWork = 0L;
        long heldWork = 0L;
        long ledgerMismatches = 0L;

        if ("UP".equals(dbStatus)) {
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
        }

        MarketWebSocketHandler marketHandler = marketWs.getIfAvailable();
        TradingEventWebSocketHandler tradingHandler = tradingWs.getIfAvailable();
        ActiveWebSockets activeWs = new ActiveWebSockets(
                marketHandler != null ? marketHandler.connectedClients() : 0,
                tradingHandler != null ? tradingHandler.connectedClients() : 0);

        return new OpsSummaryResponse(
                engineStatus,
                dependencies,
                measurements,
                new RiskHoldsSummary(unresolvedHolds, topHolds),
                new PendingRiskWorkSummary(pendingWork, heldWork),
                ledgerMismatches,
                activeWs,
                errorBuffer.recent(),
                Instant.now());
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
        return tx.execute(status -> {
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
    }

    private String checkDb() {
        try {
            Integer one = jdbc.queryForObject("SELECT 1", Integer.class);
            return Integer.valueOf(1).equals(one) ? "UP" : "DOWN";
        } catch (RuntimeException ex) {
            log.warn("[AdminOps] database health probe failed cause={}", ex.getClass().getSimpleName());
            return "DOWN";
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
