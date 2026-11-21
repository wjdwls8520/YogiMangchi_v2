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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/trading/admin/ops", produces = "application/json")
@SecurityRequirement(name = "memberBearer")
@Tag(name = "Admin Ops", description = "Lightweight operational diagnostics and safe reconciliation-gated hold release")
public class AdminOpsController {
    public record ReleaseHoldRequest(String reference) { }

    private final AdminOpsService ops;

    public AdminOpsController(AdminOpsService ops) {
        this.ops = ops;
    }

    @GetMapping("/summary")
    @Operation(
            summary = "Read operational diagnostics summary",
            description = "Admin only (ROLE_ADMIN). Returns engine status, dependency health, durable risk worker measurements, unresolved holds, pending/held risk work, ledger mismatch count, active WebSockets, and last 50 sanitized API errors.")
    public ResponseEntity<AdminOpsService.OpsSummaryResponse> summary() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ops.summary());
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
