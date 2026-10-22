package com.yogimangchi.content.member.controller;

import com.yogimangchi.content.member.dto.*;
import com.yogimangchi.content.member.service.MemberFollows;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping(value="/api/v1/members",produces="application/json")
public class FollowController {
    private final MemberFollows follows;
    public FollowController(MemberFollows follows) { this.follows=follows; }
    @PutMapping("/{memberId:[0-9]+}/follows") @SecurityRequirement(name="memberBearer")
    @Operation(summary="Follow an active member",description="Own Bearer required. Self-follow400, inactive/missing target404, inactive actor401. Repeated PUT is idempotent; relation counts cannot be supplied by callers. Content follow notifications are a separate pending capability.")
    public FollowResponse follow(@PathVariable Long memberId,@AuthenticationPrincipal Jwt jwt) { return follows.change(Long.valueOf(jwt.getSubject()),memberId,true); }
    @DeleteMapping("/{memberId:[0-9]+}/follows") @SecurityRequirement(name="memberBearer")
    @Operation(summary="Unfollow a member",description="Own Bearer required. Repeated DELETE is idempotent. The relation becomes inactive and its history is retained. Self400, inactive/missing target404, inactive actor401.")
    public FollowResponse unfollow(@PathVariable Long memberId,@AuthenticationPrincipal Jwt jwt) { return follows.change(Long.valueOf(jwt.getSubject()),memberId,false); }
    @GetMapping("/{memberId:[0-9]+}/follows")
    @Operation(summary="Read follow counts and own relationship",description="Public counts; optional valid member Bearer adds followed/follower/mine flags. Anonymous flags are false. Inactive/missing target404; invalid/inactive viewer401. No email or private identity is exposed.")
    public ResponseEntity<MemberFollows.Summary> summary(@PathVariable Long memberId,@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(follows.summary(memberId,jwt==null ? null : Long.valueOf(jwt.getSubject())));
    }
    @GetMapping("/{memberId:[0-9]+}/followers")
    @Operation(summary="List active followers",description="Public. Descending relation ID cursor; omit cursorId initially, use nextCursorId when hasNext. size1-10(default10), keyword literal nickname substring up to12 characters, case-insensitive. Reset cursor on search change. Invalid input400, missing/inactive owner404. No avatar/best-count placeholder fields.")
    public FollowPage followers(@PathVariable Long memberId,@RequestParam(required=false) Long cursorId,@RequestParam(required=false) Integer size,@RequestParam(required=false) String keyword) { return follows.list(memberId,true,cursorId,size,keyword); }
    @GetMapping("/{memberId:[0-9]+}/followings")
    @Operation(summary="List active followed members",description="Same cursor/size/keyword contract as followers. Soft-deleted relations and withdrawn members are excluded.")
    public FollowPage followings(@PathVariable Long memberId,@RequestParam(required=false) Long cursorId,@RequestParam(required=false) Integer size,@RequestParam(required=false) String keyword) { return follows.list(memberId,false,cursorId,size,keyword); }
}
