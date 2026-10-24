package com.yogimangchi.trading.order.controller;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.service.OrderQuoteService;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/trading/account", produces="application/json")
@SecurityRequirement(name="guestBearer")
@SecurityRequirement(name="memberBearer")
public class OrderController {
    private final TradingOrderService engine;
    private final OrderQuoteService quotes;
    public OrderController(TradingOrderService engine, OrderQuoteService quotes) { this.engine = engine; this.quotes=quotes; }
    @PostMapping("/orders/quote")
    @Operation(summary="Calculate OPEN cost or a fee-inclusive percentage quantity without creating an order",
            description="Guest Bearer required. Exactly one of quantity or balancePercentage (1-100); leverage comes from the server account/symbol/side setting. MARKET 0.05%, LIMIT 0.03%. Uses fresh server Mark and same passive LIMIT rule. A quote is not a reservation or execution promise. Submit its quantity/leverage through POST orders; a later price/state change can reject it. 400 invalid, 401 credential, 409 cash/risk/mode conflict, 503 freshness/recovery.")
    public OrderQuoteResponse quote(@AuthenticationPrincipal TradingPrincipal principal, @RequestBody OrderQuoteRequest request) {
        return quotes.quote(principal.accountId(),request);
    }
    @PostMapping("/orders")
    @Operation(summary="OPEN/add to an integrated Hedge position with MARKET or reserve a LIMIT OPEN",
            description="Same account/symbol/side fills share one Position ID; LONG and SHORT coexist. New OPEN notional 10-1000000 USDT. Leverage 1-100 must match direction-specific symbol setting. MARKET fee 0.05%, LIMIT fee 0.03%, CEILING18 on actual Mark notional. LIMIT reserves margin plus fee at limitPrice without charging it; actual Mark costs are rechecked at execution. Idempotency-Key: 8-100 letters, digits, underscore or hyphen; replay retains original policy/result. LIMIT OPEN LONG must be strictly below fresh Mark; SHORT strictly above; otherwise 409 MARKETABLE_LIMIT_NOT_ALLOWED. LIMIT collateral is CEILING18(limitPrice * quantity / leverage), with additional fee reservation. 400 invalid; 401 credential; 409 ORDER_SIZE_LIMIT_EXCEEDED/margin/risk/idempotency; 503 PRICE_NOT_FRESH/ENGINE_RECOVERING/ACCOUNT_RISK_PENDING/ACCOUNT_RECOVERY_HELD. Business rejection outcome is NOT_ACCEPTED; unexpected500 outcome UNKNOWN requires reconfirming the same idempotency key. Order book is reference only.")
    public OrderResponse create(@AuthenticationPrincipal TradingPrincipal principal, @RequestHeader("Idempotency-Key") String key,
            @RequestBody CreateOrderRequest request) { return engine.create(principal.accountId(), key, request); }
    @PostMapping("/positions/{positionId}/close")
    @Operation(summary="Close all or part of an owned position at the fresh server mark price",
            description="Omit body/quantity for entire remaining position. Quantity positive, at most 8 decimals; no minimum exit notional. Only unreserved quantity may close; excess 409 CLOSE_QUANTITY_EXCEEDED. Cancel pending CLOSE first to use their quantity. Target symbol fresh Mark and isolated safety required; unrelated symbols need not be fresh. MARKET fee 0.05% of actual notional, charged from released collateral/PnL. Gross PnL and fee remain separate. Same key/different quantity 409; another account's target 404.")
    public OrderResponse close(@AuthenticationPrincipal TradingPrincipal principal, @PathVariable Long positionId,
            @RequestHeader("Idempotency-Key") String key, @RequestBody(required=false) ClosePositionRequest request) {
        return engine.close(principal.accountId(), positionId, key, request);
    }
    @PostMapping("/positions/{positionId}/close-orders")
    @Operation(summary="Reserve a LIMIT CLOSE for part or all of an owned position",
            description="PENDING CLOSE reserves quantity, not wallet margin. Side/leverage/symbol come from target. LONG CLOSE (SELL) limit strictly above fresh Mark; SHORT CLOSE (BUY) strictly below; otherwise 409 MARKETABLE_LIMIT_NOT_ALLOWED. Trigger Mark is actual execution price; fee is 0.03% of actual notional at execution. Omit quantity for entire remaining position; reservations cannot be exceeded (409). Only target symbol needs fresh Mark; engine must be caught up (503). Same key/payload replays, different payload 409; another account's target 404.")
    public OrderResponse limitClose(@AuthenticationPrincipal TradingPrincipal principal, @PathVariable Long positionId,
            @RequestHeader("Idempotency-Key") String key, @RequestBody LimitCloseRequest request) {
        return engine.createLimitClose(principal.accountId(), positionId, key, request);
    }
    @GetMapping("/orders")
    @Operation(summary="Read own order/fill history, newest first",
            description="Use last orderId as beforeId; limit1-100 default50. Optional tradingSymbolId/side/action/status/type filters preserve the existing array response. Reading is account-private and creates no financial data.")
    public List<OrderResponse> history(@AuthenticationPrincipal TradingPrincipal principal,
            @RequestParam(required=false) Long beforeId, @RequestParam(defaultValue="50") int limit,
            @RequestParam(required=false) Long tradingSymbolId,@RequestParam(required=false) Position.Side side,
            @RequestParam(required=false) TradingOrder.Action action,@RequestParam(required=false) TradingOrder.Status status,
            @RequestParam(required=false) TradingOrder.Type type) {
        return engine.history(principal.accountId(),beforeId,limit,tradingSymbolId,side,action,status,type);
    }
    @GetMapping("/orders/pending")
    @Operation(summary="Read own pending OPEN/CLOSE orders and their margin/quantity reservations")
    public List<OrderResponse> pending(@AuthenticationPrincipal TradingPrincipal principal) { return engine.pending(principal.accountId()); }
    @PostMapping("/orders/{orderId}/cancel")
    @Operation(summary="Cancel an owned pending order and release its margin or close quantity",
            description="Repeated cancel is idempotent. A fill that wins the race returns 409. Cancellation remains available during price/Redis outages.")
    public OrderResponse cancel(@AuthenticationPrincipal TradingPrincipal principal, @PathVariable Long orderId) {
        return engine.cancel(principal.accountId(), orderId);
    }
}
