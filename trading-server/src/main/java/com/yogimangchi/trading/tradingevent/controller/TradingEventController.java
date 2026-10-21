package com.yogimangchi.trading.tradingevent.controller;

import com.yogimangchi.trading.tradingaccount.security.GuestPrincipal;
import com.yogimangchi.trading.tradingevent.dto.TradingEventResponse;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/trading/account/events",produces="application/json")
@SecurityRequirement(name="guestBearer")
public class TradingEventController {
    private final TradingEvents events;
    public TradingEventController(TradingEvents events) { this.events=events; }
    @GetMapping
    @Operation(summary="Replay own committed trading events in ascending eventId order",
            description="afterId defaults to0; limit1-100 default50. Use last eventId as afterId for next page or WS resume; duplicate IDs must be ignored. Only transitions created since V13 exist; no fake backfill of earlier events. Guest Bearer; account is derived from credential, never a caller-supplied accountId. 400 invalid cursor/limit; 401 credential. WebSocket /ws/trading uses the same durable source with authenticated first frame; public /ws/market never carries these events.")
    public List<TradingEventResponse> history(@AuthenticationPrincipal GuestPrincipal principal,
            @RequestParam(defaultValue="0") long afterId,@RequestParam(defaultValue="50") int limit) {
        return events.after(principal.accountId(),afterId,limit);
    }
}
