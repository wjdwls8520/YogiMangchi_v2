package com.yogimangchi.trading.tradingevent.controller;

import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
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
@SecurityRequirement(name="memberBearer")
public class TradingEventController {
    private final TradingEvents events;
    public TradingEventController(TradingEvents events) { this.events=events; }
    @GetMapping
    @Operation(summary="Replay own committed trading events in ascending eventId order (or newest first when latest=true and afterId=0)",
            description="afterId defaults to 0; limit 1-100 default 50. Pass latest=true with afterId=0 to query the most recent limit events descending by eventId. Default latest=false preserves ascending replay for WS resume. Guest bearer or Content member JWT; account is derived from verified ownership. 400 invalid cursor/limit; 401 credential.")
    public List<TradingEventResponse> history(@AuthenticationPrincipal TradingPrincipal principal,
            @RequestParam(defaultValue="0") long afterId,
            @RequestParam(defaultValue="50") int limit,
            @RequestParam(defaultValue="false") boolean latest) {
        return events.query(principal.accountId(),afterId,limit,latest);
    }
}
