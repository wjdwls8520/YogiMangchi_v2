package com.yogimangchi.content.member.dto;

public record FollowResponse(Long targetMemberId,long followerCount,boolean followed) { }
