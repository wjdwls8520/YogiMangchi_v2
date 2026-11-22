package com.yogimangchi.content.admin;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/admin/banned-oauth-identities", produces = "application/json")
@SecurityRequirement(name = "memberBearer")
public class AdminBannedOAuthController {

    private final AdminMemberService adminMemberService;

    public AdminBannedOAuthController(AdminMemberService adminMemberService) {
        this.adminMemberService = adminMemberService;
    }

    @GetMapping
    @Operation(
            summary = "List banned OAuth identities with optional provider/keyword filters and pagination",
            description = "Admin Bearer required. Supports page or cursorId pagination."
    )
    public ResponseEntity<AdminMemberService.BannedOAuthIdentityPageResponse> listBannedIdentities(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false, defaultValue = "ALL") String provider,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false, defaultValue = "0") Integer page,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "20") Integer size) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminMemberService.listBannedOAuthIdentities(adminId, provider, keyword, page, cursorId, size));
    }

    @DeleteMapping("/{id:[0-9]+}")
    @Operation(
            summary = "Remove a banned OAuth identity so the user can sign up again (records persistent admin audit log)",
            description = "Admin Bearer required."
    )
    public ResponseEntity<Void> unbanIdentity(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long id) {
        Long adminId = Long.valueOf(jwt.getSubject());
        adminMemberService.unbanOAuthIdentity(adminId, id);
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
    }
}
