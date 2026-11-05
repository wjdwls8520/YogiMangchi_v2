package com.yogimangchi.trading.stoploss;

import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping(value="/api/v1/trading/account/positions/{positionId}/stop-loss",produces="application/json")
@SecurityRequirement(name="memberBearer") @SecurityRequirement(name="guestBearer")
public class StopLossController {
    private final StopLossService stops;
    public StopLossController(StopLossService stops){this.stops=stops;}
    @GetMapping
    @Operation(summary="Read own position stop loss, including terminal history",description="No write on read. Initial NONE/version0 with nullable prices/timestamps. Wrong owner/missing404 POSITION_NOT_FOUND; credential401. Full remaining quantity follows additions and partial exits; the old position lifecycle never reopens.")
    public ResponseEntity<StopLossResponse> get(@AuthenticationPrincipal TradingPrincipal principal,@PathVariable Long positionId) {
        return ok(stops.get(principal.accountId(),positionId));
    }
    @PutMapping
    @Operation(summary="Create or replace own full-position Mark stop loss",description="Idempotency-Key8-100 required, expectedVersion from latest GET. Same key+body returns original snapshot even after trigger/close; GET again before editing, never blindly use a new key after response loss. Different body409 IDEMPOTENCY_CONFLICT; stale version409 STOP_LOSS_VERSION_CONFLICT. Invalid supported price/version400 INVALID_STOP_LOSS; wrong Mark side409 STOP_LOSS_NOT_PROTECTIVE; at/beyond current liquidation risk409 STOP_LOSS_BEYOND_LIQUIDATION. Existing 503 PRICE_NOT_FRESH/ENGINE_RECOVERING/ACCOUNT_RISK_PENDING/ACCOUNT_RECOVERY_HELD remain. Admission TRADING_BUSY/ENGINE_RECOVERING (attemptOutcome NOT_ACCEPTED confirms only this attempt made no commit) outcome UNKNOWN requires retaining the same key/body/operation until confirmed, including after response loss; a retry may execute when no prior result exists. No quantity reservation. Liquidation first, then SL cancels pending CLOSE reservations and closes all remaining at actual Mark with MARKET fee atomically; gap slippage can liquidate instead. Leverage/exposure changes can move the liquidation threshold; stop price is never silently shifted. Received journal events process in order, and pre-arming ticks cannot trigger a newly set/replaced stop. No inference of missed prices.")
    public ResponseEntity<StopLossResponse> put(@AuthenticationPrincipal TradingPrincipal principal,@PathVariable Long positionId,
            @RequestHeader(value="Idempotency-Key",required=false) String key,@RequestBody StopLossRequest request) {
        return ok(stops.put(principal.accountId(),positionId,key,request));
    }
    @DeleteMapping
    @Operation(summary="Cancel own stop loss with optimistic version and idempotent result",description="Required expectedVersion query and Idempotency-Key. Pending recorded crossing must finish first; cancel cannot outrun accepted risk work. No fresh Mark needed for cancellation. A previously successful identical command replays its original snapshot; new stale commands409. Does not cancel ordinary LIMIT CLOSE orders. Existing completed position409 POSITION_NOT_OPEN; GET still reads terminal state. Admission TRADING_BUSY/ENGINE_RECOVERING (attemptOutcome NOT_ACCEPTED confirms only this attempt made no commit) outcome UNKNOWN requires retaining the original key/query until confirmed, not allocating a new command.")
    public ResponseEntity<StopLossResponse> delete(@AuthenticationPrincipal TradingPrincipal principal,@PathVariable Long positionId,
            @RequestHeader(value="Idempotency-Key",required=false) String key,@RequestParam Long expectedVersion) {
        return ok(stops.delete(principal.accountId(),positionId,key,expectedVersion));
    }
    private ResponseEntity<StopLossResponse> ok(StopLossResponse response){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(response);}
}
