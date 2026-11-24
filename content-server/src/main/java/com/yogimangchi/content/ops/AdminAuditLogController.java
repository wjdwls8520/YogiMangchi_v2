package com.yogimangchi.content.ops;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/admin/audit-logs", produces = MediaType.APPLICATION_JSON_VALUE)
@SecurityRequirement(name = "memberBearer")
public class AdminAuditLogController {

    private final AdminAuditLogService auditLogs;

    public AdminAuditLogController(AdminAuditLogService auditLogs) {
        this.auditLogs = auditLogs;
    }

    @GetMapping
    @Operation(
            summary = "List persistent content-server admin audit logs",
            description = "Admin Bearer required. Cursor-paginated with optional action and adminMemberId filters."
    )
    public ResponseEntity<AdminAuditLogService.AuditLogPageResponse> listAuditLogs(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "20") Integer size,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) Long adminMemberId) {
        Long callerId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(auditLogs.list(callerId, cursorId, size, action, adminMemberId));
    }
}
