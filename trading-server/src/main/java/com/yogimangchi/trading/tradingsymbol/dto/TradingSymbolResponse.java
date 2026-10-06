package com.yogimangchi.trading.tradingsymbol.dto;

import io.swagger.v3.oas.annotations.media.Schema;

public record TradingSymbolResponse(
        @Schema(description = "Provider Symbol 변경과 무관하게 유지되는 내부 종목 ID", example = "1")
        Long id,
        @Schema(example = "BTC") String symbol,
        @Schema(example = "Bitcoin") String name,
        @Schema(example = "USDT") String quoteAsset,
        @Schema(description = "화면 표시용 거래쌍", example = "BTC / USDT") String displaySymbol
) {
    public TradingSymbolResponse(Long id, String symbol, String name, String quoteAsset) {
        this(id, symbol, name, quoteAsset, symbol + " / " + quoteAsset);
    }
}
