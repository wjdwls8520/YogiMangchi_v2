package com.yogimangchi.trading.tradingaccount.controller;

import com.yogimangchi.trading.tradingaccount.dto.*;
import com.yogimangchi.trading.tradingaccount.security.GuestPrincipal;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/api/v1/trading", produces = "application/json")
@SecurityScheme(name = "guestBearer", type = SecuritySchemeType.HTTP, scheme = "bearer",
        description = "Opaque Guest Trading MVP credential; not a Content JWT. Issued by POST /api/v1/trading/accounts/guest.")
public class TradingAccountController {
    private final TradingAccountService accounts;
    public TradingAccountController(TradingAccountService accounts) { this.accounts = accounts; }

    @PostMapping("/accounts/guest")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a guest simulation account with 10000 USDT",
            description = "Explicit opt-in: each POST creates one new Guest account and wallet with initial 10000 USDT. Public market data, candles and WebSocket access do not create an account and require no Guest credential. Returns an opaque bearer credential once, valid for exactly 7 days until expiresAt. Lost credentials cannot be recovered. Expired credentials return 401 and are never automatically renewed or replaced. Never share or log the token.")
    public ResponseEntity<GuestAccountResponse> createGuest() {
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(accounts.createGuest());
    }

    @GetMapping("/account/wallet")
    @SecurityRequirement(name = "guestBearer")
    @Operation(summary = "Read the authenticated guest's USDT wallet and current valuation",
            description = "401: missing/expired credential; 409 TRADING_BUSY: retry after lock contention; 503: authentication storage unavailable.")
    public WalletResponse wallet(@AuthenticationPrincipal GuestPrincipal principal) {
        return accounts.wallet(principal.accountId());
    }

    @GetMapping("/account/positions")
    @SecurityRequirement(name = "guestBearer")
    @Operation(summary = "Read the authenticated guest's integrated Hedge Mode positions",
            description = "Each ISOLATED position has its own collateral threshold at its symbol's Mark Price, including maintenance and closing fee reserve. The opposite Hedge side, other symbols and unused wallet cash do not cover its losses. Gaps execute at actual Mark; the threshold is not a guaranteed fill price. Null/status explains unavailable target marks, no boundary, unsupported precision, already-at-risk exposure or a legacy margin conversion hold. 401: missing/expired credential; 409 TRADING_BUSY; 503: authentication storage unavailable.")
    public List<PositionResponse> positions(@AuthenticationPrincipal GuestPrincipal principal) {
        return accounts.summary(principal.accountId()).positions();
    }

    @GetMapping("/account/summary")
    @SecurityRequirement(name = "guestBearer")
    @Operation(summary = "Read a coherent account, wallet and open-position snapshot",
            description = "Position liquidationPrice fields have the same independent isolated-collateral meaning as GET /account/positions. They are not guaranteed liquidation execution prices. Wallet gross realizedPnl, actual feesPaid and platform settlementAdjustment are separate; free cash excludes allocated/reserved collateral, not unrealized PnL. marginMode and marginTransitionStatus identify legacy conversion holds. 401: missing/expired credential; 409 TRADING_BUSY; 503: authentication storage unavailable.")
    public AccountSummaryResponse summary(@AuthenticationPrincipal GuestPrincipal principal) {
        return accounts.summary(principal.accountId());
    }
}
