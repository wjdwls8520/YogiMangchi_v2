package com.yogimangchi.trading.leverage.dto;

import io.swagger.v3.oas.annotations.media.Schema;

public record LeverageRequest(@Schema(minimum = "1", maximum = "100", example = "14") Integer leverage) { }
