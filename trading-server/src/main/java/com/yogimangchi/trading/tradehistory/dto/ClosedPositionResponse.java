package com.yogimangchi.trading.tradehistory.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(description="One completed Position lifecycle, not one order. initialQuantity is total entered quantity; entryPrice is the final displayed remaining-basis average and exitPrice is the final Fill, not a weighted lifetime exit. realizedPnl is gross; netRealizedPnl subtracts all lifecycle OPEN/CLOSE fees and adds isolated settlement adjustments. Historical merged facts are included without rewriting their IDs.")
public record ClosedPositionResponse(Long positionId, Long tradingSymbolId, String side, String status,
        String initialQuantity, String entryPrice, String exitPrice, int leverage,
        @Schema(description="Cumulative collateral allocated by entries; leverage changes do not rewrite this history") String initialMargin,
        String realizedPnl, String feesPaid, String settlementAdjustment, String netRealizedPnl,
        String openedMarginMode, String closingMarginMode, Instant openedAt, Instant closedAt) { }
