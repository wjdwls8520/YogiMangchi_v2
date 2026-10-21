package com.yogimangchi.content.member.dto;

import java.time.Instant;

public record PublicMemberProfileResponse(Long memberId,String nickname,String profileMessage,Instant createdAt) { }
