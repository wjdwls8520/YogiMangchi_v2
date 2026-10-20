package com.yogimangchi.trading.position.entity;

import com.yogimangchi.trading.execution.TradingMath;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.Objects;

/** One open lifecycle per account/symbol/side. Exact remaining cost basis avoids average-price rounding drift. */
@Entity
@Table(name = "position")
public class Position {
    public enum Side { LONG, SHORT }
    public enum Status { OPEN, CLOSED, LIQUIDATED, MERGED }

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false, updatable = false) private Long accountId;
    @Column(nullable = false, updatable = false) private Long tradingSymbolId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 8, updatable = false) private Side side;
    @Column(nullable = false, precision = 28, scale = 8) private BigDecimal quantity;
    @Column(nullable = false, precision = 28, scale = 8) private BigDecimal initialQuantity;
    @Column(nullable = false, precision = 28, scale = 8) private BigDecimal reservedCloseQuantity;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal entryPrice;
    @Column(nullable = false, precision = 66, scale = 26) private BigDecimal entryNotional;
    @Column(nullable = false) private int leverage;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal margin;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal initialMargin;
    private Long mergedIntoPositionId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private Status status;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal realizedPnl;
    @Column(precision = 38, scale = 18) private BigDecimal exitPrice;
    @Column(nullable = false, updatable = false) private Instant openedAt;
    private Instant closedAt;
    @Column(nullable = false, length = 8, updatable = false) private String openedMarginMode = "ISOLATED";
    @Column(precision = 38, scale = 18) private BigDecimal isolatedCutoverMargin;
    @Column(precision = 38, scale = 18) private BigDecimal isolatedCutoverPrice;
    private Instant isolatedCutoverAt;

    protected Position() { }

    public static Position open(Long accountId, Long symbolId, Side side, BigDecimal quantity,
                                BigDecimal entryPrice, int leverage, Instant now) {
        if (accountId == null || accountId <= 0 || symbolId == null || symbolId <= 0) throw new IllegalArgumentException("IDs must be positive");
        TradingMath.validateOrder(quantity, leverage, entryPrice);
        Position position = new Position();
        position.accountId = accountId;
        position.tradingSymbolId = symbolId;
        position.side = Objects.requireNonNull(side);
        position.quantity = quantity.setScale(TradingMath.QUANTITY_SCALE);
        position.initialQuantity = position.quantity;
        position.reservedCloseQuantity = BigDecimal.ZERO.setScale(TradingMath.QUANTITY_SCALE);
        position.entryPrice = TradingMath.amount(entryPrice);
        position.entryNotional = entryPrice.multiply(position.quantity).setScale(TradingMath.BASIS_SCALE);
        position.leverage = leverage;
        position.margin = TradingMath.margin(entryPrice, quantity, leverage);
        position.initialMargin = position.margin;
        position.status = Status.OPEN;
        position.realizedPnl = TradingMath.amount(BigDecimal.ZERO);
        position.openedAt = Objects.requireNonNull(now);
        return position;
    }

    public record Settlement(BigDecimal quantity, BigDecimal releasedMargin, BigDecimal realizedPnl) { }

    /** Additional Fill in the same lifecycle; never realizes PnL or changes CLOSE reservations. */
    public BigDecimal increase(BigDecimal fillingQuantity, BigDecimal price) {
        if (status != Status.OPEN) throw new IllegalStateException("Position is not open");
        TradingMath.validateOrder(fillingQuantity, leverage, price);
        BigDecimal newQuantity = quantity.add(fillingQuantity);
        TradingMath.validateQuantity(newQuantity);
        BigDecimal newBasis = entryNotional.add(price.multiply(fillingQuantity));
        if (newBasis.compareTo(TradingMath.MAX_NOTIONAL) > 0) throw new IllegalArgumentException("Position notional limit exceeded");
        BigDecimal newMargin = TradingMath.basisMargin(newBasis, leverage);
        BigDecimal additional = newMargin.subtract(margin);
        quantity = newQuantity.setScale(TradingMath.QUANTITY_SCALE);
        entryNotional = newBasis.setScale(TradingMath.BASIS_SCALE);
        entryPrice = newBasis.divide(quantity, TradingMath.AMOUNT_SCALE, RoundingMode.HALF_EVEN);
        initialQuantity = initialQuantity.add(fillingQuantity).setScale(TradingMath.QUANTITY_SCALE);
        initialMargin = initialMargin.add(additional);
        margin = newMargin;
        return additional;
    }

    public BigDecimal marginAtLeverage(int newLeverage) { return TradingMath.basisMargin(entryNotional, newLeverage); }

    public void changeLeverage(int newLeverage) {
        if (status != Status.OPEN) throw new IllegalStateException("Position is not open");
        margin = marginAtLeverage(newLeverage);
        leverage = newLeverage;
    }

    public BigDecimal unrealizedPnl(BigDecimal mark) {
        BigDecimal difference = mark.multiply(quantity).subtract(entryNotional);
        return TradingMath.amount(side == Side.LONG ? difference : difference.negate());
    }

    public BigDecimal closingPnl(BigDecimal closingQuantity, BigDecimal price) {
        BigDecimal basis = closingBasis(closingQuantity);
        BigDecimal difference = price.multiply(closingQuantity).subtract(basis);
        return TradingMath.amount(side == Side.LONG ? difference : difference.negate());
    }

    private BigDecimal closingBasis(BigDecimal closingQuantity) {
        return closingQuantity.compareTo(quantity) == 0 ? entryNotional
                : entryNotional.multiply(closingQuantity).divide(quantity, TradingMath.BASIS_SCALE, RoundingMode.HALF_EVEN);
    }

    public void reserveClose(BigDecimal closingQuantity) {
        TradingMath.validateQuantity(closingQuantity);
        if (status != Status.OPEN || closingQuantity.compareTo(getFreeCloseQuantity()) > 0)
            throw new IllegalStateException("Insufficient unreserved close quantity");
        reservedCloseQuantity = reservedCloseQuantity.add(closingQuantity).setScale(TradingMath.QUANTITY_SCALE);
    }

    public void releaseCloseReservation(BigDecimal closingQuantity) {
        TradingMath.validateQuantity(closingQuantity);
        if (closingQuantity.compareTo(reservedCloseQuantity) > 0) throw new IllegalStateException("Close reservation cannot become negative");
        reservedCloseQuantity = reservedCloseQuantity.subtract(closingQuantity).setScale(TradingMath.QUANTITY_SCALE);
    }

    public Settlement close(BigDecimal closingQuantity, BigDecimal price, Instant now, boolean liquidated) {
        if (status != Status.OPEN) throw new IllegalStateException("Position is already closed");
        TradingMath.validatePrice(price);
        TradingMath.validateQuantity(closingQuantity);
        if (closingQuantity.compareTo(getFreeCloseQuantity()) > 0) throw new IllegalStateException("Cannot close reserved quantity");
        if (liquidated && closingQuantity.compareTo(quantity) != 0) throw new IllegalArgumentException("Liquidation closes the remaining lot");
        if (Objects.requireNonNull(now).isBefore(openedAt)) throw new IllegalArgumentException("Close time precedes open time");
        BigDecimal released = TradingMath.releasedMargin(margin, quantity, closingQuantity);
        BigDecimal pnl = closingPnl(closingQuantity, price);
        entryNotional = entryNotional.subtract(closingBasis(closingQuantity));
        quantity = quantity.subtract(closingQuantity).setScale(TradingMath.QUANTITY_SCALE);
        margin = margin.subtract(released);
        realizedPnl = TradingMath.amount(realizedPnl.add(pnl));
        if (quantity.signum() == 0) {
            exitPrice = TradingMath.amount(price);
            closedAt = now;
            status = liquidated ? Status.LIQUIDATED : Status.CLOSED;
        }
        return new Settlement(closingQuantity.setScale(TradingMath.QUANTITY_SCALE), released, pnl);
    }

    public Long getId() { return id; }
    public void recordIsolatedCutover(BigDecimal mark, Instant now) {
        if (status != Status.OPEN || !"CROSS".equals(openedMarginMode) || isolatedCutoverAt != null)
            throw new IllegalStateException("Position is not eligible for isolated cutover");
        TradingMath.validatePrice(mark);
        isolatedCutoverMargin = margin;
        isolatedCutoverPrice = TradingMath.amount(mark);
        isolatedCutoverAt = Objects.requireNonNull(now);
    }
    public String getOpenedMarginMode() { return openedMarginMode; }
    public Long getAccountId() { return accountId; }
    public Long getTradingSymbolId() { return tradingSymbolId; }
    public Side getSide() { return side; }
    public BigDecimal getQuantity() { return quantity; }
    public BigDecimal getInitialQuantity() { return initialQuantity; }
    public BigDecimal getReservedCloseQuantity() { return reservedCloseQuantity; }
    public BigDecimal getFreeCloseQuantity() { return quantity.subtract(reservedCloseQuantity); }
    public BigDecimal getInitialMargin() { return initialMargin; }
    public BigDecimal getEntryPrice() { return entryPrice; }
    public BigDecimal getEntryNotional() { return entryNotional; }
    public Long getMergedIntoPositionId() { return mergedIntoPositionId; }
    public int getLeverage() { return leverage; }
    public BigDecimal getMargin() { return margin; }
    public Status getStatus() { return status; }
    public BigDecimal getRealizedPnl() { return realizedPnl; }
    public BigDecimal getExitPrice() { return exitPrice; }
    public Instant getOpenedAt() { return openedAt; }
    public Instant getClosedAt() { return closedAt; }
}
