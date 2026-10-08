package com.yogimangchi.trading.binance.markprice;

import java.math.BigDecimal;
import java.time.Instant;

record BinanceMarkPriceEvent(Long tradingSymbolId, String symbol, String providerSymbol,
                             BigDecimal markPrice, Instant eventTime, Instant receivedAt) {
}
