package com.yogimangchi.trading.order.dto;

import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;

public record OrderQuoteRequest(TradingOrder.Type type, Long tradingSymbolId, Position.Side side,
        @Schema(type="string", description="Exactly one of quantity or balancePercentage. Domain quantity, at most 8 decimals") BigDecimal quantity,
        @Schema(minimum="1", maximum="100", description="Integer percent of server free cash to spend including OPEN fee; quantity is rounded down by the server") Integer balancePercentage,
        @Schema(type="string", description="LIMIT only; same passive-price rule as order submission") BigDecimal limitPrice) { }
