package com.yogimangchi.trading.order.dto;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import java.math.BigDecimal;
import io.swagger.v3.oas.annotations.media.Schema;
@Schema(description = "OPEN or add to one Hedge Mode position per account/symbol/side. Opposite directions coexist. Use CLOSE endpoints to reduce exposure; completed Order/Fill histories remain separate.")
public record CreateOrderRequest(TradingOrder.Type type, Long tradingSymbolId, Position.Side side,
        @Schema(type = "string", example = "0.001", description = "Domain quantity, maximum 8 decimals; new OPEN admission notional 10-1000000 USDT including both boundary values. Fee is additional to margin") BigDecimal quantity,
        @Schema(minimum = "1", maximum = "100", description = "Required. Must match the server's account/symbol/side setting (1 if unsaved); otherwise 409 LEVERAGE_MISMATCH. Existing saved settings are preserved. Change it explicitly with PUT leverage first") Integer leverage,
        @Schema(type = "string", example = "60000", description = "Required only for LIMIT. At submission, LONG must be strictly below the fresh Mark Price and SHORT strictly above it; otherwise 409 MARKETABLE_LIMIT_NOT_ALLOWED. Margin uses limitPrice, not Mark Price. Accepted LONG fills at or below; SHORT at or above this price") BigDecimal limitPrice,
        @Schema(type = "string", nullable = true, example = "58000", description = "Optional stop-loss price for immediate MARKET OPEN fill. Must be protective relative to fresh Mark and strictly precede isolated liquidation risk; otherwise the entire order rolls back.") BigDecimal stopLossPrice,
        @Schema(type = "string", nullable = true, example = "65000", description = "Optional take-profit price for immediate MARKET OPEN fill. Must be strictly profitable relative to fresh Mark; otherwise the entire order rolls back.") BigDecimal takeProfitPrice) {
    public CreateOrderRequest(TradingOrder.Type type, Long tradingSymbolId, Position.Side side,
            BigDecimal quantity, Integer leverage, BigDecimal limitPrice) {
        this(type, tradingSymbolId, side, quantity, leverage, limitPrice, null, null);
    }
}
