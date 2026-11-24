package com.yogimangchi.trading.tradingsymbol.dto;

import io.swagger.v3.oas.annotations.media.Schema;

public record AdminSymbolStatusRequest(
        @Schema(description = "Target symbol status: ACTIVE or HALTED", example = "HALTED")
        String status
) { }
