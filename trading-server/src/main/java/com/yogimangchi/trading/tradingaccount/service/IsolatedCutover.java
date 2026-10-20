package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.service.IsolatedMargin;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Called only by the trigger transaction under AccountLock. Never closes or funds a legacy position. */
@Component
public class IsolatedCutover {
    private final IsolatedMargin isolated;
    public IsolatedCutover(IsolatedMargin isolated) { this.isolated = isolated; }

    public boolean activateIfSafe(TradingAccount account, Wallet wallet, List<Position> open,
            Map<Long, LatestPriceStore.Snapshot> snapshots, Instant now) {
        if (account.isIsolated()) return true;
        if (account.getMarginTransitionStatus() != TradingAccount.MarginTransitionStatus.PENDING) return false;
        if (wallet.getBalance().compareTo(wallet.getUsedMargin().add(wallet.getReservedMargin())) < 0) {
            account.requireMarginReview();
            return false;
        }
        if (open.stream().anyMatch(p -> !snapshots.containsKey(p.getTradingSymbolId())
                || snapshots.get(p.getTradingSymbolId()).status() != LatestPriceStore.Status.FRESH)) return false;
        if (open.stream().anyMatch(p -> isolated.risk(p, snapshots.get(p.getTradingSymbolId())
                .latestPrice().orElseThrow().domainMarkPrice()).atRisk())) {
            account.requireMarginReview();
            return false; // Persistent hold: recovery of a price does not silently approve an earlier unsafe conversion.
        }
        for (Position position : open) {
            position.recordIsolatedCutover(snapshots.get(position.getTradingSymbolId()).latestPrice().orElseThrow().domainMarkPrice(), now);
        }
        account.activateIsolated(now);
        return true;
    }
}
