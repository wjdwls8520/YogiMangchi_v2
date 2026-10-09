package com.yogimangchi.trading.order.controller;
import com.yogimangchi.trading.execution.MarketOrderService;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.tradingaccount.security.GuestPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/trading/account", produces="application/json")
@SecurityRequirement(name="guestBearer")
public class OrderController {
    private final MarketOrderService engine;
    public OrderController(MarketOrderService engine) { this.engine = engine; }
    @PostMapping("/orders")
    @Operation(summary="Open a LONG or SHORT position at the fresh server mark price",
            description="Idempotency-Key: 8-100 letters, digits, underscore or hyphen. Replay returns original result. 400 invalid request; 401 credential; 409 margin/risk/idempotency conflict; 503 unavailable price. No client execution price.")
    public OrderResponse create(@AuthenticationPrincipal GuestPrincipal principal, @RequestHeader("Idempotency-Key") String key,
            @RequestBody CreateOrderRequest request) { return engine.create(principal.accountId(), key, request); }
    @PostMapping("/positions/{positionId}/close")
    @Operation(summary="Close one entire owned position at the fresh server mark price",
            description="LONG closes by selling, SHORT by buying. All held symbols must be fresh. Same idempotency contract as opening; 404 for another account's position.")
    public OrderResponse close(@AuthenticationPrincipal GuestPrincipal principal, @PathVariable Long positionId,
            @RequestHeader("Idempotency-Key") String key) { return engine.close(principal.accountId(), positionId, key); }
    @GetMapping("/orders")
    @Operation(summary="Read own order/fill history, newest first",
            description="Use the last returned orderId as beforeId for the next page; limit 1-100, default 50.")
    public List<OrderResponse> history(@AuthenticationPrincipal GuestPrincipal principal,
            @RequestParam(required=false) Long beforeId, @RequestParam(defaultValue="50") int limit) {
        return engine.history(principal.accountId(), beforeId, limit);
    }
}

