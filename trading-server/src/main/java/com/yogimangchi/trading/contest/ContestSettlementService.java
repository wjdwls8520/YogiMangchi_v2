package com.yogimangchi.trading.contest;

import com.yogimangchi.trading.contest.ContestDtos.ContestSettlementResultResponse;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Orchestrates seasonal contest settlement without holding an outer transaction.
 * Each 500-row batch is committed independently via {@link ContestSettlementChunkExecutor}
 * using {@code Propagation.REQUIRES_NEW} so database locks stay bounded and partial progress is durable.
 */
@Service
public class ContestSettlementService {
    private static final Logger log = LoggerFactory.getLogger(ContestSettlementService.class);
    public static final int CHUNK_SIZE = 500;

    private final JdbcTemplate jdbc;
    private final ContestSettlementChunkExecutor chunkExecutor;
    private final ConcurrentHashMap<Long, AtomicBoolean> activeSeasonLocks = new ConcurrentHashMap<>();

    public ContestSettlementService(JdbcTemplate jdbc, ContestSettlementChunkExecutor chunkExecutor) {
        this.jdbc = jdbc;
        this.chunkExecutor = chunkExecutor;
    }

    public ContestSettlementResultResponse settleSeason(Long seasonId, String triggeredBy, boolean earlyTerminate) {
        return executePipeline(seasonId, triggeredBy, earlyTerminate, CHUNK_SIZE);
    }

    public ContestSettlementResultResponse cleanupRemainingExposure(Long seasonId, String triggeredBy) {
        return executePipeline(seasonId, triggeredBy, true, CHUNK_SIZE);
    }

    public ContestSettlementResultResponse executePipeline(
            Long seasonId,
            String triggeredBy,
            boolean earlyTerminate,
            int chunkSize) {
        if (seasonId == null || seasonId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        int boundedChunkSize = Math.max(1, Math.min(CHUNK_SIZE, chunkSize));
        AtomicBoolean inFlight = activeSeasonLocks.computeIfAbsent(seasonId, k -> new AtomicBoolean(false));
        if (!inFlight.compareAndSet(false, true)) {
            throw new BusinessException(ErrorCode.TRADING_BUSY);
        }

        ContestSettlementChunkExecutor.RunContext run = null;
        try {
            Instant startNow = Instant.now();
            run = chunkExecutor.beginSettlementRun(seasonId, triggeredBy, earlyTerminate, startNow);

            Map<Long, BigDecimal> snapshotPrices = chunkExecutor.captureSnapshotPrices(
                    seasonId, run.runId(), Instant.now());

            int totalCanceledOrders = 0;
            long lastOrderId = 0L;
            while (true) {
                List<Long> orderIds = jdbc.queryForList("""
                        SELECT o.id
                        FROM trading.trading_order o
                        JOIN trading.trading_account a ON a.id = o.account_id
                        WHERE a.contest_season_id = ?
                          AND a.account_type = 'CONTEST'
                          AND o.status = 'PENDING'
                          AND o.id > ?
                        ORDER BY o.id ASC
                        LIMIT ?
                        """, Long.class, seasonId, lastOrderId, boundedChunkSize);
                if (orderIds.isEmpty()) {
                    break;
                }
                totalCanceledOrders += chunkExecutor.cancelPendingOrdersChunk(orderIds, Instant.now());
                lastOrderId = orderIds.get(orderIds.size() - 1);
            }
            chunkExecutor.recordPhaseProgress(run.runId(), "PENDING_ORDERS_CANCELED", totalCanceledOrders, 0);

            int totalLiquidatedPositions = 0;
            long lastPositionId = 0L;
            while (true) {
                List<Long> positionIds = jdbc.queryForList("""
                        SELECT p.id
                        FROM trading.position p
                        JOIN trading.trading_account a ON a.id = p.account_id
                        WHERE a.contest_season_id = ?
                          AND a.account_type = 'CONTEST'
                          AND p.status = 'OPEN'
                          AND p.id > ?
                        ORDER BY p.id ASC
                        LIMIT ?
                        """, Long.class, seasonId, lastPositionId, boundedChunkSize);
                if (positionIds.isEmpty()) {
                    break;
                }
                totalLiquidatedPositions += chunkExecutor.forceLiquidatePositionsChunk(
                        positionIds, snapshotPrices, Instant.now());
                lastPositionId = positionIds.get(positionIds.size() - 1);
            }
            chunkExecutor.recordPhaseProgress(
                    run.runId(), "OPEN_POSITIONS_LIQUIDATED", totalCanceledOrders, totalLiquidatedPositions);

            ContestSettlementResultResponse result = chunkExecutor.finalizeRankingsAndSeason(
                    seasonId,
                    run,
                    triggeredBy,
                    totalCanceledOrders,
                    totalLiquidatedPositions,
                    Instant.now());

            log.info("[Contest settlement] completed seasonId={} runId={} triggeredBy={} canceledOrders={} liquidatedPositions={} participants={}",
                    seasonId, result.runId(), triggeredBy, totalCanceledOrders, totalLiquidatedPositions, result.finalizedParticipantCount());
            return result;
        } catch (RuntimeException ex) {
            if (run != null) {
                try {
                    chunkExecutor.failSettlementRun(run.runId(), ex.getMessage(), Instant.now());
                } catch (RuntimeException ignored) {
                    log.warn("[Contest settlement] failed to record run failure seasonId={} runId={}", seasonId, run.runId(), ignored);
                }
            }
            throw ex;
        } finally {
            inFlight.set(false);
        }
    }
}
