package com.yogimangchi.trading.order.dto;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.fill.entity.Fill;
import java.time.Instant;
import io.swagger.v3.oas.annotations.media.Schema;
public record OrderResponse(Long orderId, Long positionId, Long tradingSymbolId, String type, String action,
        String side, String status, String quantity, int leverage, String limitPrice, String reservedMargin, String reservedCloseQuantity,
        Instant createdAt, Instant completedAt, String reason, FillResponse fill,
        @Schema(description = "Immutable leverage at submission; leverage is the effective PENDING OPEN value, or the execution snapshot once FILLED") int requestedLeverage,
        @Schema(description = "Legacy target of a PENDING CLOSE reassigned during Hedge migration; null otherwise. Completed historical positionId values are preserved") Long originalPositionId) {
    public record FillResponse(Long fillId, String quantity, String price, Instant priceEventTime, Instant executedAt, String realizedPnl) { }
    public static OrderResponse from(TradingOrder order, Fill fill) {
        return new OrderResponse(order.getId(), order.getPositionId(), order.getTradingSymbolId(), order.getType().name(),
                order.getAction().name(), order.getSide().name(), order.getStatus().name(),
                order.getQuantity().toPlainString(), order.getLeverage(),
                order.getLimitPrice() == null ? null : order.getLimitPrice().toPlainString(), order.getReservedMargin().toPlainString(),
                order.getAction() == TradingOrder.Action.CLOSE && order.getStatus() == TradingOrder.Status.PENDING
                        ? order.getQuantity().toPlainString() : "0.00000000",
                order.getCreatedAt(), order.getCompletedAt(), order.getReason(),
                fill == null ? null : new FillResponse(fill.getId(), fill.getQuantity().toPlainString(), fill.getPrice().toPlainString(),
                        fill.getPriceEventTime(), fill.getExecutedAt(), fill.getRealizedPnl().toPlainString()),
                order.getRequestedLeverage(), order.getOriginalPositionId());
    }
}
