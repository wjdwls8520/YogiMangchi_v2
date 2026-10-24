package com.yogimangchi.trading.performance;

import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.time.Instant;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/trading/account/performance/symbols",produces="application/json")
@SecurityRequirement(name="guestBearer")
@SecurityRequirement(name="memberBearer")
public class SymbolPerformanceController {
    private final SymbolPerformanceService performance;
    public SymbolPerformanceController(SymbolPerformanceService performance) { this.performance=performance; }
    @GetMapping
    @Operation(summary="Aggregate this authenticated account's full Fill range by symbol",
        description="Optional from inclusive/before exclusive UTC timestamps (microsecond precision), roundId and tradingSymbolId. Defaults epoch through capture time. Counts actual OPEN+CLOSE+LIQUIDATE price*quantity on both sides; each execution leg counts once. Pending/canceled/rejected/admin closures/restart grants are excluded. Gross PnL, all actual fees and isolated shortfall adjustment remain separate. Economic PnL=gross-fees; cash trading PnL=economic+adjustment, excluding capital adjustments. Current unrealized valuation is separate from the historical range; null if not FRESH. Round return only for a whole unfiltered member round with known initial capital; legacy unknown stays unknown. No symbol ROE/return. No accountId input; 401 credential, 400 INVALID_HISTORY_REQUEST, 404 ROUND_NOT_FOUND, 409 TRADING_BUSY/ACCOUNT_NOT_ACTIVE.")
    public ResponseEntity<SymbolPerformanceResponse> get(@AuthenticationPrincipal TradingPrincipal principal,
            @RequestParam(required=false) Instant from,@RequestParam(required=false) Instant before,
            @RequestParam(required=false) Long roundId,@RequestParam(required=false) Long tradingSymbolId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(performance.aggregate(principal.accountId(),from,before,roundId,tradingSymbolId));
    }
}
