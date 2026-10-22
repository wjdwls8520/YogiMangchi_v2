package com.yogimangchi.content.member.dto;

import java.time.Instant;
import java.util.List;

public record FollowPage(List<Entry> content,Long nextCursorId,boolean hasNext) {
    public record Entry(Long memberId,String nickname,String profileMessage,Instant followedAt) { }
}
