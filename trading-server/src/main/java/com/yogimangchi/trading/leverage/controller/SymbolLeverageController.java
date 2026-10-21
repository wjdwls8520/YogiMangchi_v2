package com.yogimangchi.trading.leverage.controller;

import com.yogimangchi.trading.leverage.dto.*;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/api/v1/trading/account/symbols/{symbolId}/leverage", produces = "application/json")
@SecurityRequirement(name = "guestBearer")
@SecurityRequirement(name = "memberBearer")
public class SymbolLeverageController {
    private final SymbolLeverageService leverages;
    public SymbolLeverageController(SymbolLeverageService leverages) { this.leverages = leverages; }
    @GetMapping
    @Operation(summary = "Read this account's shared LONG/SHORT symbol leverage",
            description = "Default 10x, maximum 100x, ISOLATED margin only. A read never creates an account, position or setting. Legacy Cross exposure is identified as LEGACY_CROSS with a PENDING/REVIEW_REQUIRED transition hold. Requires a valid Guest bearer; inactive/unknown symbol: 409 SYMBOL_NOT_AVAILABLE.")
    public LeverageResponse get(@AuthenticationPrincipal TradingPrincipal principal, @PathVariable Long symbolId) {
        return leverages.get(principal.accountId(), symbolId);
    }
    @PutMapping
    @Operation(summary = "Atomically change LONG/SHORT leverage and OPEN reservations",
            description = "Integer 1-100. Reallocates independent LONG/SHORT collateral and PENDING OPEN reserved margin atomically. Each side must remain safe under its own fresh Mark; no other position or unused cash automatically covers its losses. Preserves quantities, exact basis, realized PnL, CLOSE quantities and completed history. Same value is safe to repeat. 400 INVALID_LEVERAGE; 409 LEVERAGE_MISMATCH applies to subsequent OPEN requests; 409 INSUFFICIENT_MARGIN/ACCOUNT_AT_RISK/MARGIN_MIGRATION_REQUIRED/SYMBOL_NOT_AVAILABLE/TRADING_BUSY; 503 PRICE_NOT_FRESH/ENGINE_RECOVERING. A failure rolls back the whole change. Does not renew a Guest credential.")
    public LeverageResponse put(@AuthenticationPrincipal TradingPrincipal principal, @PathVariable Long symbolId, @RequestBody LeverageRequest request) {
        return leverages.change(principal.accountId(), symbolId, request.leverage());
    }
}
