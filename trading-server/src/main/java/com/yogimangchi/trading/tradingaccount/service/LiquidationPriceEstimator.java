package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import java.math.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Component;

/** Read-only conditional ACCOUNT threshold, never an individual position's execution price. */
@Component
public class LiquidationPriceEstimator {
    public enum Status { ESTIMATED_DOWNWARD, ESTIMATED_UPWARD, PRICE_UNAVAILABLE, NO_THRESHOLD, UNSUPPORTED_MODEL, ALREADY_AT_RISK }
    public record Estimate(BigDecimal price, Status status, Instant asOf) { }
    private static final BigDecimal TICK = BigDecimal.ONE.scaleByPowerOfTen(-TradingMath.AMOUNT_SCALE);
    private static final BigDecimal MAX_PRICE = BigDecimal.TEN.pow(20).subtract(TICK);
    private static final int SYMBOL_SEARCH_BUDGET = 512;
    private static final int ACCOUNT_SEARCH_BUDGET = 4096;
    private final AccountValuation valuation;

    public LiquidationPriceEstimator(AccountValuation valuation) { this.valuation = valuation; }

    public Map<Long, Estimate> estimate(Wallet wallet, List<Position> open, AccountValuation.Value value) {
        Map<Long, List<Position>> grouped = new LinkedHashMap<>();
        open.forEach(p -> grouped.computeIfAbsent(p.getTradingSymbolId(), ignored -> new ArrayList<>()).add(p));
        Map<Long, Estimate> result = new HashMap<>();
        if (grouped.isEmpty()) return Map.of();
        Instant asOf = value.fresh() ? value.prices().values().stream()
                .map(s -> s.latestPrice().orElseThrow().receivedAt()).min(Instant::compareTo).orElse(null) : null;
        Budget accountBudget = new Budget(ACCOUNT_SEARCH_BUDGET);
        for (var group : grouped.entrySet()) {
            Estimate estimate;
            if (!value.fresh()) estimate = new Estimate(null, Status.PRICE_UNAVAILABLE, null);
            else if (value.atRisk()) estimate = new Estimate(null, Status.ALREADY_AT_RISK, asOf);
            else {
                try { estimate = threshold(wallet, open, value, group.getKey(), group.getValue(), asOf, accountBudget); }
                catch (ArithmeticException | IllegalArgumentException | SearchLimit exception) {
                    // Never send an unverified number when precision/range/work bounds prevent a proof.
                    estimate = new Estimate(null, Status.UNSUPPORTED_MODEL, asOf);
                }
            }
            result.put(group.getKey(), estimate);
        }
        return Map.copyOf(result);
    }

    private Estimate threshold(Wallet wallet, List<Position> open, AccountValuation.Value value,
            Long symbol, List<Position> target, Instant asOf, Budget accountBudget) {
        var others = open.stream().filter(p -> !p.getTradingSymbolId().equals(symbol)).toList();
        BigDecimal fixed = valuation.risk(wallet, others, p -> mark(value, p.getTradingSymbolId())).buffer();
        BigDecimal constant = fixed, net = BigDecimal.ZERO, gross = BigDecimal.ZERO;
        for (Position p : target) {
            boolean longSide = p.getSide() == Position.Side.LONG;
            net = net.add(longSide ? p.getQuantity() : p.getQuantity().negate());
            gross = gross.add(p.getQuantity());
            constant = constant.add(longSide ? p.getEntryNotional().negate() : p.getEntryNotional());
        }
        BigDecimal slope = net.subtract(gross.multiply(TradingMath.MAINTENANCE_RATE));
        // HALF_EVEN PnL error <= .5 ULP and CEILING maintenance error < 1 ULP per position.
        // Use a deliberately wider 2 ULP envelope. This formula only bounds the search, not the returned price.
        BigDecimal error = TICK.multiply(BigDecimal.valueOf(2L * target.size()));
        BigDecimal current = mark(value, symbol);
        TradingMath.validatePrice(current);
        if (constant.add(slope.multiply(current)).subtract(error).signum() <= 0)
            return new Estimate(null, Status.UNSUPPORTED_MODEL, asOf); // Rounded safe point too close to certify one adverse direction.
        if (slope.signum() == 0) return new Estimate(null, Status.NO_THRESHOLD, asOf);
        BigDecimal firstRoot = constant.negate().subtract(error).divide(slope, TradingMath.AMOUNT_SCALE, RoundingMode.FLOOR);
        BigDecimal secondRoot = constant.negate().add(error).divide(slope, TradingMath.AMOUNT_SCALE, RoundingMode.CEILING);
        // Widen outward regardless of slope; one extra price ULP covers opposite division rounding directions.
        BigDecimal low = firstRoot.min(secondRoot).subtract(TICK).max(TICK);
        BigDecimal high = firstRoot.max(secondRoot).add(TICK).min(MAX_PRICE);
        boolean descending = slope.signum() > 0;
        if (descending) high = high.min(current);
        else low = low.max(current);
        if (low.compareTo(high) > 0) return new Estimate(null, Status.NO_THRESHOLD, asOf);
        Budget symbolBudget = new Budget(SYMBOL_SEARCH_BUDGET);
        BigInteger found = search(units(low), units(high), descending, fixed, target, symbolBudget, accountBudget);
        if (found == null) return new Estimate(null, Status.NO_THRESHOLD, asOf);
        BigDecimal price = price(found);
        BigDecimal nearer = price.add(descending ? TICK : TICK.negate());
        // Verify the result and its immediate safe-side neighbour with the actual account engine arithmetic.
        if (valuation.risk(wallet, open, p -> p.getTradingSymbolId().equals(symbol) ? price : mark(value, p.getTradingSymbolId())).buffer().signum() > 0
                || nearer.signum() <= 0 || valuation.risk(wallet, open,
                    p -> p.getTradingSymbolId().equals(symbol) ? nearer : mark(value, p.getTradingSymbolId())).buffer().signum() <= 0)
            return new Estimate(null, Status.UNSUPPORTED_MODEL, asOf);
        return new Estimate(price, descending ? Status.ESTIMATED_DOWNWARD : Status.ESTIMATED_UPWARD, asOf);
    }

    /** Certified interval bounds, not a monotonic binary search: rounded Hedge risk can have tiny islands. */
    private BigInteger search(BigInteger low, BigInteger high, boolean descending, BigDecimal fixed,
            List<Position> target, Budget symbolBudget, Budget accountBudget) {
        symbolBudget.consume(); accountBudget.consume();
        BigDecimal lowPrice = price(low), highPrice = price(high);
        BigDecimal minimum = fixed, maximum = fixed;
        for (Position p : target) {
            boolean longSide = p.getSide() == Position.Side.LONG;
            minimum = minimum.add(p.unrealizedPnl(longSide ? lowPrice : highPrice))
                    .subtract(TradingMath.maintenance(highPrice, p.getQuantity()));
            maximum = maximum.add(p.unrealizedPnl(longSide ? highPrice : lowPrice))
                    .subtract(TradingMath.maintenance(lowPrice, p.getQuantity()));
        }
        if (minimum.signum() > 0) return null; // Entire interval is safe; cannot skip an earlier risk crossing.
        if (maximum.signum() <= 0) return descending ? high : low;
        if (low.equals(high)) throw new IllegalStateException("Risk interval must resolve at one price ULP");
        BigInteger middle = low.add(high).shiftRight(1);
        BigInteger nearer = descending ? search(middle.add(BigInteger.ONE), high, true, fixed, target, symbolBudget, accountBudget)
                : search(low, middle, false, fixed, target, symbolBudget, accountBudget);
        if (nearer != null) return nearer;
        return descending ? search(low, middle, true, fixed, target, symbolBudget, accountBudget)
                : search(middle.add(BigInteger.ONE), high, false, fixed, target, symbolBudget, accountBudget);
    }

    private static BigDecimal mark(AccountValuation.Value value, Long symbol) { return value.prices().get(symbol).latestPrice().orElseThrow().domainMarkPrice(); }
    private static BigInteger units(BigDecimal price) { return price.setScale(TradingMath.AMOUNT_SCALE, RoundingMode.UNNECESSARY).unscaledValue(); }
    private static BigDecimal price(BigInteger units) { return new BigDecimal(units, TradingMath.AMOUNT_SCALE); }
    private static final class Budget {
        private int remaining;
        Budget(int remaining) { this.remaining = remaining; }
        void consume() { if (--remaining < 0) throw new SearchLimit(); }
    }
    private static final class SearchLimit extends RuntimeException { }
}
