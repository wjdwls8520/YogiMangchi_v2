package com.yogimangchi.content.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(description="Own Yogimangchi Access JWT. Keep in Frontend memory and send as Bearer; never put in URLs. Refresh token is delivered only as an HttpOnly cookie.")
public record AccessResponse(
        Long memberId,
        String nickname,
        String accessToken,
        String tokenType,
        long expiresIn,
        Instant expiresAt,
        String accountStatus,
        String suspensionReason) {

    public AccessResponse(Long memberId, String nickname, String accessToken, String tokenType, long expiresIn, Instant expiresAt) {
        this(memberId, nickname, accessToken, tokenType, expiresIn, expiresAt, "ACTIVE", null);
    }
}
