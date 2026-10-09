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
    @Column(nullable = false, precision = 28, scale = 8, updatable = false) private BigDecimal quantity;
    @Column(nullable = false, precision = 38, scale = 18, updatable = false) private BigDecimal entryPrice;
    @Column(nullable = false, updatable = false) private int leverage;
    @Column(nullable = false, precision = 38, scale = 18, updatable = false) private BigDecimal margin;
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
        position.entryPrice = TradingMath.amount(entryPrice);
        position.leverage = leverage;
        position.margin = TradingMath.margin(entryPrice, quantity, leverage);
        position.status = Status.OPEN;
        position.realizedPnl = TradingMath.amount(BigDecimal.ZERO);
        position.openedAt = Objects.requireNonNull(now);
        return position;
    }

    public BigDecimal close(BigDecimal price, Instant now, boolean liquidated) {
        if (status != Status.OPEN) throw new IllegalStateException("Position is already closed");
        if (price == null || price.signum() <= 0 || price.stripTrailingZeros().scale() > TradingMath.AMOUNT_SCALE) throw new IllegalArgumentException("Invalid close price");
        if (Objects.requireNonNull(now).isBefore(openedAt)) throw new IllegalArgumentException("Close time precedes open time");
        BigDecimal pnl = TradingMath.pnl(side, entryPrice, price, quantity);
        exitPrice = TradingMath.amount(price);
        realizedPnl = pnl;
        closedAt = now;
        status = liquidated ? Status.LIQUIDATED : Status.CLOSED;
        return pnl;
    }

    public Long getId() { return id; }
    public Long getAccountId() { return accountId; }
    public Long getTradingSymbolId() { return tradingSymbolId; }
    public Side getSide() { return side; }
    public BigDecimal getQuantity() { return quantity; }
    public BigDecimal getEntryPrice() { return entryPrice; }
    public int getLeverage() { return leverage; }
    public BigDecimal getMargin() { return margin; }
    public Status getStatus() { return status; }
    public BigDecimal getRealizedPnl() { return realizedPnl; }
    public BigDecimal getExitPrice() { return exitPrice; }
    public Instant getOpenedAt() { return openedAt; }
    public Instant getClosedAt() { return closedAt; }
}
