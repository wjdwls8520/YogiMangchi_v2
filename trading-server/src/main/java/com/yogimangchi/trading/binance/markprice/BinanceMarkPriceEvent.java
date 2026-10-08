package com.yogimangchi.trading.binance.markprice;

import java.math.BigDecimal;
import java.time.Instant;

record BinanceMarkPriceEvent(Long tradingSymbolId, String symbol, String providerSymbol,
                             BigDecimal providerMarkPrice, BigDecimal domainMarkPrice,
                             Instant eventTime, Instant receivedAt) {
}
