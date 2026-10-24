package com.yogimangchi.trading.leverage.repository;

import com.yogimangchi.trading.leverage.entity.SymbolLeverage;
import java.util.Optional;
import com.yogimangchi.trading.position.entity.Position;
import org.springframework.data.repository.Repository;

public interface SymbolLeverageRepository extends Repository<SymbolLeverage, Long> {
    Optional<SymbolLeverage> findByAccountIdAndTradingSymbolIdAndSide(Long accountId, Long tradingSymbolId, Position.Side side);
    SymbolLeverage save(SymbolLeverage setting);
}
