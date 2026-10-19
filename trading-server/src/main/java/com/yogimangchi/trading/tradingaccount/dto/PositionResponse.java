package com.yogimangchi.trading.tradingaccount.dto;

import java.time.Instant;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Hedge Mode: at most one OPEN lifecycle per account/symbol/side. Additional fills preserve id/openedAt, update weighted average entryPrice and remaining quantity/margin. leverage is the current shared symbol setting. realizedPnl is cumulative; markPrice/unrealizedPnl are null unless FRESH. Fully closed lifecycles never reopen.")
public record PositionResponse(Long id, Long tradingSymbolId, String side, String quantity,
        @Schema(description="Quantity reserved by PENDING CLOSE orders, independent of wallet reservedMargin") String reservedCloseQuantity,
        @Schema(description="Remaining quantity minus reservedCloseQuantity; available for MARKET or new LIMIT CLOSE") String freeCloseQuantity,
        String entryPrice,
        int leverage, String margin, String status, String realizedPnl, String markPrice, String unrealizedPnl,
        String priceStatus, Instant priceEventTime, Instant openedAt) { }
