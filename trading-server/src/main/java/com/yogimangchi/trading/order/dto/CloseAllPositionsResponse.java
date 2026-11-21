package com.yogimangchi.trading.order.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Atomic batch market-close result for all OPEN positions of the account.")
public record CloseAllPositionsResponse(
        int closedCount,
        List<OrderResponse> orders) { }
