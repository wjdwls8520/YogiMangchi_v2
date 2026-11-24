package com.yogimangchi.trading.takeprofit;

import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/trading/account/positions/{positionId}/take-profit", produces = "application/json")
@SecurityRequirement(name = "memberBearer")
@SecurityRequirement(name = "guestBearer")
public class TakeProfitController {
    private final TakeProfitService takeProfits;

    public TakeProfitController(TakeProfitService takeProfits) {
        this.takeProfits = takeProfits;
    }

    @GetMapping
    @Operation(
            summary = "Read own position take profit, including terminal history",
            description = "No write on read. Initial NONE/version 0 with nullable prices/timestamps. Wrong owner/missing 404 POSITION_NOT_FOUND; credential 401.")
    public ResponseEntity<TakeProfitResponse> get(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long positionId) {
        return ok(takeProfits.get(principal.accountId(), positionId));
    }

    @PutMapping
    @Operation(
            summary = "Create or replace own full-position Mark take profit",
            description = "Idempotency-Key 8-100 required, expectedVersion from latest GET. LONG TP must be strictly above current fresh Mark; SHORT TP strictly below. Stale version 409 TAKE_PROFIT_VERSION_CONFLICT; wrong Mark side 409 TAKE_PROFIT_NOT_PROFITABLE. Triggers market close at actual crossing Mark with MARKET fee and reason TAKE_PROFIT.")
    public ResponseEntity<TakeProfitResponse> put(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long positionId,
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            @RequestBody TakeProfitRequest request) {
        return ok(takeProfits.put(principal.accountId(), positionId, key, request));
    }

    @DeleteMapping
    @Operation(
            summary = "Cancel own take profit with optimistic version and idempotent result",
            description = "Required expectedVersion query and Idempotency-Key. No fresh Mark needed for cancellation. Completed position 409 POSITION_NOT_OPEN.")
    public ResponseEntity<TakeProfitResponse> delete(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long positionId,
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            @RequestParam Long expectedVersion) {
        return ok(takeProfits.delete(principal.accountId(), positionId, key, expectedVersion));
    }

    private ResponseEntity<TakeProfitResponse> ok(TakeProfitResponse response) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(response);
    }
}
