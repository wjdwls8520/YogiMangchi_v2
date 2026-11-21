package com.yogimangchi.trading.tradingaccount.controller;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.tradingaccount.service.MemberAccounts;
import com.yogimangchi.trading.tradingaccount.service.MemberSuspensionService;
import com.yogimangchi.trading.tradingaccount.service.MemberWithdrawal;
import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@Hidden @RestController
@ConditionalOnProperty(name="trading.member-auth.enabled",havingValue="true")
public class MemberWithdrawalController {
    public record MemberSuspensionRequest(boolean suspended, String reason) { }

    private final MemberWithdrawal withdrawal;
    private final MemberAccounts accounts;
    private final MemberSuspensionService suspensions;

    public MemberWithdrawalController(MemberWithdrawal withdrawal, MemberAccounts accounts) {
        this(withdrawal, accounts, null);
    }

    @Autowired
    public MemberWithdrawalController(MemberWithdrawal withdrawal, MemberAccounts accounts, MemberSuspensionService suspensions) {
        this.withdrawal = withdrawal;
        this.accounts = accounts;
        this.suspensions = suspensions;
    }

    @PostMapping("/internal/v1/members/{memberId:[0-9]+}/trading-account")
    public ResponseEntity<Void> provision(@PathVariable Long memberId,@AuthenticationPrincipal Jwt jwt) {
        if(!memberId.toString().equals(jwt.getSubject()))throw new BusinessException(ErrorCode.WITHDRAWAL_SUBJECT_MISMATCH);
        accounts.open(memberId);return ResponseEntity.noContent().build();
    }

    @PostMapping("/internal/v1/members/{memberId:[0-9]+}/withdrawal")
    public ResponseEntity<Void> withdraw(@PathVariable Long memberId,@AuthenticationPrincipal Jwt jwt) {
        if(!memberId.toString().equals(jwt.getSubject())) throw new BusinessException(ErrorCode.WITHDRAWAL_SUBJECT_MISMATCH);
        withdrawal.withdraw(memberId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PostMapping("/internal/v1/members/{memberId:[0-9]+}/suspension")
    public ResponseEntity<Void> updateSuspension(
            @PathVariable Long memberId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) MemberSuspensionRequest request) {
        if (!memberId.toString().equals(jwt.getSubject())) {
            throw new BusinessException(ErrorCode.WITHDRAWAL_SUBJECT_MISMATCH);
        }
        boolean suspended = request != null && request.suspended();
        String reason = request != null ? request.reason() : null;
        if (suspensions != null) {
            suspensions.updateSuspension(memberId, suspended, reason);
        }
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
