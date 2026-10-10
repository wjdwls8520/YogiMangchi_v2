package com.yogimangchi.trading.execution.trigger;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import java.util.Map;
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
    private volatile boolean ready;
    private volatile long gapSequence = -1;
    public TradingEngineGate(RedisMarketDataBridge bridge) { this.bridge = bridge; }

    /** Acquired before the account DB lock; held through commit so a tick cannot miss an uncommitted new position. */
    public void enterTradingTransaction() {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) throw new IllegalStateException("Trading requires a transaction");
        try {
            if (!ordering.readLock().tryLock(250, TimeUnit.MILLISECONDS)) throw new BusinessException(ErrorCode.ENGINE_RECOVERING);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt(); throw new BusinessException(ErrorCode.ENGINE_RECOVERING);
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCompletion(int status) { ordering.readLock().unlock(); }
        });
    }

    AutoCloseable enterPriceEvent() throws InterruptedException {
        if (!ordering.writeLock().tryLock(500, TimeUnit.MILLISECONDS)) throw new IllegalStateException("Trading transactions still committing");
        return () -> ordering.writeLock().unlock();
    }

    public void recovering() { ready = false; }
    public void processed(Map<Long, LatestMarkPrice> book, long gapSequence) {
        this.processed = Map.copyOf(book); this.gapSequence = gapSequence; this.ready = true;
    }
    public String status() {
        var health = bridge.health();
        return ready && health.state() == RedisMarketDataBridge.State.HEALTHY && health.gapSequence() == gapSequence
                ? "READY" : "RECOVERING";
    }
    public void requireCaughtUp(Map<Long, LatestPriceStore.Snapshot> current) {
        Map<Long, LatestMarkPrice> book = processed;
        if (!status().equals("READY") || current.entrySet().stream().anyMatch(entry -> {
            LatestMarkPrice known = book.get(entry.getKey());
            return known == null || entry.getValue().latestPrice().isEmpty()
                    || known.eventTime().isBefore(entry.getValue().latestPrice().orElseThrow().eventTime());
        })) throw new BusinessException(ErrorCode.ENGINE_RECOVERING);
    }
}
