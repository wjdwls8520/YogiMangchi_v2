package com.yogimangchi.content.ops;

import com.yogimangchi.content.auth.security.ActiveMemberFilter;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
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
            summary = "Get content-server $0 operational diagnostics summary (DB-outage resilient)",
            description = "Admin Bearer required. Returns DB health/latency, JVM runtime, HikariCP pool, per-source RSS status, S3 storage & failed cleanup details, outbox backlogs & stuck items, alerts telemetry, critical 5xx & rolling error metrics, active SSE counts, and bounded client errors. Still returns 200 OK with db.up=false during PostgreSQL outage when authenticated with a valid RS256 ADMIN JWT."
    )
    public ResponseEntity<AdminOpsService.OpsSummaryResponse> summary(
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest request) {
        Long adminId = Long.valueOf(jwt.getSubject());
        boolean degraded = request != null
                && Boolean.TRUE.equals(request.getAttribute(ActiveMemberFilter.DEGRADED_DB_OUTAGE_ADMIN_ATTR));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminOps.summary(adminId, degraded));
    }

    @PostMapping("/s3-cleanup/retry-failed")
    @Operation(
            summary = "Reset FAILED s3_cleanup_task rows back to PENDING with attempt_count=0",
            description = "Admin Bearer required. Records audit log and returns count of retried cleanup tasks."
    )
    public ResponseEntity<AdminOpsService.S3CleanupRetryResponse> retryFailedS3Cleanup(@AuthenticationPrincipal Jwt jwt) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminOps.retryFailedS3Cleanup(adminId));
    }

    @PostMapping("/outbox/retry")
    @Operation(
            summary = "Re-arm pending/failed outbox deliveries (withdrawal, provisioning, suspension, S3 cleanup) and trigger immediate sweep",
            description = "Admin Bearer required. Records audit log."
    )
    public ResponseEntity<AdminOpsService.OutboxRetryResponse> retryOutbox(@AuthenticationPrincipal Jwt jwt) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminOps.retryOutbox(adminId));
    }

    @PostMapping("/test-alert")
    @Operation(
            summary = "Send a live test webhook alert via OpsAlertService and record an admin audit log",
            description = "Admin Bearer required. Auto-formats for Discord, Slack, Telegram, or Generic webhook targets."
    )
    public ResponseEntity<OpsAlertService.TestAlertResponse> sendTestAlert(@AuthenticationPrincipal Jwt jwt) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminOps.sendTestAlert(adminId));
    }
}
