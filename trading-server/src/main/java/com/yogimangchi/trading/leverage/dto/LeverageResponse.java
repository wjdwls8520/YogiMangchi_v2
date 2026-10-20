package com.yogimangchi.trading.leverage.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

public record LeverageResponse(Long tradingSymbolId, int leverage, int maxLeverage,
        @Schema(allowableValues={"ISOLATED","LEGACY_CROSS"}) String marginMode,
        @Schema(description = "Null for the implicit default 10x; GET does not persist a setting") Instant updatedAt,
        @Schema(description = "Legacy Cross accounts cannot submit financial trades until conversion completes", allowableValues={"COMPLETE","PENDING","REVIEW_REQUIRED"}) String marginTransitionStatus) { }
