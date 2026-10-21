package com.yogimangchi.content.member.controller;

import com.yogimangchi.content.member.service.MemberQueries;
import com.yogimangchi.content.member.dto.MemberProfileResponse;
import com.yogimangchi.content.member.dto.PublicMemberProfileResponse;
import com.yogimangchi.content.member.dto.UpdateProfileRequest;
import com.yogimangchi.content.member.service.MemberProfiles;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.validation.Valid;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/members",produces="application/json")
public class MemberController {
    private final MemberQueries members;
    private final MemberProfiles profiles;
    public MemberController(MemberQueries members,MemberProfiles profiles) { this.members=members; this.profiles=profiles; }
    @GetMapping("/me")
    @SecurityRequirement(name="memberBearer")
    public ResponseEntity<MemberProfileResponse> me(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(members.ownProfile(jwt.getSubject()));
    }
    @GetMapping("/{memberId:[0-9]+}")
    @Operation(summary="Read an active member's public profile",description="No email, provider identity or private role is returned. Missing/withdrawn members return404. Does not read Trading tables or expose financial data.")
    public ResponseEntity<PublicMemberProfileResponse> publicProfile(@PathVariable Long memberId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(profiles.publicProfile(memberId));
    }
    public record NicknameAvailability(boolean available) { }
    @GetMapping("/nickname/availability")
    @Operation(summary="Check nickname availability",description="Public. Korean/English letters and digits,2-12 characters. Invalid input400. Availability is advisory; signup/profile changes still enforce DB uniqueness and can return409.")
    public NicknameAvailability available(@RequestParam String nickname) { return new NicknameAvailability(profiles.nicknameAvailable(nickname)); }
    @PatchMapping("/me/profile")
    @SecurityRequirement(name="memberBearer")
    @Operation(summary="Change own nickname or profile message",description="Bearer only; memberId comes from verified JWT. Provide nickname and/or profileMessage. Messages up to255 characters; empty clears, omitted/null preserves. 400 invalid,401 inactive/invalid credential,409 duplicate nickname or lock contention. Retained older messages above255 are not silently truncated: submit a valid replacement when editing. No image upload in this endpoint.")
    public ResponseEntity<MemberProfileResponse> update(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody UpdateProfileRequest body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(profiles.change(Long.valueOf(jwt.getSubject()),body));
    }
}
