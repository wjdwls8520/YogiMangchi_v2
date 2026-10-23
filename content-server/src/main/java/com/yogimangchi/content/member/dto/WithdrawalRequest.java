package com.yogimangchi.content.member.dto;
import io.swagger.v3.oas.annotations.media.Schema;
@Schema(description="Bearer + fresh same-member OAuth proof session + CSRF required for first request. Exact phrase and current notice version mandatory; body memberId is never trusted.")
public record WithdrawalRequest(boolean acknowledged,String confirmation,String policyVersion) {
    public static final String VERSION="ym-withdrawal-v1";
    public void validate() {
        if(!acknowledged || !"탈퇴합니다".equals(confirmation) || !VERSION.equals(policyVersion))
            throw new com.yogimangchi.content.error.AuthFailure("WITHDRAWAL_CONFIRMATION_REQUIRED",org.springframework.http.HttpStatus.BAD_REQUEST);
    }
}
