package com.yogimangchi.trading.leverage.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import com.yogimangchi.trading.position.entity.Position;

public record LeverageResponse(Long tradingSymbolId, Position.Side side, int leverage, int maxLeverage,
        @Schema(allowableValues={"ISOLATED","LEGACY_CROSS"}) String marginMode,
        @Schema(description = "Null for the implicit default 1x when this account/symbol/side has no saved setting; GET does not persist a setting. Existing saved settings and exposure leverage are preserved") Instant updatedAt,
        @Schema(description = "Legacy Cross accounts cannot submit financial trades until conversion completes", allowableValues={"COMPLETE","PENDING","REVIEW_REQUIRED"}) String marginTransitionStatus) { }
