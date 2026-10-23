package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.service.IsolatedMargin;
import java.math.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Component;

/** Position collateral threshold; another position's price or wallet cash cannot change it. */
@Component
public class LiquidationPriceEstimator {
    public enum Status { ESTIMATED_DOWNWARD, ESTIMATED_UPWARD, PRICE_UNAVAILABLE, NO_THRESHOLD,
        UNSUPPORTED_MODEL, ALREADY_AT_RISK, MARGIN_MIGRATION_REQUIRED }
    public record Estimate(BigDecimal price, Status status, Instant asOf) { }
    private static final BigDecimal TICK = BigDecimal.ONE.scaleByPowerOfTen(-TradingMath.AMOUNT_SCALE);
    private static final BigDecimal MAX_PRICE = BigDecimal.TEN.pow(20).subtract(TICK);
    private final IsolatedMargin isolated;

    public LiquidationPriceEstimator(IsolatedMargin isolated) { this.isolated = isolated; }

    public Map<Long, Estimate> estimate(List<Position> open, Map<Long, LatestPriceStore.Snapshot> snapshots, boolean isolatedAccount) {
        Map<Long, Estimate> estimates = new LinkedHashMap<>();
        Budget accountBudget = new Budget(4096);
        for (Position position : open) {
            Estimate estimate;
            var snapshot = snapshots.get(position.getTradingSymbolId());
            if (!isolatedAccount) estimate = new Estimate(null, Status.MARGIN_MIGRATION_REQUIRED, null);
            else if (snapshot == null || snapshot.status() != LatestPriceStore.Status.FRESH)
                estimate = new Estimate(null, Status.PRICE_UNAVAILABLE, null);
            else {
                var price = snapshot.latestPrice().orElseThrow();
                try { estimate = threshold(position, price.domainMarkPrice(), price.receivedAt(), accountBudget); }
                catch (ArithmeticException | IllegalArgumentException | SearchLimit exception) {
                    estimate = new Estimate(null, Status.UNSUPPORTED_MODEL, price.receivedAt());
                }
            }
            estimates.put(position.getId(), estimate);
        }
        return Collections.unmodifiableMap(estimates);
    }

    private Estimate threshold(Position position, BigDecimal current, Instant asOf, Budget accountBudget) {
        if (isolated.risk(position, current).atRisk()) return new Estimate(null, Status.ALREADY_AT_RISK, asOf);
        boolean descending = position.getSide() == Position.Side.LONG;
        BigDecimal rate = TradingMath.MAINTENANCE_RATE.add(IsolatedMargin.LIQUIDATION_FEE_RATE);
        BigDecimal slope = position.getQuantity().multiply(descending ? BigDecimal.ONE.subtract(rate) : BigDecimal.ONE.add(rate).negate());
        BigDecimal constant = position.getMargin().add(descending ? position.getEntryNotional().negate() : position.getEntryNotional());
        // HALF_EVEN PnL <= .5 ULP, maintenance/fee CEILING each < 1 ULP.
        // Analytic roots bound the search; returned prices use the engine's rounded risk.
        BigDecimal error = TICK.multiply(BigDecimal.valueOf(3));
        BigDecimal first = constant.negate().subtract(error).divide(slope, TradingMath.AMOUNT_SCALE, RoundingMode.FLOOR);
        BigDecimal second = constant.negate().add(error).divide(slope, TradingMath.AMOUNT_SCALE, RoundingMode.CEILING);
        BigDecimal low = first.min(second).subtract(TICK).max(TICK);
        BigDecimal high = first.max(second).add(TICK).min(MAX_PRICE);
        if (descending) high = high.min(current); else low = low.max(current);
        if (low.compareTo(high) > 0) return new Estimate(null, Status.NO_THRESHOLD, asOf);
        BigInteger found = search(units(low), units(high), descending, position, new Budget(512), accountBudget);
        if (found == null) return new Estimate(null, Status.NO_THRESHOLD, asOf);
        BigDecimal price = price(found), nearer = price.add(descending ? TICK : TICK.negate());
        if (!isolated.risk(position, price).atRisk() || nearer.signum() <= 0 || isolated.risk(position, nearer).atRisk())
            return new Estimate(null, Status.UNSUPPORTED_MODEL, asOf);
        return new Estimate(price, descending ? Status.ESTIMATED_DOWNWARD : Status.ESTIMATED_UPWARD, asOf);
    }

    /** Rounded risk can have tiny islands; do not assume monotonic rounding. */
    private BigInteger search(BigInteger low, BigInteger high, boolean descending, Position position, Budget positionBudget, Budget accountBudget) {
        positionBudget.consume(); accountBudget.consume();
        var lo = isolated.risk(position, price(low));
        var hi = isolated.risk(position, price(high));
        BigDecimal minimum = (descending ? lo.equity() : hi.equity()).subtract(hi.maintenanceMargin()).subtract(hi.closingFeeReserve());
        BigDecimal maximum = (descending ? hi.equity() : lo.equity()).subtract(lo.maintenanceMargin()).subtract(lo.closingFeeReserve());
        if (minimum.signum() > 0) return null;
        if (maximum.signum() <= 0) return descending ? high : low;
        if (low.equals(high)) throw new IllegalStateException("One-price risk interval must resolve");
        BigInteger middle = low.add(high).shiftRight(1);
        BigInteger nearer = descending ? search(middle.add(BigInteger.ONE), high, true, position, positionBudget, accountBudget)
                : search(low, middle, false, position, positionBudget, accountBudget);
        if (nearer != null) return nearer;
        return descending ? search(low, middle, true, position, positionBudget, accountBudget)
                : search(middle.add(BigInteger.ONE), high, false, position, positionBudget, accountBudget);
    }

    private static BigInteger units(BigDecimal price) { return price.setScale(TradingMath.AMOUNT_SCALE, RoundingMode.UNNECESSARY).unscaledValue(); }
    private static BigDecimal price(BigInteger units) { return new BigDecimal(units, TradingMath.AMOUNT_SCALE); }
    private static final class Budget {
        private int remaining;
        Budget(int remaining) { this.remaining = remaining; }
        void consume() { if (--remaining < 0) throw new SearchLimit(); }
    }
    private static final class SearchLimit extends RuntimeException { }
}
