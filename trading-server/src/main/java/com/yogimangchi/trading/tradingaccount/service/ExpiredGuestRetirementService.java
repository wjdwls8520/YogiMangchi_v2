package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.execution.recovery.RiskAdmission;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.repository.TradingOrderRepository;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.takeprofit.TakeProfitService;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import jakarta.annotation.PreDestroy;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Administratively retires expired *used* Guest accounts so stale open positions, pending orders,
 * and risk work never accumulate or pollute DurableRiskWorker indefinitely.
 * Untouched expired guests remain eligible for UnusedGuestCleanupService after its 7-day grace period.
 * Financial history (fills, closed positions, orders) is preserved without fake market fills.
 */
@Service
public class ExpiredGuestRetirementService {
    private static final Logger log = LoggerFactory.getLogger(ExpiredGuestRetirementService.class);
    public static final int BATCH_SIZE = 50;

    private final JdbcTemplate jdbc;
    private final EntityManager entities;
    private final AccountLock locks;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final TradingOrderRepository orders;
    private final TradingEvents events;
    private final RiskAdmission risk;
    private final ObjectProvider<TakeProfitService> takeProfits;
    private final TransactionTemplate requiresNewTx;
    private final boolean enabled;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(task -> {
        var thread = new Thread(task, "expired-guest-retirement");
        thread.setDaemon(true);
        return thread;
    });
    private boolean started;
    private volatile boolean closed;

    @Autowired
    public ExpiredGuestRetirementService(
            JdbcTemplate jdbc,
            EntityManager entities,
            AccountLock locks,
            WalletRepository wallets,
            PositionRepository positions,
            TradingOrderRepository orders,
            TradingEvents events,
            RiskAdmission risk,
            ObjectProvider<TakeProfitService> takeProfits,
            PlatformTransactionManager txManager,
            @Value("${trading.guest-cleanup.enabled:true}") boolean enabled) {
        this.jdbc = jdbc;
        this.entities = entities;
        this.locks = locks;
        this.wallets = wallets;
        this.positions = positions;
        this.orders = orders;
        this.events = events;
        this.risk = risk;
        this.takeProfits = takeProfits;
        this.requiresNewTx = new TransactionTemplate(txManager);
        this.requiresNewTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.requiresNewTx.setTimeout(10);
        this.enabled = enabled;
    }

    @EventListener(ApplicationReadyEvent.class)
    public synchronized void start() {
        if (!enabled || started || closed) {
            return;
        }
        started = true;
        executor.scheduleWithFixedDelay(this::runScheduledBatch, 2, 15, TimeUnit.MINUTES);
    }

    void runScheduledBatch() {
        if (!enabled || closed) {
            return;
        }
        try {
            int retired = retireExpiredBatch();
            if (retired > 0) {
                log.info("[Expired guest retirement] retired used expired guest accounts count={}", retired);
            }
        } catch (RuntimeException failure) {
            log.warn("[Expired guest retirement] batch deferred cause={}", failure.getClass().getSimpleName());
        }
    }

    public int retireExpiredBatch() {
        return retireExpiredBatch(BATCH_SIZE);
    }

    public int retireExpiredBatch(int batchSize) {
        if (closed) {
            return 0;
        }
        int bounded = Math.max(1, Math.min(200, batchSize));
        List<Long> candidateIds = jdbc.queryForList("""
                SELECT a.id
                FROM trading.trading_account a
                WHERE a.guest_account = true
                  AND a.status = 'ACTIVE'
                  AND a.credential_expires_at < clock_timestamp()
                  AND (
                      a.last_financial_change_at <> a.created_at
                      OR EXISTS (SELECT 1 FROM trading.trading_order o WHERE o.account_id = a.id)
                      OR EXISTS (SELECT 1 FROM trading.position p WHERE p.account_id = a.id)
                      OR EXISTS (SELECT 1 FROM trading.guest_retry r WHERE r.account_id = a.id)
                      OR EXISTS (SELECT 1 FROM trading.risk_account_work w WHERE w.account_id = a.id AND w.status IN ('PENDING', 'HELD'))
                  )
                ORDER BY a.credential_expires_at ASC, a.id ASC
                LIMIT ?
                """, Long.class, bounded);

        int retiredCount = 0;
        for (Long accountId : candidateIds) {
            try {
                Boolean retired = requiresNewTx.execute(status -> retireSingleAccount(accountId));
                if (Boolean.TRUE.equals(retired)) {
                    retiredCount++;
                }
            } catch (PessimisticLockingFailureException busy) {
                log.debug("[Expired guest retirement] accountId={} locked, deferring", accountId);
            } catch (RuntimeException failure) {
                log.warn("[Expired guest retirement] failed accountId={} cause={}",
                        accountId, failure.getClass().getSimpleName());
            }
        }
        return retiredCount;
    }

    private boolean retireSingleAccount(Long accountId) {
        risk.enterTransaction();
        TradingAccount account = locks.lockIncludingWithdrawn(accountId);
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        if (!account.isGuestAccount()
                || account.getStatus() != TradingAccount.Status.ACTIVE
                || account.getCredentialExpiresAt() == null
                || account.getCredentialExpiresAt().isAfter(now)) {
            return false;
        }

        Wallet wallet = wallets.findById(accountId).orElseThrow();
        List<Position> openPositions = positions.findByAccountIdAndStatusOrderByIdAsc(accountId, Position.Status.OPEN);
        Map<Long, Position> openById = openPositions.stream()
                .collect(Collectors.toMap(Position::getId, Function.identity()));
        List<TradingOrder> pendingOrders = orders.findByAccountIdAndStatusOrderByIdAsc(accountId, TradingOrder.Status.PENDING);

        BigDecimal released = BigDecimal.ZERO;
        BigDecimal reserved = BigDecimal.ZERO;
        for (TradingOrder pending : pendingOrders) {
            Instant orderNow = now.isBefore(pending.getCreatedAt()) ? pending.getCreatedAt() : now;
            if (pending.getAction() == TradingOrder.Action.OPEN) {
                reserved = reserved.add(pending.getReservedMargin());
            } else if (pending.getPositionId() != null) {
                Position target = openById.get(pending.getPositionId());
                if (target != null && target.getReservedCloseQuantity().compareTo(pending.getQuantity()) >= 0) {
                    target.releaseCloseReservation(pending.getQuantity());
                }
            }
            pending.cancelForGuestExpiration(orderNow);
            events.record(pending, null);
        }

        TakeProfitService tpService = takeProfits != null ? takeProfits.getIfAvailable() : null;
        for (Position position : openPositions) {
            Instant posNow = now.isBefore(position.getOpenedAt()) ? position.getOpenedAt() : now;
            if (position.getReservedCloseQuantity().signum() > 0) {
                position.releaseCloseReservation(position.getReservedCloseQuantity());
            }
            released = released.add(position.closeForGuestExpiration(posNow));
            events.recordStopLoss(position);
            if (tpService != null) {
                tpService.expireIfActive(position, "GUEST_EXPIRED", posNow);
            }
        }

        if (released.signum() > 0 || reserved.signum() > 0) {
            wallet.releaseExposure(released, reserved);
        }
        if (wallet.getUsedMargin().signum() != 0 || wallet.getReservedMargin().signum() != 0) {
            throw new IllegalStateException("Expired guest retirement found inconsistent reservations for accountId=" + accountId);
        }

        account.expireGuest(now);
        risk.retireGuestExpired(accountId);
        entities.flush();
        return true;
    }

    @PreDestroy
    public synchronized void close() {
        closed = true;
        executor.shutdownNow();
    }
}
