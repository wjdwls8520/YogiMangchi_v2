package com.yogimangchi.trading.tradingaccount.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

public record GuestAccountResponse(Long accountId, String status, String quoteAsset, String initialBalance,
        @Schema(description = "256-bit opaque guest credential. Returned once; send as Authorization: Bearer <token>.") String accessToken,
        String tokenType, Instant expiresAt) { }
