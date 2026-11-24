package com.yogimangchi.trading.ops;

import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/trading/admin/ops", produces = "application/json")
@SecurityRequirement(name = "memberBearer")
@Tag(name = "Admin Ops", description = "Lightweight operational diagnostics, proactive alerting test, on-demand reconciliation, and safe hold release")
public class AdminOpsController {
    public record ReleaseHoldRequest(String reference) { }
    public record ReconcileNowRequest(Long accountId, Integer limit) { }

    private final AdminOpsService ops;

    public AdminOpsController(AdminOpsService ops) {
        this.ops = ops;
    }

    @GetMapping("/summary")
    @Operation(
            summary = "Read operational diagnostics summary (DB-outage resilient)",
            description = "Admin only (ROLE_ADMIN). Returns engine status, dependency health, runtime/JVM & HikariCP metrics, Redis & Binance WS telemetry, durable risk worker measurements, unresolved holds, ledger mismatch details, active WebSockets & SSE counts, market overview health, separated error buffers/metrics, and alert dispatch history.")
    public ResponseEntity<AdminOpsService.OpsSummaryResponse> summary() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ops.summary());
    }

    @PostMapping("/test-alert")
    @Operation(
            summary = "Dispatch a test operational alert webhook",
            description = "Admin only (ROLE_ADMIN). Sends a provider-formatted test alert (Discord/Slack/Telegram/Generic) bypassing cooldown, or returns structured DISABLED status when OPS_ALERT_WEBHOOK_URL is blank.")
    public ResponseEntity<OpsAlertService.TestAlertResponse> testAlert(
            @AuthenticationPrincipal TradingPrincipal principal) {
        Long adminMemberId = principal != null ? principal.memberId() : null;
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ops.dispatchTestAlert(adminMemberId));
    }

    @PostMapping("/reconcile-now")
    @Operation(
            summary = "Run an on-demand bounded ledger reconciliation sweep (or check a specific account)",
            description = "Admin only (ROLE_ADMIN). Reconciles either the specified accountId or up to limit (1-200, default 50) accounts and returns the fresh mismatch list.")
    public ResponseEntity<AdminOpsService.ReconcileNowResult> reconcileNow(
            @AuthenticationPrincipal TradingPrincipal principal,
            @RequestParam(required = false) Long accountId,
            @RequestParam(required = false) Integer limit,
            @RequestBody(required = false) ReconcileNowRequest request) {
        Long adminMemberId = principal != null ? principal.memberId() : null;
        Long effectiveAccountId = accountId != null ? accountId : (request != null ? request.accountId() : null);
        Integer effectiveLimit = limit != null ? limit : (request != null ? request.limit() : null);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ops.reconcileNow(adminMemberId, effectiveAccountId, effectiveLimit));
    }

    @PostMapping("/holds/{accountId:[0-9]+}/release")
    @Operation(
            summary = "Reconcile account ledger and release unresolved holds only when MATCHED",
            description = "Admin only (ROLE_ADMIN). Runs LedgerReconciler.reconcile(accountId) first and re-verifies under AccountLock. Returns 200 with releasedCount when MATCHED; returns 409 Conflict with failedChecks and releasedCount=0 if still MISMATCH or UNVERIFIED.")
    public ResponseEntity<AdminOpsService.HoldReleaseResult> releaseHolds(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable long accountId,
            @RequestBody(required = false) ReleaseHoldRequest request) {
        Long adminMemberId = principal != null ? principal.memberId() : null;
        String reference = request != null ? request.reference() : null;
        AdminOpsService.HoldReleaseResult result = ops.releaseHoldsIfMatched(accountId, adminMemberId, reference);
        HttpStatus status = result.released() ? HttpStatus.OK : HttpStatus.CONFLICT;
        return ResponseEntity.status(status)
                .cacheControl(CacheControl.noStore())
                .body(result);
    }
}
