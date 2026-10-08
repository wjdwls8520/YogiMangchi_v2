package com.yogimangchi.trading.binance.subscription;

import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;

public record BinanceSubscriptionTarget(Long tradingSymbolId, String symbol, String providerSymbol,
                                        long providerUnitMultiplier) {
    public BinanceSubscriptionTarget {
        TradingSymbol.requireProviderUnitMultiplier(providerUnitMultiplier);
    }
}
