package com.yogimangchi.trading.leverage.entity;

import com.yogimangchi.trading.execution.TradingMath;
import jakarta.persistence.*;
import com.yogimangchi.trading.position.entity.Position;
import java.util.Objects;
import java.time.Instant;

@Entity
@Table(name = "symbol_leverage", uniqueConstraints = @UniqueConstraint(columnNames = {"account_id", "trading_symbol_id", "side"}))
public class SymbolLeverage {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false, updatable = false) private Long accountId;
    @Column(nullable = false, updatable = false) private Long tradingSymbolId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, updatable = false, length = 5) private Position.Side side;
    @Column(nullable = false) private int leverage;
    @Column(nullable = false) private Instant updatedAt;
    protected SymbolLeverage() { }
    public static SymbolLeverage configure(Long accountId, Long symbolId, Position.Side side, int leverage, Instant now) {
        SymbolLeverage setting = new SymbolLeverage();
        setting.accountId = accountId; setting.tradingSymbolId = symbolId;
        setting.side = Objects.requireNonNull(side);
        setting.change(leverage, now);
        return setting;
    }
    public void change(int leverage, Instant now) {
        TradingMath.validateLeverage(leverage);
        this.leverage = leverage; this.updatedAt = now;
    }
    public int getLeverage() { return leverage; }
    public Instant getUpdatedAt() { return updatedAt; }
}
