package com.yogimangchi.trading.portfolio;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Update public visibility preference for the authenticated member's simulation portfolio.")
public record PortfolioVisibilityRequest(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "true to allow public visitors to view portfolio; false to restrict to owner and admins only")
        Boolean portfolioPublic) { }
