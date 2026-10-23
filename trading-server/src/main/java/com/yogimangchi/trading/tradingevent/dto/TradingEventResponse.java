package com.yogimangchi.trading.tradingevent.dto;

import com.yogimangchi.trading.order.dto.OrderResponse;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(description="Durable own-account event snapshot. eventId is a decimal string cursor. Delivery is at least once across reconnects; deduplicate by eventId. roundId/roundNumber identify the committed member round (null for Guest); never apply an old-round event to a new-round view. Order is the committed transition snapshot, not a later state.")
public record TradingEventResponse(String eventId, String type, Instant occurredAt, OrderResponse order,Long roundId,Integer roundNumber) { }
