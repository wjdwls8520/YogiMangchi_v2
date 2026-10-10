package com.yogimangchi.trading.order.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;

public record LimitCloseRequest(
        @Schema(type = "string", example = "0.01", description = "Positive domain quantity, maximum 8 decimals. Omit to reserve the entire remaining lot; existing reservations may cause 409.")
        BigDecimal quantity,
        @Schema(type = "string", example = "70000", description = "Required positive USDT limit, maximum 18 decimals. LONG CLOSE triggers at or above; SHORT CLOSE at or below. Execution uses the triggering server Mark.")
        BigDecimal limitPrice) { }
