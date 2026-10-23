package com.yogimangchi.trading.tradehistory.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(description="One immutable execution, including partial closes and liquidation. positionId preserves the original fact; lifecyclePositionId follows the retained Hedge merge link. Amounts are decimal strings; realizedPnl is gross before fee/adjustment.")
public record FillHistoryResponse(Long fillId, Long orderId, Long positionId, Long lifecyclePositionId,
        Long tradingSymbolId, String type, String action, String side, int leverage, String quantity,
        String price, String realizedPnl, String fee, String settlementAdjustment, String marginMode,
        Instant priceEventTime, Instant executedAt) { }
