package com.yogimangchi.trading.leverage.repository;

import com.yogimangchi.trading.leverage.entity.SymbolLeverage;
import java.util.Optional;
import org.springframework.data.repository.Repository;

public interface SymbolLeverageRepository extends Repository<SymbolLeverage, Long> {
    Optional<SymbolLeverage> findByAccountIdAndTradingSymbolId(Long accountId, Long tradingSymbolId);
    SymbolLeverage save(SymbolLeverage setting);
}
