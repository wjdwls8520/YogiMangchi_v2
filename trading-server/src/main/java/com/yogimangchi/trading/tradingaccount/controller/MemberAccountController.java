package com.yogimangchi.trading.tradingaccount.controller;

import com.yogimangchi.trading.tradingaccount.dto.MemberAccountResponse;
import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import com.yogimangchi.trading.tradingaccount.service.MemberAccounts;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.*;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@SecurityScheme(name="memberBearer",type=SecuritySchemeType.HTTP,scheme="bearer",bearerFormat="JWT",description="Content-issued Yogimangchi Access JWT; provider OAuth tokens are not accepted.")
public class MemberAccountController {
    private final MemberAccounts accounts;
    public MemberAccountController(MemberAccounts accounts) { this.accounts=accounts; }
    @PostMapping(value="/api/v1/trading/accounts/member",produces="application/json")
    @SecurityRequirement(name="memberBearer")
    @Operation(summary="Explicitly open or read the authenticated member's own Futures account",
            description="Content Access JWT required in Authorization: Bearer; Content cookies or provider OAuth tokens do not authenticate Trading. The server must enable member authentication and trust the Content signing public key and issuer. memberId derives only from signed sub; request accountId/memberId/balance cannot select or fund an account. First opening creates an isolated10000USDT wallet and round1, exactly once. Repetition returns the same account/current balance without reset. Never merges Guest history. No financial writes occur implicitly on GET/authentication. 200 own account;401 MEMBER_CREDENTIAL_REQUIRED when missing, INVALID_ACCESS_TOKEN when invalid or expired;403 Guest;409 contention;503 AUTHENTICATION_UNAVAILABLE for authentication storage failure.")
    public ResponseEntity<MemberAccountResponse> open(@AuthenticationPrincipal TradingPrincipal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(accounts.open(principal.memberId()));
    }
}
