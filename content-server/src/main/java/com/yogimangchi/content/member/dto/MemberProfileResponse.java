package com.yogimangchi.content.member.dto;

import java.time.Instant;

public record MemberProfileResponse(Long memberId,String nickname,String profileMessage,String role,Instant createdAt) { }
