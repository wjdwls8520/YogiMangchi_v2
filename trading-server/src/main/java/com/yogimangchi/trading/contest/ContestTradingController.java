package com.yogimangchi.trading.contest;

import com.yogimangchi.trading.contest.ContestDtos.ContestSeasonSummaryResponse;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.leverage.dto.LeverageRequest;
import com.yogimangchi.trading.leverage.dto.LeverageResponse;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.order.dto.ClosePositionRequest;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.dto.LimitCloseRequest;
import com.yogimangchi.trading.order.dto.OrderQuoteRequest;
import com.yogimangchi.trading.order.dto.OrderQuoteResponse;
import com.yogimangchi.trading.order.dto.OrderResponse;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.service.OrderQuoteService;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.stoploss.StopLossRequest;
import com.yogimangchi.trading.stoploss.StopLossResponse;
import com.yogimangchi.trading.stoploss.StopLossService;
import com.yogimangchi.trading.tradehistory.dto.ClosedPositionPage;
import com.yogimangchi.trading.tradehistory.dto.FillHistoryResponse;
import com.yogimangchi.trading.tradehistory.service.TradeHistoryService;
import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/trading/contest/seasons/{seasonId:[0-9]+}")
@Tag(name = "Contest Trading", description = "Season-isolated contest futures trading endpoints")
public class ContestTradingController {

    private final ContestService contestService;
    private final TradingOrderService orderService;
    private final OrderQuoteService quoteService;
    private final SymbolLeverageService leverageService;
    private final TradeHistoryService historyService;
    private final StopLossService stopLossService;

    public ContestTradingController(
            ContestService contestService,
            TradingOrderService orderService,
            OrderQuoteService quoteService,
            SymbolLeverageService leverageService,
            TradeHistoryService historyService,
            StopLossService stopLossService) {
        this.contestService = contestService;
        this.orderService = orderService;
        this.quoteService = quoteService;
        this.leverageService = leverageService;
        this.historyService = historyService;
        this.stopLossService = stopLossService;
    }

    @GetMapping("/summary")
    @Operation(summary = "Get contest season wallet, open positions, and participation summary")
    public ContestSeasonSummaryResponse getSummary(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId) {
        return contestService.getContestSeasonSummary(principal.memberId(), seasonId);
    }

    @GetMapping("/symbols/{symbolId:[0-9]+}/leverage")
    @Operation(summary = "Get symbol leverage setting for this contest season wallet")
    public LeverageResponse getLeverage(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long symbolId,
            @RequestParam(defaultValue = "LONG") Position.Side side) {
        Long accountId = contestService.requireContestAccountForRead(principal.memberId(), seasonId);
        return leverageService.get(accountId, symbolId, side);
    }

    @PutMapping("/symbols/{symbolId:[0-9]+}/leverage")
    @Operation(summary = "Change symbol leverage for this contest season wallet")
    public LeverageResponse changeLeverage(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long symbolId,
            @Valid @RequestBody LeverageRequest request) {
        Long accountId = contestService.requireActiveContestAccountForTrading(principal.memberId(), seasonId);
        Position.Side side = request.side() == null ? Position.Side.LONG : request.side();
        return leverageService.change(accountId, symbolId, side, request.leverage());
    }

    @PostMapping("/orders/quote")
    @Operation(summary = "Preview order quantity and required margin for this contest season wallet")
    public OrderQuoteResponse quoteOrder(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @Valid @RequestBody OrderQuoteRequest request) {
        Long accountId = contestService.requireContestAccountForRead(principal.memberId(), seasonId);
        return quoteService.quote(accountId, request);
    }

    @PostMapping("/orders")
    @Operation(summary = "Submit a market or limit OPEN order in the active contest season")
    public OrderResponse createOrder(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody CreateOrderRequest request) {
        Long accountId = contestService.requireActiveContestAccountForTrading(principal.memberId(), seasonId);
        return orderService.create(accountId, idempotencyKey, request);
    }

    @PostMapping("/orders/{orderId:[0-9]+}/cancel")
    @Operation(summary = "Cancel a pending order in the active contest season")
    public OrderResponse cancelOrder(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long orderId) {
        Long accountId = contestService.requireActiveContestAccountForTrading(principal.memberId(), seasonId);
        return orderService.cancel(accountId, orderId);
    }

    @PostMapping("/positions/{positionId:[0-9]+}/close")
    @Operation(summary = "Market-close an open position in the active contest season")
    public OrderResponse closePosition(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long positionId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) ClosePositionRequest request) {
        Long accountId = contestService.requireActiveContestAccountForTrading(principal.memberId(), seasonId);
        return orderService.close(accountId, positionId, idempotencyKey, request);
    }

    @PostMapping("/positions/{positionId:[0-9]+}/close-orders")
    @Operation(summary = "Create a limit CLOSE order for an open position in the active contest season")
    public OrderResponse createLimitClose(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long positionId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody LimitCloseRequest request) {
        Long accountId = contestService.requireActiveContestAccountForTrading(principal.memberId(), seasonId);
        return orderService.createLimitClose(accountId, positionId, idempotencyKey, request);
    }

    @GetMapping("/positions/{positionId:[0-9]+}/stop-loss")
    @Operation(summary = "Get stop-loss configuration for a contest position")
    public StopLossResponse getStopLoss(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long positionId) {
        Long accountId = contestService.requireContestAccountForRead(principal.memberId(), seasonId);
        return stopLossService.get(accountId, positionId);
    }

    @PutMapping("/positions/{positionId:[0-9]+}/stop-loss")
    @Operation(summary = "Set or update stop-loss on a contest position")
    public StopLossResponse setStopLoss(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long positionId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody StopLossRequest request) {
        Long accountId = contestService.requireActiveContestAccountForTrading(principal.memberId(), seasonId);
        return stopLossService.put(accountId, positionId, idempotencyKey, request);
    }

    @DeleteMapping("/positions/{positionId:[0-9]+}/stop-loss")
    @Operation(summary = "Cancel stop-loss on a contest position")
    public StopLossResponse cancelStopLoss(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long positionId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestParam long expectedVersion) {
        Long accountId = contestService.requireActiveContestAccountForTrading(principal.memberId(), seasonId);
        return stopLossService.delete(accountId, positionId, idempotencyKey, expectedVersion);
    }

    @GetMapping("/orders/pending")
    @Operation(summary = "List pending orders for this contest season wallet")
    public List<OrderResponse> getPendingOrders(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId) {
        Long accountId = contestService.requireContestAccountForRead(principal.memberId(), seasonId);
        return orderService.pending(accountId);
    }

    @GetMapping("/orders")
    @Operation(summary = "List order history for this contest season wallet")
    public List<OrderResponse> getOrderHistory(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @RequestParam(required = false) Long beforeOrderId,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) Long tradingSymbolId,
            @RequestParam(required = false) String symbol,
            @RequestParam(required = false) Position.Side side,
            @RequestParam(required = false) TradingOrder.Action action,
            @RequestParam(required = false) TradingOrder.Status status,
            @RequestParam(required = false) TradingOrder.Type type,
            @RequestParam(required = false) Instant createdFrom,
            @RequestParam(required = false) Instant createdBefore) {
        Long accountId = contestService.requireContestAccountForRead(principal.memberId(), seasonId);
        return orderService.history(
                accountId, beforeOrderId, limit, tradingSymbolId, symbol,
                side, action, status, type, createdFrom, createdBefore);
    }

    @GetMapping("/fills")
    @Operation(summary = "List fill history for this contest season wallet")
    public List<FillHistoryResponse> getFills(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @RequestParam(required = false) Long beforeFillId,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) Long tradingSymbolId,
            @RequestParam(required = false) String symbol,
            @RequestParam(required = false) Position.Side side,
            @RequestParam(required = false) TradingOrder.Action action,
            @RequestParam(required = false) TradingOrder.Type type,
            @RequestParam(required = false) Instant executedFrom,
            @RequestParam(required = false) Instant executedBefore) {
        Long accountId = contestService.requireContestAccountForRead(principal.memberId(), seasonId);
        return historyService.fills(
                accountId, beforeFillId, limit, tradingSymbolId, symbol,
                side, action, type, executedFrom, executedBefore);
    }

    @GetMapping("/positions/history")
    @Operation(summary = "List closed/liquidated position history for this contest season wallet")
    public ClosedPositionPage getClosedPositions(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) Long tradingSymbolId,
            @RequestParam(required = false) String symbol,
            @RequestParam(required = false) Position.Side side,
            @RequestParam(required = false) Position.Status status,
            @RequestParam(required = false) Instant closedFrom,
            @RequestParam(required = false) Instant closedBefore) {
        Long accountId = contestService.requireContestAccountForRead(principal.memberId(), seasonId);
        return historyService.closed(
                accountId, cursor, limit, tradingSymbolId, symbol,
                side, status, closedFrom, closedBefore);
    }
}
