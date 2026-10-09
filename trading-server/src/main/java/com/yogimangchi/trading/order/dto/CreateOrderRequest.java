package com.yogimangchi.trading.order.dto;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import java.math.BigDecimal;
import io.swagger.v3.oas.annotations.media.Schema;
public record CreateOrderRequest(TradingOrder.Type type, Long tradingSymbolId, Position.Side side,
        @Schema(type = "string", example = "0.001", description = "Domain asset quantity, maximum 8 decimal places") BigDecimal quantity,
        Integer leverage) { }

