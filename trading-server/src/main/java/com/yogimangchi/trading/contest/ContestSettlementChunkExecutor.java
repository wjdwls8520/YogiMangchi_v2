package com.yogimangchi.trading.contest;

import com.yogimangchi.trading.contest.ContestDtos.ContestSettlementResultResponse;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.fill.entity.Fill;
import com.yogimangchi.trading.fill.repository.FillRepository;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.repository.TradingOrderRepository;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class ContestSettlementChunkExecutor {
    public static final Duration STALE_RUN_TIMEOUT = Duration.ofMinutes(5);
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private final JdbcTemplate jdbc;
    private final EntityManager entities;
    private final AccountLock locks;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final TradingOrderRepository orders;
    private final FillRepository fills;
    private final LatestPriceStore priceStore;
    private final TradingEvents events;

    public ContestSettlementChunkExecutor(
            JdbcTemplate jdbc,
            EntityManager entities,
            AccountLock locks,
            WalletRepository wallets,
            PositionRepository positions,
            TradingOrderRepository orders,
            FillRepository fills,
            LatestPriceStore priceStore,
            TradingEvents events) {
        this.jdbc = jdbc;
        this.entities = entities;
        this.locks = locks;
        this.wallets = wallets;
        this.positions = positions;
        this.orders = orders;
        this.fills = fills;
        this.priceStore = priceStore;
        this.events = events;
    }

    public record RunContext(Long runId, int attemptNo, Instant startedAt) { }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 15)
    public RunContext beginSettlementRun(Long seasonId, String triggeredBy, boolean earlyTerminate, Instant now) {
        var rows = jdbc.queryForList(
                "SELECT id, contest_end_at, settled_at FROM trading.contest_season WHERE id = ? FOR UPDATE",
                seasonId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.CONTEST_SEASON_NOT_FOUND);
        }
        if (!earlyTerminate && rows.get(0).get("settled_at") != null) {
            throw new BusinessException(ErrorCode.TRADING_BUSY);
        }
        OffsetDateTime tsNow = at(now);
        OffsetDateTime staleThreshold = at(now.minus(STALE_RUN_TIMEOUT));

        jdbc.update("""
                UPDATE trading.contest_settlement_run
                SET status = 'FAILED',
                    failure_reason = 'Stale settlement run timed out (>5m)',
                    completed_at = ?
                WHERE contest_season_id = ?
                  AND status = 'RUNNING'
                  AND started_at < ?
                """, tsNow, seasonId, staleThreshold);

        Boolean hasActiveRun = jdbc.queryForObject("""
                SELECT EXISTS(
                    SELECT 1 FROM trading.contest_settlement_run
                    WHERE contest_season_id = ?
                      AND status = 'RUNNING'
                )
                """, Boolean.class, seasonId);
        if (Boolean.TRUE.equals(hasActiveRun)) {
            throw new BusinessException(ErrorCode.TRADING_BUSY);
        }

        if (earlyTerminate) {
            jdbc.update("""
                    UPDATE trading.contest_season
                    SET contest_end_at = CASE WHEN contest_end_at > ? THEN ? ELSE contest_end_at END,
                        contest_start_at = CASE WHEN contest_start_at > ? THEN ? ELSE contest_start_at END,
                        recruitment_end_at = CASE WHEN recruitment_end_at > ? THEN ? ELSE recruitment_end_at END,
                        recruitment_start_at = CASE WHEN recruitment_start_at > ? THEN ? ELSE recruitment_start_at END,
                        updated_at = ?
                    WHERE id = ?
                    """, tsNow, tsNow, tsNow, tsNow, tsNow, tsNow, tsNow, tsNow, tsNow, seasonId);
        }
        Integer maxAttempt = jdbc.queryForObject(
                "SELECT COALESCE(MAX(attempt_no), 0) FROM trading.contest_settlement_run WHERE contest_season_id = ?",
                Integer.class, seasonId);
        int attemptNo = (maxAttempt == null ? 0 : maxAttempt) + 1;
        Long runId = jdbc.queryForObject("""
                INSERT INTO trading.contest_settlement_run (
                    contest_season_id, attempt_no, triggered_by, status, last_completed_phase, started_at
                ) VALUES (?, ?, ?, 'RUNNING', 'STARTED', ?)
                RETURNING id
                """, Long.class, seasonId, attemptNo, triggeredBy, tsNow);
        return new RunContext(runId, attemptNo, now);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 15)
    public Map<Long, BigDecimal> captureSnapshotPrices(Long seasonId, Long runId, Instant now) {
        OffsetDateTime tsNow = at(now);
        var symbolRows = jdbc.queryForList("""
                SELECT p.trading_symbol_id, MAX(p.entry_price) AS fallback_price
                FROM trading.position p
                JOIN trading.trading_account a ON a.id = p.account_id
                WHERE a.contest_season_id = ?
                  AND a.account_type = 'CONTEST'
                  AND p.status = 'OPEN'
                GROUP BY p.trading_symbol_id
                """, seasonId);

        for (var row : symbolRows) {
            long symbolId = ((Number) row.get("trading_symbol_id")).longValue();
            BigDecimal fallbackPrice = (BigDecimal) row.get("fallback_price");
            BigDecimal livePrice = priceStore.find(symbolId)
                    .latestPrice()
                    .map(p -> p.domainMarkPrice())
                    .filter(p -> p != null && p.signum() > 0)
                    .orElse(fallbackPrice);
            BigDecimal settlementPrice = TradingMath.amount(livePrice);
            jdbc.update("""
                    INSERT INTO trading.contest_settlement_price_snapshot (
                        contest_season_id, trading_symbol_id, settlement_price, captured_at
                    ) VALUES (?, ?, ?, ?)
                    ON CONFLICT (contest_season_id, trading_symbol_id)
                    DO UPDATE SET settlement_price = EXCLUDED.settlement_price, captured_at = EXCLUDED.captured_at
                    """, seasonId, symbolId, settlementPrice, tsNow);
        }

        Map<Long, BigDecimal> snapshots = new HashMap<>();
        jdbc.query("""
                SELECT trading_symbol_id, settlement_price
                FROM trading.contest_settlement_price_snapshot
                WHERE contest_season_id = ?
                """,
                (org.springframework.jdbc.core.RowCallbackHandler) r ->
                        snapshots.put(r.getLong("trading_symbol_id"), r.getBigDecimal("settlement_price")),
                seasonId);

        jdbc.update("UPDATE trading.contest_settlement_run SET last_completed_phase = 'PRICE_SNAPSHOT_CAPTURED' WHERE id = ?", runId);
        return snapshots;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 30)
    public int cancelPendingOrdersChunk(List<Long> orderIds, Instant now) {
        if (orderIds == null || orderIds.isEmpty()) {
            return 0;
        }
        String placeholders = String.join(",", Collections.nCopies(orderIds.size(), "?"));
        List<Long> accountIds = jdbc.queryForList(
                "SELECT DISTINCT account_id FROM trading.trading_order WHERE id IN (" + placeholders + ") ORDER BY account_id ASC",
                Long.class,
                orderIds.toArray());

        Map<Long, TradingAccount> lockedAccounts = new HashMap<>();
        for (Long accountId : new TreeSet<>(accountIds)) {
            lockedAccounts.put(accountId, locks.lockIncludingWithdrawn(accountId));
        }

        int canceledCount = 0;
        Instant tickNow = now.truncatedTo(ChronoUnit.MICROS);
        for (Long orderId : orderIds) {
            TradingOrder order = entities.find(TradingOrder.class, orderId);
            if (order == null || order.getStatus() != TradingOrder.Status.PENDING) {
                continue;
            }
            Instant effectiveNow = tickNow.isBefore(order.getCreatedAt()) ? order.getCreatedAt() : tickNow;
            Wallet wallet = wallets.findById(order.getAccountId()).orElseThrow();
            if (order.getAction() == TradingOrder.Action.OPEN) {
                if (order.getReservedMargin().signum() > 0) {
                    wallet.releaseReservation(order.getReservedMargin());
                }
            } else if (order.getAction() == TradingOrder.Action.CLOSE && order.getPositionId() != null) {
                Position pos = entities.find(Position.class, order.getPositionId());
                if (pos != null && pos.getStatus() == Position.Status.OPEN
                        && pos.getReservedCloseQuantity().compareTo(order.getQuantity()) >= 0) {
                    pos.releaseCloseReservation(order.getQuantity());
                }
            }
            order.cancelForContestSettlement(effectiveNow);
            events.record(order, null);
            TradingAccount account = lockedAccounts.get(order.getAccountId());
            if (account != null && !effectiveNow.isBefore(account.getLastFinancialChangeAt())) {
                account.recordFinancialChange(effectiveNow);
            }
            canceledCount++;
        }
        entities.flush();
        return canceledCount;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 30)
    public int forceLiquidatePositionsChunk(List<Long> positionIds, Map<Long, BigDecimal> snapshotPrices, Instant now) {
        if (positionIds == null || positionIds.isEmpty()) {
            return 0;
        }
        String placeholders = String.join(",", Collections.nCopies(positionIds.size(), "?"));
        List<Long> accountIds = jdbc.queryForList(
                "SELECT DISTINCT account_id FROM trading.position WHERE id IN (" + placeholders + ") ORDER BY account_id ASC",
                Long.class,
                positionIds.toArray());

        Map<Long, TradingAccount> lockedAccounts = new HashMap<>();
        for (Long accountId : new TreeSet<>(accountIds)) {
            lockedAccounts.put(accountId, locks.lockIncludingWithdrawn(accountId));
        }

        int liquidatedCount = 0;
        Instant tickNow = now.truncatedTo(ChronoUnit.MICROS);
        for (Long positionId : positionIds) {
            Position position = entities.find(Position.class, positionId);
            if (position == null || position.getStatus() != Position.Status.OPEN) {
                continue;
            }
            Instant effectiveNow = tickNow.isBefore(position.getOpenedAt()) ? position.getOpenedAt() : tickNow;
            if (position.getReservedCloseQuantity().signum() > 0) {
                for (TradingOrder pending : orders.findByAccountIdAndStatusOrderByIdAsc(position.getAccountId(), TradingOrder.Status.PENDING)) {
                    if (pending.getAction() == TradingOrder.Action.CLOSE && position.getId().equals(pending.getPositionId())) {
                        Instant orderNow = effectiveNow.isBefore(pending.getCreatedAt()) ? pending.getCreatedAt() : effectiveNow;
                        position.releaseCloseReservation(pending.getQuantity());
                        pending.cancelForContestSettlement(orderNow);
                        events.record(pending, null);
                    }
                }
                if (position.getReservedCloseQuantity().signum() > 0) {
                    position.releaseCloseReservation(position.getReservedCloseQuantity());
                }
            }

            BigDecimal markPrice = snapshotPrices.getOrDefault(position.getTradingSymbolId(), position.getEntryPrice());
            if (markPrice == null || markPrice.signum() <= 0) {
                markPrice = position.getEntryPrice();
            }
            Position.Settlement settlement = position.closeForContestSettlement(markPrice, effectiveNow);
            Wallet wallet = wallets.findById(position.getAccountId()).orElseThrow();
            BigDecimal shortfall = settlement.releasedMargin().negate()
                    .subtract(settlement.realizedPnl())
                    .max(BigDecimal.ZERO);
            wallet.settle(settlement.releasedMargin(), settlement.realizedPnl(), BigDecimal.ZERO, shortfall);

            TradingOrder liqOrder = orders.save(TradingOrder.contestLiquidation(
                    position, settlement.quantity(), markPrice, effectiveNow));
            Fill fill = fills.save(Fill.execute(
                    liqOrder.getId(),
                    markPrice,
                    settlement.quantity(),
                    effectiveNow,
                    effectiveNow,
                    settlement.realizedPnl(),
                    BigDecimal.ZERO,
                    shortfall));
            events.record(liqOrder, fill);
            events.recordStopLoss(position);

            TradingAccount account = lockedAccounts.get(position.getAccountId());
            if (account != null && !effectiveNow.isBefore(account.getLastFinancialChangeAt())) {
                account.recordFinancialChange(effectiveNow);
            }
            positions.flush();
            liquidatedCount++;
        }
        entities.flush();
        return liquidatedCount;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 15)
    public void recordPhaseProgress(Long runId, String phase, int canceledOrders, int liquidatedPositions) {
        jdbc.update("""
                UPDATE trading.contest_settlement_run
                SET last_completed_phase = ?,
                    canceled_order_count = ?,
                    liquidated_position_count = ?
                WHERE id = ?
                """, phase, canceledOrders, liquidatedPositions, runId);
    }

    private record ParticipantScore(
            long participantId,
            long accountId,
            BigDecimal seedMoney,
            BigDecimal finalBalance,
            BigDecimal finalRealizedPnl,
            BigDecimal finalRoiPct) { }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 30)
    public ContestSettlementResultResponse finalizeRankingsAndSeason(
            Long seasonId,
            RunContext run,
            String triggeredBy,
            int canceledOrderCount,
            int liquidatedPositionCount,
            Instant now) {
        OffsetDateTime tsNow = at(now);

        var rows = jdbc.queryForList("""
                SELECT cp.id, cp.account_id, cp.seed_money, w.balance, w.realized_pnl
                FROM trading.contest_participant cp
                JOIN trading.wallet w ON w.account_id = cp.account_id
                WHERE cp.contest_season_id = ?
                ORDER BY cp.id ASC
                """, seasonId);

        List<ParticipantScore> scores = new ArrayList<>(rows.size());
        for (var row : rows) {
            long participantId = ((Number) row.get("id")).longValue();
            long accountId = ((Number) row.get("account_id")).longValue();
            BigDecimal seedMoney = (BigDecimal) row.get("seed_money");
            BigDecimal balance = (BigDecimal) row.get("balance");
            BigDecimal realizedPnl = (BigDecimal) row.get("realized_pnl");
            BigDecimal roiPct = seedMoney.signum() > 0
                    ? balance.subtract(seedMoney).multiply(HUNDRED).divide(seedMoney, 4, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO.setScale(4, RoundingMode.HALF_UP);
            scores.add(new ParticipantScore(participantId, accountId, seedMoney, balance, realizedPnl, roiPct));
        }

        scores.sort(Comparator
                .comparing(ParticipantScore::finalRoiPct, Comparator.reverseOrder())
                .thenComparing(ParticipantScore::finalRealizedPnl, Comparator.reverseOrder())
                .thenComparingLong(ParticipantScore::participantId));

        int currentRank = 1;
        for (int i = 0; i < scores.size(); i++) {
            ParticipantScore cur = scores.get(i);
            if (i > 0) {
                ParticipantScore prev = scores.get(i - 1);
                if (cur.finalRoiPct().compareTo(prev.finalRoiPct()) != 0
                        || cur.finalRealizedPnl().compareTo(prev.finalRealizedPnl()) != 0) {
                    currentRank = i + 1;
                }
            }
            jdbc.update("""
                    UPDATE trading.contest_participant
                    SET final_balance = ?,
                        final_realized_pnl = ?,
                        final_roi_pct = ?,
                        final_rank = ?,
                        settled_at = COALESCE(settled_at, ?)
                    WHERE id = ?
                    """,
                    cur.finalBalance(),
                    cur.finalRealizedPnl(),
                    cur.finalRoiPct(),
                    currentRank,
                    tsNow,
                    cur.participantId());
        }

        int participantCount = scores.size();
        jdbc.update("""
                UPDATE trading.contest_season
                SET settled_at = COALESCE(settled_at, ?),
                    updated_at = ?
                WHERE id = ?
                """, tsNow, tsNow, seasonId);

        Timestamp settledTs = jdbc.queryForObject(
                "SELECT settled_at FROM trading.contest_season WHERE id = ?",
                Timestamp.class, seasonId);
        Instant settledAt = settledTs != null ? settledTs.toInstant() : now;

        jdbc.update("""
                UPDATE trading.contest_settlement_run
                SET status = 'COMPLETED',
                    last_completed_phase = 'COMPLETED',
                    deactivated_wallet_count = ?,
                    canceled_order_count = ?,
                    liquidated_position_count = ?,
                    finalized_participant_count = ?,
                    completed_at = ?
                WHERE id = ?
                """,
                participantCount,
                canceledOrderCount,
                liquidatedPositionCount,
                participantCount,
                tsNow,
                run.runId());

        return new ContestSettlementResultResponse(
                run.runId(),
                seasonId,
                run.attemptNo(),
                triggeredBy,
                "COMPLETED",
                "COMPLETED",
                participantCount,
                canceledOrderCount,
                liquidatedPositionCount,
                participantCount,
                run.startedAt(),
                now,
                settledAt);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 15)
    public void failSettlementRun(Long runId, String failureReason, Instant now) {
        if (runId == null) return;
        String safeReason = failureReason == null ? "Settlement failed"
                : (failureReason.length() > 950 ? failureReason.substring(0, 950) : failureReason);
        jdbc.update("""
                UPDATE trading.contest_settlement_run
                SET status = 'FAILED',
                    failure_reason = ?,
                    completed_at = ?
                WHERE id = ?
                """, safeReason, at(now), runId);
    }

    private static OffsetDateTime at(Instant value) {
        return value.atOffset(ZoneOffset.UTC);
    }
}
