package com.yogimangchi.trading.execution.trigger;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Admission only: PostgreSQL account locks remain the financial consistency boundary. */
@Component
public class TradingEngineGate {
    private final RedisMarketDataBridge bridge;
    // Single-node ordering, not the financial lock. Distributed ownership is required before adding another worker.
    private final ReentrantReadWriteLock ordering = new ReentrantReadWriteLock(true);
    private volatile Map<Long, LatestMarkPrice> processed = Map.of();
    private final ConcurrentHashMap<Long, LatestMarkPrice> idleProcessed = new ConcurrentHashMap<>();
    private volatile long idleGapSequence = -1;
    private volatile boolean ready;
    private volatile long gapSequence = -1;
    private final com.yogimangchi.trading.execution.recovery.RiskAdmission risk;
    public TradingEngineGate(RedisMarketDataBridge bridge) {this.bridge=bridge;this.risk=null;}
    @org.springframework.beans.factory.annotation.Autowired
    public TradingEngineGate(RedisMarketDataBridge bridge,com.yogimangchi.trading.execution.recovery.RiskAdmission risk) {this.bridge=bridge;this.risk=risk;}
    public void requireAccountClear(Long accountId) {if(risk!=null)risk.requireClear(accountId);}

    /** Acquired before the account DB lock; held through commit so a tick cannot miss an uncommitted new position. */
    public void enterTradingTransaction() {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) throw new IllegalStateException("Trading requires a transaction");
        try {
            if (!ordering.readLock().tryLock(250, TimeUnit.MILLISECONDS)) throw new BusinessException(ErrorCode.ENGINE_RECOVERING);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt(); throw new BusinessException(ErrorCode.ENGINE_RECOVERING);
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCompletion(int status) {
                if (risk != null) risk.markExposureDirty();
                ordering.readLock().unlock();
            }
        });
        if(risk!=null)risk.enterTransaction();
    }

    AutoCloseable enterPriceEvent() throws InterruptedException {
        if (!ordering.writeLock().tryLock(500, TimeUnit.MILLISECONDS)) throw new IllegalStateException("Trading transactions still committing");
        return () -> ordering.writeLock().unlock();
    }

    public void recovering() { ready = false; idleProcessed.clear(); idleGapSequence = -1; }
    public void processed(Map<Long, LatestMarkPrice> book, long gapSequence) {
        if (this.idleGapSequence != gapSequence) {
            idleProcessed.clear();
            this.idleGapSequence = gapSequence;
        }
        this.processed = Map.copyOf(book); this.gapSequence = gapSequence; this.ready = true;
    }
    /** Marks an unexposed (zero positions/orders/holds) symbol tick as observed in memory without DB journal I/O. */
    public void markIdleSymbolProcessed(LatestMarkPrice tick, long currentGapSequence) {
        if (tick == null) return;
        if (this.idleGapSequence != currentGapSequence) {
            idleProcessed.clear();
            this.idleGapSequence = currentGapSequence;
        }
        idleProcessed.merge(tick.tradingSymbolId(), tick,
                (existing, incoming) -> incoming.eventTime().isAfter(existing.eventTime()) ? incoming : existing);
    }
    /** Clears an idle-tracked symbol as soon as it becomes exposed so requireCaughtUp demands durable worker commit. */
    public void clearIdleSymbol(Long symbolId) {
        if (symbolId != null) idleProcessed.remove(symbolId);
    }
    public String status() {
        var health = bridge.health();
        return ready && (risk==null||risk.healthy()) && health.state() == RedisMarketDataBridge.State.HEALTHY && health.gapSequence() == gapSequence
                ? "READY" : "RECOVERING";
    }
    public void requireCaughtUp(Map<Long, LatestPriceStore.Snapshot> current) {
        Map<Long, LatestMarkPrice> book = processed;
        long activeGapSeq = this.gapSequence;
        boolean idleValid = this.idleGapSequence == activeGapSeq;
        if (!status().equals("READY") || current.entrySet().stream().anyMatch(entry -> {
            LatestMarkPrice dbKnown = book.get(entry.getKey());
            LatestMarkPrice idleKnown = idleValid ? idleProcessed.get(entry.getKey()) : null;
            LatestMarkPrice known = newerOf(dbKnown, idleKnown);
            return known == null || entry.getValue().latestPrice().isEmpty()
                    || known.eventTime().isBefore(entry.getValue().latestPrice().orElseThrow().eventTime());
        })) throw new BusinessException(ErrorCode.ENGINE_RECOVERING);
    }
    private static LatestMarkPrice newerOf(LatestMarkPrice a, LatestMarkPrice b) {
        if (a == null) return b;
        if (b == null) return a;
        return b.eventTime().isAfter(a.eventTime()) ? b : a;
    }
}
