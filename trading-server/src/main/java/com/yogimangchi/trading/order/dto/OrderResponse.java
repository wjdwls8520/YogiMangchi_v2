package com.yogimangchi.trading.order.dto;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.fill.entity.Fill;
import java.time.Instant;
public record OrderResponse(Long orderId, Long positionId, Long tradingSymbolId, String type, String action,
        String side, String status, String quantity, int leverage, String limitPrice, String reservedMargin,
        Instant createdAt, Instant completedAt, String reason, FillResponse fill) {
    public record FillResponse(Long fillId, String quantity, String price, Instant priceEventTime, Instant executedAt, String realizedPnl) { }
    public static OrderResponse from(TradingOrder order, Fill fill) {
        return new OrderResponse(order.getId(), order.getPositionId(), order.getTradingSymbolId(), order.getType().name(),
                order.getAction().name(), order.getSide().name(), order.getStatus().name(),
                order.getQuantity().toPlainString(), order.getLeverage(),
                order.getLimitPrice() == null ? null : order.getLimitPrice().toPlainString(), order.getReservedMargin().toPlainString(),
                order.getCreatedAt(), order.getCompletedAt(), order.getReason(),
                fill == null ? null : new FillResponse(fill.getId(), fill.getQuantity().toPlainString(), fill.getPrice().toPlainString(),
                        fill.getPriceEventTime(), fill.getExecutedAt(), fill.getRealizedPnl().toPlainString()));
    }
}
