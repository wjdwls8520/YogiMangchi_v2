package com.yogimangchi.trading.stoploss;

import java.math.BigDecimal;
import io.swagger.v3.oas.annotations.media.Schema;

public record StopLossRequest(
        @Schema(type="string",requiredMode=Schema.RequiredMode.REQUIRED,example="950",description="Positive domain Mark price, at most18 decimals/20 integer digits; no silent rounding. LONG below current fresh Mark, SHORT above it. Profit protection is allowed. Must precede current isolated liquidation risk") BigDecimal stopPrice,
        @Schema(requiredMode=Schema.RequiredMode.REQUIRED,description="Required latest stopLoss.version, initially0. A stale version returns409 STOP_LOSS_VERSION_CONFLICT; fetch latest before deliberate resubmission",minimum="0") Long expectedVersion) { }
