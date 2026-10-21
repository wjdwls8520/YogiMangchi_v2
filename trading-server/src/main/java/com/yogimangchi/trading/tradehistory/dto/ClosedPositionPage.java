package com.yogimangchi.trading.tradehistory.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

public record ClosedPositionPage(List<ClosedPositionResponse> items,
        @Schema(description="Opaque closedAt/id keyset cursor for the next page; null when exhausted. Keep filters unchanged", nullable=true) String nextCursor) { }
