package com.yogimangchi.trading.tradingaccount.controller;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.tradingaccount.dto.GuestRetryResponse;
import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import com.yogimangchi.trading.tradingaccount.service.GuestRetryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
public class GuestRetryController {
    private final GuestRetryService retries;
    public GuestRetryController(GuestRetryService retries) { this.retries=retries; }
    @PostMapping(value="/api/v1/trading/account/retry",produces="application/json")
    @SecurityRequirement(name="guestBearer")
    @Operation(summary="Restart own Guest simulation with10000 USDT",description="Valid Guest Bearer and Idempotency-Key(8-100 letters/digits/underscore/hyphen) required. No body or caller-selected account/balance. Cancels all pending orders, retires open positions without a priced Fill/additional PnL/fee and resets cash to10000 USDT atomically. Keeps account ID, credential/expiry, leverage preferences and past ledger totals/history. Restores bankrupt or legacy-held Guest accounts to ACTIVE/ISOLATED. Same key returns original retry snapshot without resetting again; use a new key only for a new deliberate retry. Missing/expired credential401, member403, invalid key400, lock contention409. Refresh wallet/positions/pending orders after success. No new token is issued.")
    public ResponseEntity<GuestRetryResponse> retry(@AuthenticationPrincipal TradingPrincipal principal,
            @io.swagger.v3.oas.annotations.Parameter(required=true)
            @RequestHeader(value="Idempotency-Key",required=false) String key) {
        if(principal.memberId()!=null) throw new BusinessException(ErrorCode.GUEST_ACCOUNT_REQUIRED);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(retries.retry(principal.accountId(),key));
    }
}
