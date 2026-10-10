package com.yogimangchi.trading.order.entity;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.position.entity.Position;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "trading_order")
public class TradingOrder {
    public enum Type { MARKET, LIMIT }
    public enum Action { OPEN, CLOSE, LIQUIDATE }
    public enum Status { PENDING, FILLED, CANCELED, REJECTED }
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false) private Long accountId;
    private Long positionId;
    @Column(nullable = false) private Long tradingSymbolId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 8) private Position.Side side;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private Type type;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private Action action;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private Status status;
    @Column(nullable = false, precision = 28, scale = 8) private BigDecimal quantity;
    @Column(nullable = false) private int leverage;
    @Column(precision = 38, scale = 18) private BigDecimal filledPrice;
    @Column(precision = 38, scale = 18) private BigDecimal limitPrice;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal reservedMargin;
    private Instant completedAt;
    @Column(length = 64) private String reason;
    @Column(nullable = false, length = 100) private String idempotencyKey;
    @Column(nullable = false, length = 64) private String requestFingerprint;
    @Column(nullable = false) private Instant createdAt;
    protected TradingOrder() { }

    public static TradingOrder market(Position position, Action action, BigDecimal price,
            String key, String fingerprint, Instant now) {
        TradingOrder order = new TradingOrder();
        order.accountId = position.getAccountId();
        order.positionId = position.getId();
        order.tradingSymbolId = position.getTradingSymbolId();
        order.side = position.getSide();
        order.type = Type.MARKET;
        order.action = action;
        order.status = Status.FILLED;
        order.quantity = position.getQuantity();
        order.leverage = position.getLeverage();
        order.filledPrice = TradingMath.amount(price);
        order.idempotencyKey = key;
        order.requestFingerprint = fingerprint;
        order.createdAt = now;
        order.completedAt = now;
        order.reservedMargin = TradingMath.amount(BigDecimal.ZERO);
        return order;
    }

    public static TradingOrder limit(Long accountId, Long symbolId, Position.Side side, BigDecimal quantity,
            int leverage, BigDecimal limitPrice, String key, String fingerprint, Instant now) {
        TradingOrder order = new TradingOrder();
        order.reservedMargin = TradingMath.margin(limitPrice, quantity, leverage);
        order.accountId = accountId;
        order.tradingSymbolId = symbolId;
        order.side = side;
        order.type = Type.LIMIT;
        order.action = Action.OPEN;
        order.status = Status.PENDING;
        order.quantity = quantity.setScale(TradingMath.QUANTITY_SCALE);
        order.leverage = leverage;
        order.limitPrice = TradingMath.amount(limitPrice);
        order.idempotencyKey = key;
        order.requestFingerprint = fingerprint;
        order.createdAt = now;
        return order;
    }

    public boolean crosses(BigDecimal price) {
        return status == Status.PENDING && (side == Position.Side.LONG
                ? price.compareTo(limitPrice) <= 0 : price.compareTo(limitPrice) >= 0);
    }
    public void fill(Position position, BigDecimal price, Instant now) {
        requirePending();
        if (!crosses(price) || !position.getAccountId().equals(accountId)
                || !position.getTradingSymbolId().equals(tradingSymbolId)) throw new IllegalArgumentException("Invalid limit fill");
        positionId = position.getId();
        filledPrice = TradingMath.amount(price);
        finish(Status.FILLED, null, now);
    }
    public void cancel(Instant now) { requirePending(); finish(Status.CANCELED, "CLIENT_CANCEL", now); }
    public void reject(String reason, Instant now) { requirePending(); finish(Status.REJECTED, reason, now); }
    private void requirePending() { if (status != Status.PENDING) throw new IllegalStateException("Order is not pending"); }
    private void finish(Status status, String reason, Instant now) {
        this.status = status; this.reason = reason; this.completedAt = now;
        this.reservedMargin = TradingMath.amount(BigDecimal.ZERO);
    }

    public Long getId() { return id; }
    public Long getAccountId() { return accountId; }
    public Long getPositionId() { return positionId; }
    public Long getTradingSymbolId() { return tradingSymbolId; }
    public Position.Side getSide() { return side; }
    public Type getType() { return type; }
    public Action getAction() { return action; }
    public Status getStatus() { return status; }
    public BigDecimal getQuantity() { return quantity; }
    public int getLeverage() { return leverage; }
    public BigDecimal getFilledPrice() { return filledPrice; }
    public String getRequestFingerprint() { return requestFingerprint; }
    public Instant getCreatedAt() { return createdAt; }
    public BigDecimal getLimitPrice() { return limitPrice; }
    public BigDecimal getReservedMargin() { return reservedMargin; }
    public Instant getCompletedAt() { return completedAt; }
    public String getReason() { return reason; }
}
