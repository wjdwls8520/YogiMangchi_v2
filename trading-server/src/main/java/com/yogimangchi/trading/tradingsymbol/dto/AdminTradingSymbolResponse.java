package com.yogimangchi.trading.tradingsymbol.dto;

import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolProvider;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import io.swagger.v3.oas.annotations.media.Schema;

public record AdminTradingSymbolResponse(
        @Schema(example = "1") Long id,
        @Schema(example = "BTC") String symbol,
        @Schema(example = "Bitcoin") String name,
        @Schema(example = "USDT") String quoteAsset,
        @Schema(example = "BTC / USDT") String displaySymbol,
        @Schema(example = "BINANCE") TradingSymbolProvider provider,
        @Schema(example = "BTCUSDT") String providerSymbol,
        @Schema(example = "1") long providerUnitMultiplier,
        @Schema(example = "ACTIVE") TradingSymbolStatus status
) {
    public static AdminTradingSymbolResponse from(TradingSymbol entity) {
        return new AdminTradingSymbolResponse(
                entity.getId(),
                entity.getSymbol(),
                entity.getName(),
                entity.getQuoteAsset(),
                entity.getSymbol() + " / " + entity.getQuoteAsset(),
                entity.getProvider(),
                entity.getProviderSymbol(),
                entity.getProviderUnitMultiplier(),
                entity.getStatus());
    }
}
