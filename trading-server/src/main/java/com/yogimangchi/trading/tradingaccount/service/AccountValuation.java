package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Component;

@Component
public class AccountValuation {
    private final LatestPriceStore prices;
    public AccountValuation(LatestPriceStore prices) { this.prices = prices; }

    public record Value(Instant capturedAt, Map<Long, LatestPriceStore.Snapshot> prices,
                        boolean fresh, BigDecimal unrealizedPnl, BigDecimal equity,
                        BigDecimal availableBalance, BigDecimal maintenanceMargin) {
        public boolean atRisk() { return fresh && equity.compareTo(maintenanceMargin) <= 0; }
    }

    /** Same rounded account risk calculation for live engine valuation and hypothetical price verification. */
    public record Risk(BigDecimal unrealizedPnl, BigDecimal equity, BigDecimal maintenanceMargin) {
        public BigDecimal buffer() { return equity.subtract(maintenanceMargin); }
    }

    public Risk risk(Wallet wallet, List<Position> positions, Function<Position, BigDecimal> markFor) {
        BigDecimal pnl = BigDecimal.ZERO;
        BigDecimal maintenance = BigDecimal.ZERO;
        for (Position position : positions) {
            BigDecimal mark = markFor.apply(position);
            pnl = pnl.add(position.unrealizedPnl(mark));
            maintenance = maintenance.add(TradingMath.maintenance(mark, position.getQuantity()));
        }
        return new Risk(TradingMath.amount(pnl), TradingMath.amount(wallet.getBalance().add(pnl)), TradingMath.amount(maintenance));
    }

    public Value calculate(Wallet wallet, List<Position> positions) {
        return calculate(wallet, positions, java.util.Set.of());
    }

    public Value calculate(Wallet wallet, List<Position> positions, java.util.Set<Long> additionalSymbols) {
        Instant capturedAt = Instant.now();
        var ids = new java.util.HashSet<>(additionalSymbols);
        positions.forEach(position -> ids.add(position.getTradingSymbolId()));
        Map<Long, LatestPriceStore.Snapshot> snapshots = prices.findAll(
                ids);
        return evaluate(wallet, positions, snapshots, capturedAt);
    }

    public Value evaluate(Wallet wallet, List<Position> positions, Map<Long, LatestPriceStore.Snapshot> snapshots, Instant capturedAt) {
        boolean fresh = positions.stream().allMatch(position -> snapshots.containsKey(position.getTradingSymbolId()))
                && snapshots.values().stream().allMatch(snapshot -> snapshot.status() == LatestPriceStore.Status.FRESH);
        if (!fresh) return new Value(capturedAt, snapshots, false, null, null, null, null);
        Risk risk = risk(wallet, positions, position -> snapshots.get(position.getTradingSymbolId()).latestPrice().orElseThrow().domainMarkPrice());
        return new Value(capturedAt, snapshots, true, risk.unrealizedPnl(), risk.equity(),
                TradingMath.available(wallet.getBalance(), wallet.getUsedMargin(), wallet.getReservedMargin(), risk.unrealizedPnl()),
                risk.maintenanceMargin());
    }
}
