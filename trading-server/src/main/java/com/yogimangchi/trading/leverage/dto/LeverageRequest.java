package com.yogimangchi.trading.leverage.dto;

import com.yogimangchi.trading.position.entity.Position;
import io.swagger.v3.oas.annotations.media.Schema;

public record LeverageRequest(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) Position.Side side, @Schema(minimum = "1", maximum = "100", example = "14") Integer leverage) { }
