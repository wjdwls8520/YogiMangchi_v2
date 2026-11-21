package com.yogimangchi.trading.order.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Atomic batch cancellation result for all PENDING orders of the account.")
public record CancelAllOrdersResponse(
        int canceledCount,
        List<OrderResponse> orders) { }
