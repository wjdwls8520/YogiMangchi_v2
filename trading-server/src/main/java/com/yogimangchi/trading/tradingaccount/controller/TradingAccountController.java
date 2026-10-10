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
            description = "Returns a 7-day opaque bearer credential once. Losing it means losing access; never share or log it.")
    public ResponseEntity<GuestAccountResponse> createGuest() {
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(accounts.createGuest());
    }

    @GetMapping("/account/wallet")
    @SecurityRequirement(name = "guestBearer")
    @Operation(summary = "Read the authenticated guest's USDT wallet and current valuation",
            description = "401: missing/expired credential; 409 TRADING_BUSY: retry after lock contention; 503: authentication storage unavailable.")
    public WalletResponse wallet(@AuthenticationPrincipal GuestPrincipal principal) {
        return accounts.summary(principal.accountId()).wallet();
    }

    @GetMapping("/account/positions")
    @SecurityRequirement(name = "guestBearer")
    @Operation(summary = "Read the authenticated guest's open position lots",
            description = "401: missing/expired credential; 409 TRADING_BUSY: retry after lock contention; 503: authentication storage unavailable.")
    public List<PositionResponse> positions(@AuthenticationPrincipal GuestPrincipal principal) {
        return accounts.summary(principal.accountId()).positions();
    }

    @GetMapping("/account/summary")
    @SecurityRequirement(name = "guestBearer")
    @Operation(summary = "Read a coherent account, wallet and open-position snapshot",
            description = "401: missing/expired credential; 409 TRADING_BUSY: retry after lock contention; 503: authentication storage unavailable.")
    public AccountSummaryResponse summary(@AuthenticationPrincipal GuestPrincipal principal) {
        return accounts.summary(principal.accountId());
    }
}
