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
        @Schema(description="Conditional ACCOUNT risk threshold in this symbol's domain Mark Price. Other symbols stay at snapshot marks; this symbol's LONG/SHORT both move. First engine-risk price on the adverse side, verified with HALF_EVEN PnL and CEILING gross maintenance at 18 price decimals. Not a guaranteed execution price; intervening fills, asset changes or other prices change it. Same value for both directions of one symbol. Null unless status is ESTIMATED_DOWNWARD/ESTIMATED_UPWARD", nullable=true, example="904.522613065326633165") String liquidationPrice,
        @Schema(description="ESTIMATED_DOWNWARD/UPWARD: adverse price direction for ACCOUNT risk (not inferred from this row's side). PRICE_UNAVAILABLE: any held symbol lacks fresh data. NO_THRESHOLD: no positive supported-price boundary under frozen-other-mark assumptions. UNSUPPORTED_MODEL: precision/range or bounded search cannot certify a unique adverse boundary. ALREADY_AT_RISK: current equity <= gross maintenance; price is null") Status liquidationPriceStatus,
        @Schema(description="Oldest server receivedAt among ALL held-symbol marks used for this estimate; not the provider event clock. Null when required prices are unavailable. Account financial state is from this response's capturedAt snapshot", nullable=true) Instant liquidationPriceAsOf) { }
