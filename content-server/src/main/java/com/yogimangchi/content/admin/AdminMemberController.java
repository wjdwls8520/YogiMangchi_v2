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
@RequestMapping(value = "/api/v1/admin/members", produces = "application/json")
@SecurityRequirement(name = "memberBearer")
public class AdminMemberController {

    private final AdminMemberService adminMemberService;

    public AdminMemberController(AdminMemberService adminMemberService) {
        this.adminMemberService = adminMemberService;
    }

    @GetMapping
    @Operation(summary = "List members for admin management with status, role, memberId, nickname, and cursor pagination")
    public ResponseEntity<AdminMemberService.AdminMemberCursorResponse> listMembers(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false, defaultValue = "ALL") String status,
            @RequestParam(required = false, defaultValue = "ALL") String role,
            @RequestParam(required = false) Long memberId,
            @RequestParam(required = false) String nickname,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "10") Integer size) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminMemberService.listMembers(adminId, status, role, memberId, nickname, cursorId, size));
    }

    @DeleteMapping("/{memberId:[0-9]+}")
    @Operation(summary = "Force withdraw a non-admin member by admin")
    public ResponseEntity<Void> forceWithdrawMember(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long memberId) {
        Long adminId = Long.valueOf(jwt.getSubject());
        adminMemberService.forceWithdrawMember(adminId, memberId);
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
    }
}
