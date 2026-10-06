package com.yogimangchi.trading.binance.subscription;

public record BinanceSubscriptionTarget(Long tradingSymbolId, String symbol, String providerSymbol) {
}
