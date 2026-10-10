package com.yogimangchi.trading.binance.subscription;

import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolProvider;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class BinanceSubscriptionTargetLoader {

    private final BinanceSubscriptionTargetRepository repository;

    public BinanceSubscriptionTargetLoader(BinanceSubscriptionTargetRepository repository) {
        this.repository = repository;
    }

    public List<BinanceSubscriptionTarget> loadActiveTargets() {
        return repository.findAllByStatusAndProvider(
                TradingSymbolStatus.ACTIVE, TradingSymbolProvider.BINANCE);
    }
}
