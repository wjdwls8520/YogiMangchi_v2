package com.yogimangchi.content.member.dto;

import java.time.Instant;

public record PublicMemberProfileResponse(Long memberId,String nickname,String profileMessage,String profileImgUrl,Instant createdAt) {
    public PublicMemberProfileResponse(Long memberId,String nickname,String profileMessage,Instant createdAt) {
        this(memberId,nickname,profileMessage,null,createdAt);
    }
}
