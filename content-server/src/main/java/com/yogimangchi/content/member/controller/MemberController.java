package com.yogimangchi.content.member.controller;

import com.yogimangchi.content.member.service.MemberQueries;
import com.yogimangchi.content.member.dto.MemberProfileResponse;
import com.yogimangchi.content.member.dto.PublicMemberProfileResponse;
import com.yogimangchi.content.member.dto.UpdateProfileRequest;
import com.yogimangchi.content.member.service.MemberProfiles;
import com.yogimangchi.content.member.service.MemberWithdrawals;
import com.yogimangchi.content.auth.controller.AuthController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
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
    private final MemberWithdrawals withdrawals;
    private final boolean secureCookies;
    public MemberController(MemberQueries members,MemberProfiles profiles,MemberWithdrawals withdrawals,@Value("${content.auth.secure-cookies}") boolean secureCookies) { this.members=members; this.profiles=profiles; this.withdrawals=withdrawals; this.secureCookies=secureCookies; }
    @PostMapping("/me/withdrawal")
    @SecurityRequirement(name="memberBearer")
    @Operation(summary="Withdraw own membership",description="Bearer only. Soft-deletes membership, revokes refresh sessions and durably requests Trading cleanup. Returns202 PENDING until Trading acknowledges;200 COMPLETED on a later repeat. Repeats are idempotent. Trading cancels pending orders and administratively closes positions without market fills, new PnL or fees. No Guest history merge. Existing Access may remain valid in Trading until delivery, at most its15-minute expiry.")
    public ResponseEntity<MemberWithdrawals.Result> withdraw(@AuthenticationPrincipal Jwt jwt,HttpServletRequest request) {
        var result=withdrawals.request(Long.valueOf(jwt.getSubject()));
        if(request.getSession(false)!=null) request.getSession(false).invalidate();
        var expired=ResponseCookie.from(AuthController.REFRESH_COOKIE,"").path("/api/v1/auth").httpOnly(true)
                .secure(secureCookies).sameSite("Lax").maxAge(0).build();
        return ResponseEntity.status(result.status().equals("COMPLETED") ? 200 : 202).header(HttpHeaders.SET_COOKIE,expired.toString())
                .cacheControl(CacheControl.noStore()).body(result);
    }
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
    @Operation(summary="Check nickname availability",description="Public.1-8 Unicode code points in Letter/Number categories (L/N), matching Frontend Unicode u regex. Spaces/punctuation/emoji/control/invisible separators rejected400. Availability is advisory; signup/profile changes still enforce DB uniqueness and can return409. Legacy9-12-character nicknames remain readable/login-capable but cannot be submitted as new nickname input.")
    public NicknameAvailability available(@RequestParam String nickname) { return new NicknameAvailability(profiles.nicknameAvailable(nickname)); }
    @PatchMapping("/me/profile")
    @SecurityRequirement(name="memberBearer")
    @Operation(summary="Change own nickname or profile message",description="Bearer only; memberId comes from verified JWT. A provided nickname must be1-8 Unicode Letter/Number code points (L/N). Omitted/null nickname preserves legacy9-12-character names, including on message-only changes. Messages up to255 characters; empty clears, omitted/null preserves. 400 invalid,401 inactive/invalid credential,409 duplicate nickname or lock contention. Retained older messages above255 are not silently truncated: submit a valid replacement when editing. No image upload in this endpoint.")
    public ResponseEntity<MemberProfileResponse> update(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody UpdateProfileRequest body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(profiles.change(Long.valueOf(jwt.getSubject()),body));
    }
}
