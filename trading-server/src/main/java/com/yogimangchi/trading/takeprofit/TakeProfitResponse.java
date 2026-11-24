package com.yogimangchi.trading.takeprofit;

import com.yogimangchi.trading.position.entity.Position;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;

@Schema(description = "Full remaining position Mark-triggered market take profit, without quantity reservation. LONG Mark>=takeProfitPrice, SHORT Mark<=takeProfitPrice. Actual crossing Mark is execution price.")
public record TakeProfitResponse(
        Long positionId,
        Long tradingSymbolId,
        String side,
        @Schema(allowableValues = {"NONE", "ACTIVE", "CANCELED", "TRIGGERED", "EXPIRED"}) String status,
        @Schema(nullable = true, description = "Domain decimal string; null only for NONE.") String takeProfitPrice,
        long version,
        @Schema(nullable = true) Instant updatedAt,
        @Schema(nullable = true) Instant triggeredAt,
        @Schema(nullable = true) Instant priceEventTime,
        @Schema(nullable = true) String triggerPrice,
        @Schema(nullable = true) Long triggerOrderId,
        @Schema(nullable = true) String reason) {

    public static TakeProfitResponse from(PositionTakeProfit tp) {
        return new TakeProfitResponse(
                tp.getPositionId(),
                tp.getTradingSymbolId(),
                tp.getSide().name(),
                tp.getStatus().name(),
                decimal(tp.getTakeProfitPrice()),
                tp.getVersion(),
                tp.getUpdatedAt(),
                tp.getTriggeredAt(),
                tp.getPriceEventTime(),
                decimal(tp.getTriggerPrice()),
                tp.getTriggerOrderId(),
                tp.getReason());
    }

    public static TakeProfitResponse none(Position position) {
        return new TakeProfitResponse(
                position.getId(),
                position.getTradingSymbolId(),
                position.getSide().name(),
                PositionTakeProfit.Status.NONE.name(),
                null,
                0L,
                null,
                null,
                null,
                null,
                null,
                null);
    }

    private static String decimal(BigDecimal value) {
        return value == null ? null : value.toPlainString();
    }
}
