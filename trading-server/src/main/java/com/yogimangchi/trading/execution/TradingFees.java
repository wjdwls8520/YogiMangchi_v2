package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.order.entity.TradingOrder;
import java.math.BigDecimal;
import java.math.RoundingMode;

/** Simulation rates by submitted order type, not a claim about exchange maker/taker liquidity. */
public final class TradingFees {
    public static final BigDecimal MARKET_RATE = new BigDecimal("0.0005");
    public static final BigDecimal LIMIT_RATE = new BigDecimal("0.0003");
    private TradingFees() { }

    public static BigDecimal rate(TradingOrder.Type type) {
        return switch (type) { case MARKET -> MARKET_RATE; case LIMIT -> LIMIT_RATE; };
    }

    public static BigDecimal fee(BigDecimal price, BigDecimal quantity, BigDecimal rate) {
        TradingMath.validatePrice(price);
        TradingMath.validateQuantity(quantity);
        if (rate == null || rate.signum() < 0 || rate.compareTo(MARKET_RATE) > 0)
            throw new IllegalArgumentException("Unsupported simulation fee rate");
        return TradingMath.amount(price.multiply(quantity).multiply(rate).setScale(TradingMath.AMOUNT_SCALE, RoundingMode.CEILING));
    }

    public static BigDecimal reservation(BigDecimal price, BigDecimal quantity, int leverage, BigDecimal rate) {
        return TradingMath.margin(price, quantity, leverage).add(fee(price, quantity, rate));
    }
}
