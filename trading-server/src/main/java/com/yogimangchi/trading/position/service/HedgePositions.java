package com.yogimangchi.trading.position.service;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Component;

/** MARKET and LIMIT fills share this domain path. Caller holds AccountLock and one financial transaction. */
@Component
public class HedgePositions {
    private final PositionRepository positions;
    public HedgePositions(PositionRepository positions) { this.positions = positions; }

    public Position existing(List<Position> open, Long symbolId, Position.Side side) {
        return open.stream().filter(p -> p.getTradingSymbolId().equals(symbolId) && p.getSide() == side).findFirst().orElse(null);
    }

    public BigDecimal additionalMargin(List<Position> open, Long symbolId, Position.Side side,
            BigDecimal quantity, BigDecimal price, int leverage) {
        TradingMath.validateOrder(quantity, leverage, price);
        Position target = existing(open, symbolId, side);
        if (target == null) return TradingMath.margin(price, quantity, leverage);
        if (target.getLeverage() != leverage) throw new IllegalStateException("Position leverage differs from symbol setting");
        TradingMath.validateQuantity(target.getQuantity().add(quantity));
        BigDecimal basis = target.getEntryNotional().add(price.multiply(quantity));
        if (basis.compareTo(TradingMath.MAX_NOTIONAL) > 0) throw new IllegalArgumentException("Position notional limit exceeded");
        return TradingMath.basisMargin(basis, leverage).subtract(target.getMargin());
    }

    public Position apply(List<Position> open, Long accountId, Long symbolId, Position.Side side,
            BigDecimal quantity, BigDecimal price, int leverage, Instant now) {
        Position target = existing(open, symbolId, side);
        if (target != null) { target.increase(quantity, price); return target; }
        target = positions.save(Position.open(accountId, symbolId, side, quantity, price, leverage, now));
        open.add(target);
        return target;
    }
}
