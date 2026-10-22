package com.yogimangchi.trading.tradingaccount.controller;

import com.yogimangchi.trading.tradingaccount.service.MemberWithdrawal;
import com.yogimangchi.trading.error.*;
import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@Hidden @RestController
@ConditionalOnProperty(name="trading.member-auth.enabled",havingValue="true")
public class MemberWithdrawalController {
    private final MemberWithdrawal withdrawal;
    public MemberWithdrawalController(MemberWithdrawal withdrawal) { this.withdrawal=withdrawal; }
    @PostMapping("/internal/v1/members/{memberId:[0-9]+}/withdrawal")
    public ResponseEntity<Void> withdraw(@PathVariable Long memberId,@AuthenticationPrincipal Jwt jwt) {
        if(!memberId.toString().equals(jwt.getSubject())) throw new BusinessException(ErrorCode.WITHDRAWAL_SUBJECT_MISMATCH);
        withdrawal.withdraw(memberId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
