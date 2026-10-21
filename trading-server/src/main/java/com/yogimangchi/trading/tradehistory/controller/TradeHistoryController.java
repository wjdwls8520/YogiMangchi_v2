package com.yogimangchi.trading.tradehistory.controller;

import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.tradehistory.dto.*;
import com.yogimangchi.trading.tradehistory.service.TradeHistoryService;
import com.yogimangchi.trading.tradingaccount.security.GuestPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.time.Instant;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/trading/account",produces="application/json")
@SecurityRequirement(name="guestBearer")
public class TradeHistoryController {
    private final TradeHistoryService history;
    public TradeHistoryController(TradeHistoryService history) { this.history=history; }
    @GetMapping("/fills")
    @Operation(summary="Read own immutable fills including partial CLOSE and liquidation",
            description="Newest fillId first; use last fillId as beforeId. limit1-100 default50. Optional symbol/side/action/type and executedFrom inclusive/executedBefore exclusive UTC filters. No price provider strings. 400 invalid filters, 401 credential. Reading creates no financial data.")
    public List<FillHistoryResponse> fills(@AuthenticationPrincipal GuestPrincipal principal,
            @RequestParam(required=false) Long beforeId,@RequestParam(defaultValue="50") int limit,
            @RequestParam(required=false) Long tradingSymbolId,@RequestParam(required=false) Position.Side side,
            @RequestParam(required=false) TradingOrder.Action action,@RequestParam(required=false) TradingOrder.Type type,
            @RequestParam(required=false) Instant executedFrom,@RequestParam(required=false) Instant executedBefore) {
        return history.fills(principal.accountId(),beforeId,limit,tradingSymbolId,side,action,type,executedFrom,executedBefore);
    }
    @GetMapping("/positions/history")
    @Operation(summary="Read own CLOSED/LIQUIDATED position lifecycles with gross, fee, adjustment and net",
            description="One completed lifecycle per item, not one order. Newest closedAt then positionId first. Opaque cursor + limit1-100 default50; use nextCursor unchanged with same filters. Optional symbol/side/status(CLOSED or LIQUIDATED), closedFrom inclusive/closedBefore exclusive UTC filters. OPEN/MERGED excluded. 400 invalid, 401 credential. Existing Cross opening facts remain labelled.")
    public ClosedPositionPage closed(@AuthenticationPrincipal GuestPrincipal principal,
            @RequestParam(required=false) String cursor,@RequestParam(defaultValue="50") int limit,
            @RequestParam(required=false) Long tradingSymbolId,@RequestParam(required=false) Position.Side side,
            @Parameter(schema=@Schema(allowableValues={"CLOSED","LIQUIDATED"})) @RequestParam(required=false) Position.Status status,@RequestParam(required=false) Instant closedFrom,
            @RequestParam(required=false) Instant closedBefore) {
        return history.closed(principal.accountId(),cursor,limit,tradingSymbolId,side,status,closedFrom,closedBefore);
    }
}
