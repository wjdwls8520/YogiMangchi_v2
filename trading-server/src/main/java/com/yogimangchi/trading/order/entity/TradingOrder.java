package com.yogimangchi.trading.order.entity;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.position.entity.Position;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "trading_order")
public class TradingOrder {
    public enum Type { MARKET }
    public enum Action { OPEN, CLOSE }
    public enum Status { FILLED }
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false) private Long accountId;
    @Column(nullable = false) private Long positionId;
    @Column(nullable = false) private Long tradingSymbolId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 8) private Position.Side side;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private Type type;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private Action action;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private Status status;
    @Column(nullable = false, precision = 28, scale = 8) private BigDecimal quantity;
    @Column(nullable = false) private int leverage;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal filledPrice;
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
        return order;
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
}

