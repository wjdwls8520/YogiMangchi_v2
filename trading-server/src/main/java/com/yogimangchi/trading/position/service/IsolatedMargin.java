package com.yogimangchi.trading.position.service;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.position.entity.Position;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;
import org.springframework.stereotype.Component;

/** Position-only collateral and liquidation arithmetic. Never uses another position or wallet equity. */
@Component
public class IsolatedMargin {
    public static final BigDecimal LIQUIDATION_FEE_RATE = new BigDecimal("0.0005");

    public record Risk(BigDecimal unrealizedPnl, BigDecimal equity, BigDecimal maintenanceMargin,
                       BigDecimal closingFeeReserve) {
        public BigDecimal buffer() { return equity.subtract(maintenanceMargin).subtract(closingFeeReserve); }
        public boolean atRisk() { return buffer().signum() <= 0; }
    }

    /** gross PnL remains the actual Mark execution fact; adjustment is a separate platform shortfall. */
    public record Settlement(BigDecimal grossPnl, BigDecimal fee, BigDecimal shortfallAdjustment) {
        public BigDecimal walletDelta() { return grossPnl.subtract(fee).add(shortfallAdjustment); }
    }

    public Risk risk(Position position, BigDecimal mark) {
        return risk(position.getSide(), position.getQuantity(), position.getEntryNotional(), position.getMargin(), mark);
    }

    public Risk projectedOpenRisk(Position existing, Position.Side side, BigDecimal addedQuantity,
            BigDecimal fillingPrice, int leverage, BigDecimal mark) {
        TradingMath.validateOrder(addedQuantity, leverage, fillingPrice);
        BigDecimal quantity = addedQuantity;
        BigDecimal basis = fillingPrice.multiply(addedQuantity);
        if (existing != null) {
            if (existing.getSide() != side || existing.getLeverage() != leverage)
                throw new IllegalArgumentException("Invalid projected hedge entry");
            quantity = quantity.add(existing.getQuantity());
            basis = basis.add(existing.getEntryNotional());
        }
        return risk(side, quantity, basis, TradingMath.basisMargin(basis, leverage), mark);
    }

    public Risk risk(Position.Side side, BigDecimal quantity, BigDecimal entryNotional,
                     BigDecimal collateral, BigDecimal mark) {
        TradingMath.validatePrice(mark);
        TradingMath.validateQuantity(quantity);
        if (Objects.requireNonNull(entryNotional).signum() <= 0 || Objects.requireNonNull(collateral).signum() <= 0)
            throw new IllegalArgumentException("Open isolated exposure requires positive basis and collateral");
        BigDecimal difference = mark.multiply(quantity).subtract(entryNotional);
        BigDecimal pnl = TradingMath.amount(Objects.requireNonNull(side) == Position.Side.LONG ? difference : difference.negate());
        return new Risk(pnl, TradingMath.amount(collateral.add(pnl)), TradingMath.maintenance(mark, quantity), liquidationFee(mark, quantity));
    }

    public BigDecimal liquidationFee(BigDecimal mark, BigDecimal quantity) {
        TradingMath.validatePrice(mark);
        TradingMath.validateQuantity(quantity);
        return mark.multiply(quantity).multiply(LIQUIDATION_FEE_RATE)
                .setScale(TradingMath.AMOUNT_SCALE, RoundingMode.CEILING);
    }

    public Settlement liquidationSettlement(BigDecimal collateral, BigDecimal grossPnl, BigDecimal fee) {
        BigDecimal allocated = TradingMath.amount(Objects.requireNonNull(collateral));
        BigDecimal pnl = TradingMath.amount(Objects.requireNonNull(grossPnl));
        BigDecimal charged = TradingMath.amount(Objects.requireNonNull(fee));
        if (allocated.signum() <= 0 || charged.signum() < 0)
            throw new IllegalArgumentException("Invalid isolated liquidation settlement");
        BigDecimal adjustment = charged.subtract(allocated).subtract(pnl).max(BigDecimal.ZERO);
        return new Settlement(pnl, charged, TradingMath.amount(adjustment));
    }
}
