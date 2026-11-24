package com.yogimangchi.content.member.dto;

import java.time.Instant;

public record MemberProfileResponse(
        Long memberId,
        String nickname,
        String profileMessage,
        String profileImgUrl,
        String role,
        String status,
        String accountStatus,
        Instant suspendedAt,
        String suspendedReason,
        String suspensionReason,
        Instant createdAt) {

    public MemberProfileResponse(
            Long memberId,
            String nickname,
            String profileMessage,
            String profileImgUrl,
            String role,
            String status,
            Instant suspendedAt,
            String suspendedReason,
            Instant createdAt) {
        this(memberId, nickname, profileMessage, profileImgUrl, role,
                status, status, suspendedAt, suspendedReason, suspendedReason, createdAt);
    }

    public MemberProfileResponse(Long memberId, String nickname, String profileMessage, String profileImgUrl, String role, Instant createdAt) {
        this(memberId, nickname, profileMessage, profileImgUrl, role, "ACTIVE", "ACTIVE", null, null, null, createdAt);
    }

    public MemberProfileResponse(Long memberId, String nickname, String profileMessage, String role, Instant createdAt) {
        this(memberId, nickname, profileMessage, null, role, "ACTIVE", "ACTIVE", null, null, null, createdAt);
    }
}
