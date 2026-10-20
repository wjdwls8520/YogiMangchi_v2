package com.yogimangchi.trading.fill.entity;

import com.yogimangchi.trading.execution.TradingMath;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "fill")
public class Fill {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false) private Long orderId;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal price;
    @Column(nullable = false, precision = 28, scale = 8) private BigDecimal quantity;
    @Column(nullable = false) private Instant priceEventTime;
    @Column(nullable = false) private Instant executedAt;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal realizedPnl;
    @Column(nullable = false, length = 8) private String marginMode;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal fee;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal settlementAdjustment;
    protected Fill() { }

    public static Fill execute(Long orderId, BigDecimal price, BigDecimal quantity,
            Instant priceEventTime, Instant executedAt, BigDecimal realizedPnl) {
        return execute(orderId, price, quantity, priceEventTime, executedAt, realizedPnl, BigDecimal.ZERO, BigDecimal.ZERO);
    }

    public static Fill execute(Long orderId, BigDecimal price, BigDecimal quantity,
            Instant priceEventTime, Instant executedAt, BigDecimal realizedPnl, BigDecimal fee, BigDecimal adjustment) {
        Fill fill = new Fill();
        fill.orderId = orderId;
        fill.price = TradingMath.amount(price);
        fill.quantity = quantity.setScale(TradingMath.QUANTITY_SCALE);
        fill.priceEventTime = priceEventTime.truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        fill.executedAt = executedAt;
        fill.realizedPnl = TradingMath.amount(realizedPnl);
        fill.marginMode = "ISOLATED";
        fill.fee = TradingMath.amount(fee);
        fill.settlementAdjustment = TradingMath.amount(adjustment);
        if (fill.fee.signum() < 0 || fill.settlementAdjustment.signum() < 0) throw new IllegalArgumentException("Invalid execution costs");
        return fill;
    }
    public Long getId() { return id; }
    public Long getOrderId() { return orderId; }
    public BigDecimal getPrice() { return price; }
    public BigDecimal getQuantity() { return quantity; }
    public Instant getPriceEventTime() { return priceEventTime; }
    public Instant getExecutedAt() { return executedAt; }
    public BigDecimal getRealizedPnl() { return realizedPnl; }
    public String getMarginMode() { return marginMode; }
    public BigDecimal getFee() { return fee; }
    public BigDecimal getSettlementAdjustment() { return settlementAdjustment; }
}

