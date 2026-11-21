package com.yogimangchi.trading.takeprofit;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.position.entity.Position;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;

/** Full remaining position Mark-triggered take profit lifecycle, 1:1 with Position. */
@Entity
@Table(name = "position_take_profit")
public class PositionTakeProfit {
    public enum Status { NONE, ACTIVE, CANCELED, TRIGGERED, EXPIRED }

    @Id
    private Long positionId;

    @Column(nullable = false, updatable = false)
    private Long accountId;

    @Column(nullable = false, updatable = false)
    private Long tradingSymbolId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8, updatable = false)
    private Position.Side side;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status = Status.NONE;

    @Column(precision = 38, scale = 18)
    private BigDecimal takeProfitPrice;

    @Column(nullable = false)
    private long version;

    private Instant updatedAt;
    private Instant triggeredAt;
    private Instant priceEventTime;

    @Column(precision = 38, scale = 18)
    private BigDecimal triggerPrice;

    private Long triggerOrderId;

    @Column(length = 32)
    private String reason;

    protected PositionTakeProfit() { }

    public static PositionTakeProfit createFor(Position position) {
        Objects.requireNonNull(position, "position");
        PositionTakeProfit tp = new PositionTakeProfit();
        tp.positionId = Objects.requireNonNull(position.getId(), "position.id");
        tp.accountId = Objects.requireNonNull(position.getAccountId(), "position.accountId");
        tp.tradingSymbolId = Objects.requireNonNull(position.getTradingSymbolId(), "position.tradingSymbolId");
        tp.side = Objects.requireNonNull(position.getSide(), "position.side");
        tp.status = Status.NONE;
        tp.version = 0L;
        return tp;
    }

    public void configure(Position position, BigDecimal price, Instant now) {
        if (position.getStatus() != Position.Status.OPEN) {
            throw new IllegalStateException("Take profit requires an open position");
        }
        TradingMath.validatePrice(price);
        this.takeProfitPrice = TradingMath.amount(price);
        this.status = Status.ACTIVE;
        this.version = Math.incrementExact(this.version);
        this.updatedAt = Objects.requireNonNull(now);
        this.triggeredAt = null;
        this.priceEventTime = null;
        this.triggerPrice = null;
        this.triggerOrderId = null;
        this.reason = null;
    }

    public void cancel(Instant now) {
        if (this.status != Status.ACTIVE) {
            return;
        }
        this.status = Status.CANCELED;
        this.reason = "CLIENT_CANCEL";
        this.version = Math.incrementExact(this.version);
        this.updatedAt = Objects.requireNonNull(now);
    }

    public boolean expire(String expireReason, Instant now) {
        if (this.status != Status.ACTIVE) {
            return false;
        }
        this.status = Status.EXPIRED;
        this.reason = Objects.requireNonNull(expireReason);
        this.version = Math.incrementExact(this.version);
        this.updatedAt = Objects.requireNonNull(now);
        return true;
    }

    public boolean crosses(Position position, BigDecimal mark, Instant receivedAt) {
        return position.getStatus() == Position.Status.OPEN
                && this.status == Status.ACTIVE
                && !receivedAt.isBefore(this.updatedAt)
                && !receivedAt.isBefore(position.getOpenedAt())
                && (this.side == Position.Side.LONG
                        ? mark.compareTo(this.takeProfitPrice) >= 0
                        : mark.compareTo(this.takeProfitPrice) <= 0);
    }

    public void markTriggered(BigDecimal mark, Instant eventTime, Instant now) {
        if (this.status != Status.ACTIVE) {
            throw new IllegalStateException("Take profit is no longer active");
        }
        this.status = Status.TRIGGERED;
        this.reason = "TAKE_PROFIT";
        this.version = Math.incrementExact(this.version);
        this.updatedAt = Objects.requireNonNull(now);
        this.triggeredAt = now;
        this.priceEventTime = Objects.requireNonNull(eventTime).truncatedTo(ChronoUnit.MICROS);
        this.triggerPrice = TradingMath.amount(mark);
    }

    public void linkOrder(Long orderId) {
        if (this.status != Status.TRIGGERED || this.triggerOrderId != null || orderId == null) {
            throw new IllegalStateException("Take profit execution already linked or missing");
        }
        this.triggerOrderId = orderId;
    }

    public Long getPositionId() { return positionId; }
    public Long getAccountId() { return accountId; }
    public Long getTradingSymbolId() { return tradingSymbolId; }
    public Position.Side getSide() { return side; }
    public Status getStatus() { return status; }
    public BigDecimal getTakeProfitPrice() { return takeProfitPrice; }
    public long getVersion() { return version; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Instant getTriggeredAt() { return triggeredAt; }
    public Instant getPriceEventTime() { return priceEventTime; }
    public BigDecimal getTriggerPrice() { return triggerPrice; }
    public Long getTriggerOrderId() { return triggerOrderId; }
    public String getReason() { return reason; }
}
