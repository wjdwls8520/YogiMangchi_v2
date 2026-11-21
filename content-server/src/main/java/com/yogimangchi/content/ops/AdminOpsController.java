package com.yogimangchi.content.ops;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/admin/ops", produces = MediaType.APPLICATION_JSON_VALUE)
@SecurityRequirement(name = "memberBearer")
public class AdminOpsController {

    private final AdminOpsService adminOps;

    public AdminOpsController(AdminOpsService adminOps) {
        this.adminOps = adminOps;
    }

    @GetMapping("/summary")
    @Operation(
            summary = "Get content-server $0 operational diagnostics summary",
            description = "Admin Bearer required. Returns DB health, RSS news ingestion status, outbox backlogs, open support inquiry count, active SSE connection counts, and recent 5xx/409/503 errors."
    )
    public ResponseEntity<AdminOpsService.OpsSummaryResponse> summary(@AuthenticationPrincipal Jwt jwt) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminOps.summary(adminId));
    }

    @PostMapping("/s3-cleanup/retry-failed")
    @Operation(
            summary = "Reset FAILED s3_cleanup_task rows back to PENDING with attempt_count=0",
            description = "Admin Bearer required. Returns count of retried cleanup tasks."
    )
    public ResponseEntity<AdminOpsService.S3CleanupRetryResponse> retryFailedS3Cleanup(@AuthenticationPrincipal Jwt jwt) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminOps.retryFailedS3Cleanup(adminId));
    }
}
