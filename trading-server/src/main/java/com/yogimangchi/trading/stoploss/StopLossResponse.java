package com.yogimangchi.trading.stoploss;

import com.yogimangchi.trading.position.entity.Position;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(description="Full remaining position Mark-triggered market stop, without quantity reservation. LONG Mark<=stopPrice, SHORT Mark>=stopPrice. Actual crossing Mark is execution price, never a guaranteed stop price. Liquidation has priority across gaps. Version orders setting changes/termination, not partial fills; query current position quantity separately. An idempotent replay returns its original snapshot; GET latest state before editing again.")
public record StopLossResponse(Long positionId,Long tradingSymbolId,String side,
        @Schema(allowableValues={"NONE","ACTIVE","CANCELED","TRIGGERED","EXPIRED"}) String status,
        @Schema(nullable=true,description="Domain decimal string; null only for NONE. Internal supported price grid1e-18, not a Binance exchange tick-size claim") String stopPrice,
        long version,@Schema(nullable=true) Instant updatedAt,@Schema(nullable=true) Instant triggeredAt,
        @Schema(nullable=true) Instant priceEventTime,@Schema(nullable=true) String triggerPrice,
        @Schema(nullable=true) Long triggerOrderId,@Schema(nullable=true) String reason) {
    public static StopLossResponse from(Position position) {
        return new StopLossResponse(position.getId(),position.getTradingSymbolId(),position.getSide().name(),
                position.getStopLossStatus().name(),decimal(position.getStopLossPrice()),position.getStopLossVersion(),
                position.getStopLossUpdatedAt(),position.getStopLossTriggeredAt(),position.getStopLossPriceEventTime(),
                decimal(position.getStopLossTriggerPrice()),position.getStopLossTriggerOrderId(),position.getStopLossReason());
    }
    private static String decimal(java.math.BigDecimal value){return value==null?null:value.toPlainString();}
}
