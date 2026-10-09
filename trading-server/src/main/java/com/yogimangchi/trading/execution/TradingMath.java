package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.position.entity.Position;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;

/** USDT simulation policy. Quantity is domain asset units, never provider contract units. */
public final class TradingMath {
    public static final BigDecimal INITIAL_BALANCE = new BigDecimal("10000");
    public static final BigDecimal MIN_NOTIONAL = BigDecimal.ONE;
    public static final BigDecimal MAX_NOTIONAL = new BigDecimal("1000000");
    public static final BigDecimal MAX_QUANTITY = new BigDecimal("1000000000000");
    public static final int MAX_LEVERAGE = 20;
    public static final int MAX_OPEN_POSITIONS = 100;
    public static final BigDecimal MAINTENANCE_RATE = new BigDecimal("0.005");
    public static final int AMOUNT_SCALE = 18;
    public static final int QUANTITY_SCALE = 8;

    private TradingMath() { }

    public static BigDecimal amount(BigDecimal value) {
        BigDecimal result = Objects.requireNonNull(value).setScale(AMOUNT_SCALE, RoundingMode.HALF_EVEN);
        if (result.precision() > 38) throw new IllegalArgumentException("Amount exceeds supported precision");
        return result;
    }

    public static void validateOrder(BigDecimal quantity, int leverage, BigDecimal price) {
        if (quantity == null || quantity.signum() <= 0 || quantity.stripTrailingZeros().scale() > QUANTITY_SCALE
                || quantity.compareTo(MAX_QUANTITY) > 0) {
            throw new IllegalArgumentException("Quantity must be positive with at most 8 decimal places");
        }
        if (leverage < 1 || leverage > MAX_LEVERAGE) throw new IllegalArgumentException("Leverage must be between 1 and 20");
        if (price == null || price.signum() <= 0 || price.stripTrailingZeros().scale() > AMOUNT_SCALE
                || price.precision() - price.scale() > 20) throw new IllegalArgumentException("Invalid price precision");
        BigDecimal notional = quantity.multiply(price);
        if (notional.compareTo(MIN_NOTIONAL) < 0 || notional.compareTo(MAX_NOTIONAL) > 0) {
            throw new IllegalArgumentException("Notional must be between 1 and 1000000 USDT");
        }
    }

    public static BigDecimal margin(BigDecimal price, BigDecimal quantity, int leverage) {
        validateOrder(quantity, leverage, price);
        return price.multiply(quantity).divide(BigDecimal.valueOf(leverage), AMOUNT_SCALE, RoundingMode.CEILING);
    }

    public static BigDecimal pnl(Position.Side side, BigDecimal entry, BigDecimal mark, BigDecimal quantity) {
        BigDecimal difference = Objects.requireNonNull(mark).subtract(Objects.requireNonNull(entry));
        return amount((Objects.requireNonNull(side) == Position.Side.LONG ? difference : difference.negate()).multiply(quantity));
    }

    public static BigDecimal available(BigDecimal balance, BigDecimal used, BigDecimal reserved, BigDecimal unrealized) {
        return amount(balance.min(balance.add(unrealized)).subtract(used).subtract(reserved).max(BigDecimal.ZERO));
    }

    public static BigDecimal maintenance(BigDecimal mark, BigDecimal quantity) {
        return mark.multiply(quantity).multiply(MAINTENANCE_RATE).setScale(AMOUNT_SCALE, RoundingMode.CEILING);
    }
}
