package com.yogimangchi.trading.ops;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/trading/admin/audit-logs", produces = MediaType.APPLICATION_JSON_VALUE)
@SecurityRequirement(name = "memberBearer")
@Tag(name = "Admin Audit Logs", description = "Cursor-paginated trading-server administrative action audit log")
public class AdminAuditLogController {
    private final AdminAuditLogService auditLogs;

    public AdminAuditLogController(AdminAuditLogService auditLogs) {
        this.auditLogs = auditLogs;
    }

    @GetMapping
    @Operation(
            summary = "List trading-server admin audit logs",
            description = "Admin only (ROLE_ADMIN). Returns newest-first cursor-paginated audit records for symbol halts, risk hold releases, ops sweeps, and contest management actions.")
    public ResponseEntity<AdminAuditLogService.AuditLogPageResponse> list(
            @RequestParam(required = false) Long cursorId,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(auditLogs.list(cursorId, size));
    }
}
