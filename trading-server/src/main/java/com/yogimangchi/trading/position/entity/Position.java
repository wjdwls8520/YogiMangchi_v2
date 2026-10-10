package com.yogimangchi.trading.position.entity;

import com.yogimangchi.trading.execution.TradingMath;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;

/** Each fill opens an independent lot; all lots share the account's cross-margin USDT wallet. */
@Entity
@Table(name = "position")
public class Position {
    public enum Side { LONG, SHORT }
    public enum Status { OPEN, CLOSED, LIQUIDATED }

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false, updatable = false) private Long accountId;
    @Column(nullable = false, updatable = false) private Long tradingSymbolId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 8, updatable = false) private Side side;
    @Column(nullable = false, precision = 28, scale = 8) private BigDecimal quantity;
    @Column(nullable = false, precision = 28, scale = 8, updatable = false) private BigDecimal initialQuantity;
    @Column(nullable = false, precision = 28, scale = 8) private BigDecimal reservedCloseQuantity;
    @Column(nullable = false, precision = 38, scale = 18, updatable = false) private BigDecimal entryPrice;
    @Column(nullable = false, updatable = false) private int leverage;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal margin;
    @Column(nullable = false, precision = 38, scale = 18, updatable = false) private BigDecimal initialMargin;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private Status status;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal realizedPnl;
    @Column(precision = 38, scale = 18) private BigDecimal exitPrice;
    @Column(nullable = false, updatable = false) private Instant openedAt;
    private Instant closedAt;

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
        position.leverage = leverage;
        position.margin = TradingMath.margin(entryPrice, quantity, leverage);
        position.initialMargin = position.margin;
        position.status = Status.OPEN;
        position.realizedPnl = TradingMath.amount(BigDecimal.ZERO);
        position.openedAt = Objects.requireNonNull(now);
        return position;
    }

    public record Settlement(BigDecimal quantity, BigDecimal releasedMargin, BigDecimal realizedPnl) { }

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
        BigDecimal pnl = TradingMath.pnl(side, entryPrice, price, closingQuantity);
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
    public Long getAccountId() { return accountId; }
    public Long getTradingSymbolId() { return tradingSymbolId; }
    public Side getSide() { return side; }
    public BigDecimal getQuantity() { return quantity; }
    public BigDecimal getInitialQuantity() { return initialQuantity; }
    public BigDecimal getReservedCloseQuantity() { return reservedCloseQuantity; }
    public BigDecimal getFreeCloseQuantity() { return quantity.subtract(reservedCloseQuantity); }
    public BigDecimal getInitialMargin() { return initialMargin; }
    public BigDecimal getEntryPrice() { return entryPrice; }
    public int getLeverage() { return leverage; }
    public BigDecimal getMargin() { return margin; }
    public Status getStatus() { return status; }
    public BigDecimal getRealizedPnl() { return realizedPnl; }
    public BigDecimal getExitPrice() { return exitPrice; }
    public Instant getOpenedAt() { return openedAt; }
    public Instant getClosedAt() { return closedAt; }
}
