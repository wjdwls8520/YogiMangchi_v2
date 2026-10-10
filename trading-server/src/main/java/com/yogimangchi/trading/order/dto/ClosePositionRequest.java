package com.yogimangchi.trading.order.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;

public record ClosePositionRequest(
        @Schema(type = "string", example = "0.01", description = "Quantity to close, maximum 8 decimal places. Omit for the entire remaining lot.")
        BigDecimal quantity) { }
