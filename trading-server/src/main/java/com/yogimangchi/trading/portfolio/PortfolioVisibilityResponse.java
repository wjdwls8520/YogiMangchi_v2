package com.yogimangchi.trading.portfolio;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(description = "Current public visibility setting for the authenticated member's simulation portfolio.")
public record PortfolioVisibilityResponse(
        Long memberId,
        boolean portfolioPublic,
        @Schema(nullable = true, description = "Timestamp of last explicit update; null when using default true")
        Instant updatedAt) { }
