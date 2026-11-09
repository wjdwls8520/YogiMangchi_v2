package com.yogimangchi.content.member.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

public record FollowPage(List<Entry> content,Long nextCursorId,boolean hasNext) {
    public record Entry(
            Long memberId,
            String nickname,
            String profileMessage,
            @JsonInclude(JsonInclude.Include.NON_NULL) String profileImgUrl,
            Instant followedAt) {
        public Entry(Long memberId,String nickname,String profileMessage,Instant followedAt) {
            this(memberId,nickname,profileMessage,null,followedAt);
        }
    }
}
