package com.yogimangchi.trading.commandresult;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.yogimangchi.trading.order.dto.OrderResponse;
import com.yogimangchi.trading.stoploss.StopLossResponse;
import com.yogimangchi.trading.tradingaccount.dto.GuestRetryResponse;
import com.yogimangchi.trading.tradinground.MemberRounds;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@JsonInclude(JsonInclude.Include.ALWAYS)
@Schema(description="Observation only; never executes a command. NOT_OBSERVED does not prove nonacceptance or authorize a new key. Retain the original intent. Repeating the original mutation may execute it if no previous result exists.")
public record CommandResultResponse(Status status,CommandResultRequest.Operation operation,
        @Schema(description="Server observation time, not execution time. The committed read snapshot can immediately become outdated.") Instant observedAt,
        @Schema(nullable=true,description="ORDER_CURRENT: authoritative committed order/fill at this read, including legacy; not a fabricated original response. ORIGINAL_SNAPSHOT: original durable SL/restart/retry response, not current position/wallet.") ResultKind resultKind,
        @Schema(nullable=true,oneOf={OrderResponse.class,StopLossResponse.class,MemberRounds.Restart.class,GuestRetryResponse.class}) Object result) {
    public enum Status { FOUND,NOT_OBSERVED }
    public enum ResultKind { ORDER_CURRENT,ORIGINAL_SNAPSHOT }
}
