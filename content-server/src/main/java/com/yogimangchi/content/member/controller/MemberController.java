package com.yogimangchi.content.member.controller;

import com.yogimangchi.content.member.service.MemberQueries;
import com.yogimangchi.content.member.dto.MemberProfileResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/members",produces="application/json")
@SecurityRequirement(name="memberBearer")
public class MemberController {
    private final MemberQueries members;
    public MemberController(MemberQueries members) { this.members=members; }
    @GetMapping("/me")
    public ResponseEntity<MemberProfileResponse> me(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(members.ownProfile(jwt.getSubject()));
    }
}
