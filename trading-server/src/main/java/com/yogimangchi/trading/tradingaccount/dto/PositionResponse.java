package com.yogimangchi.trading.tradingaccount.dto;

import java.time.Instant;
import io.swagger.v3.oas.annotations.media.Schema;
import com.yogimangchi.trading.tradingaccount.service.LiquidationPriceEstimator.Status;

@Schema(description = "Hedge Mode: at most one OPEN lifecycle per account/symbol/side. Additional fills preserve id/openedAt, update weighted average entryPrice and remaining quantity/margin. leverage is the current shared symbol setting. realizedPnl is cumulative; markPrice/unrealizedPnl are null unless FRESH. Fully closed lifecycles never reopen.")
public record PositionResponse(Long id, Long tradingSymbolId, String side, String quantity,
        @Schema(description="Quantity reserved by PENDING CLOSE orders, independent of wallet reservedMargin") String reservedCloseQuantity,
        @Schema(description="Remaining quantity minus reservedCloseQuantity; available for MARKET or new LIMIT CLOSE") String freeCloseQuantity,
        String entryPrice,
        int leverage, String margin, String status, String realizedPnl, String markPrice, String unrealizedPnl,
        String priceStatus, Instant priceEventTime, Instant openedAt,
        @Schema(description="This isolated POSITION's domain Mark risk threshold: collateral + rounded gross PnL <= rounded maintenance + 0.05% closing fee reserve. Independent of wallet unused cash, other symbols and the opposite side. Verified on the 18-decimal price grid with the actual engine formula. A gap executes at actual Mark, not at this display threshold. Null unless status is ESTIMATED_DOWNWARD/UPWARD", nullable=true, example="904.977375565610859728") String liquidationPrice,
        @Schema(description="ESTIMATED_DOWNWARD: LONG; ESTIMATED_UPWARD: SHORT. PRICE_UNAVAILABLE: this symbol lacks fresh data. NO_THRESHOLD: no positive supported-price boundary. UNSUPPORTED_MODEL: precision/range/search cannot certify a boundary. ALREADY_AT_RISK: this position already meets the isolated liquidation condition. MARGIN_MIGRATION_REQUIRED: legacy Cross exposure is held pending safe conversion or review; price is null") Status liquidationPriceStatus,
        @Schema(description="This symbol's server receivedAt, not the provider clock. Null when its price is unavailable or legacy conversion is incomplete", nullable=true) Instant liquidationPriceAsOf,
        @Schema(description="ISOLATED, or LEGACY_CROSS while trading is held for conversion/review. There is no selectable Cross mode", allowableValues={"ISOLATED","LEGACY_CROSS"}) String marginMode,
        @Schema(description="Historical model at this lifecycle's first entry: CROSS or ISOLATED. Conversion never rewrites opening facts") String openedMarginMode) { }
