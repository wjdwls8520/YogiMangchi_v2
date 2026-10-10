package com.yogimangchi.trading.order.controller;
import com.yogimangchi.trading.execution.TradingOrderService;
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
    private final TradingOrderService engine;
    public OrderController(TradingOrderService engine) { this.engine = engine; }
    @PostMapping("/orders")
    @Operation(summary="Create a MARKET execution or reserve a PENDING LIMIT order",
            description="Idempotency-Key: 8-100 letters, digits, underscore or hyphen. Replay returns the same order with its current state. 400 invalid request; 401 credential; 409 margin/risk/idempotency conflict; 503 unavailable price or recovering engine. No client execution price.")
    public OrderResponse create(@AuthenticationPrincipal GuestPrincipal principal, @RequestHeader("Idempotency-Key") String key,
            @RequestBody CreateOrderRequest request) { return engine.create(principal.accountId(), key, request); }
    @PostMapping("/positions/{positionId}/close")
    @Operation(summary="Close all or part of an owned position at the fresh server mark price",
            description="Omit body/quantity for the entire remaining lot. Quantity is positive with at most 8 decimal places; no minimum exit notional. Only unreserved quantity may close; excess returns 409 CLOSE_QUANTITY_EXCEEDED. Cancel pending CLOSE orders before closing their reserved quantity. LONG closes by selling, SHORT by buying. All held symbols must be fresh. Same key with a different quantity returns 409; 404 for another account's position.")
    public OrderResponse close(@AuthenticationPrincipal GuestPrincipal principal, @PathVariable Long positionId,
            @RequestHeader("Idempotency-Key") String key, @RequestBody(required=false) ClosePositionRequest request) {
        return engine.close(principal.accountId(), positionId, key, request);
    }
    @PostMapping("/positions/{positionId}/close-orders")
    @Operation(summary="Reserve a LIMIT CLOSE for part or all of an owned position",
            description="Returns PENDING; creates no new position and reserves quantity, not wallet margin. Side/leverage/symbol are inherited from the target lot. LONG CLOSE triggers at Mark >= limit; SHORT CLOSE at Mark <= limit. The triggering Mark is the execution price. Omit quantity for the entire remaining lot. Existing reservations cannot be exceeded (409). Fresh portfolio prices and READY engine required (503 otherwise). Same account/key/payload replays the current order; different payload returns 409. Other account's target returns 404.")
    public OrderResponse limitClose(@AuthenticationPrincipal GuestPrincipal principal, @PathVariable Long positionId,
            @RequestHeader("Idempotency-Key") String key, @RequestBody LimitCloseRequest request) {
        return engine.createLimitClose(principal.accountId(), positionId, key, request);
    }
    @GetMapping("/orders")
    @Operation(summary="Read own order/fill history, newest first",
            description="Use the last returned orderId as beforeId for the next page; limit 1-100, default 50.")
    public List<OrderResponse> history(@AuthenticationPrincipal GuestPrincipal principal,
            @RequestParam(required=false) Long beforeId, @RequestParam(defaultValue="50") int limit) {
        return engine.history(principal.accountId(), beforeId, limit);
    }
    @GetMapping("/orders/pending")
    @Operation(summary="Read own pending OPEN/CLOSE orders and their margin/quantity reservations")
    public List<OrderResponse> pending(@AuthenticationPrincipal GuestPrincipal principal) { return engine.pending(principal.accountId()); }
    @PostMapping("/orders/{orderId}/cancel")
    @Operation(summary="Cancel an owned pending order and release its margin or close quantity",
            description="Repeated cancel is idempotent. A fill that wins the race returns 409. Cancellation remains available during price/Redis outages.")
    public OrderResponse cancel(@AuthenticationPrincipal GuestPrincipal principal, @PathVariable Long orderId) {
        return engine.cancel(principal.accountId(), orderId);
    }
}
