package com.yogimangchi.trading.contest;

import com.yogimangchi.trading.contest.ContestDtos.AdminBulkApproveRequest;
import com.yogimangchi.trading.contest.ContestDtos.AdminDisqualifyParticipantResponse;
import com.yogimangchi.trading.contest.ContestDtos.AdminDisqualifyRequest;
import com.yogimangchi.trading.contest.ContestDtos.AdminParticipantView;
import com.yogimangchi.trading.contest.ContestDtos.AdminRejectRequest;
import com.yogimangchi.trading.contest.ContestDtos.AdminSeasonDeleteResponse;
import com.yogimangchi.trading.contest.ContestDtos.AdminSeasonDetailResponse;
import com.yogimangchi.trading.contest.ContestDtos.AdminSeasonListResponse;
import com.yogimangchi.trading.contest.ContestDtos.AdminSeasonStatusPatchRequest;
import com.yogimangchi.trading.contest.ContestDtos.AdminSeasonUpsertRequest;
import com.yogimangchi.trading.contest.ContestDtos.ContestApplicationView;
import com.yogimangchi.trading.contest.ContestDtos.ContestSettlementResultResponse;
import com.yogimangchi.trading.contest.ContestDtos.SeasonView;
import com.yogimangchi.trading.ops.AdminAuditLogService;
import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/trading/admin/contest")
@Tag(name = "Admin Contest", description = "Admin contest season management, application approval, participant disqualification, and chunk-500 settlement")
public class AdminContestController {

    private final ContestService contestService;
    private final ContestSettlementService settlementService;
    private final ObjectProvider<AdminAuditLogService> auditLogs;

    public AdminContestController(ContestService contestService, ContestSettlementService settlementService) {
        this(contestService, settlementService, null);
    }

    @Autowired
    public AdminContestController(
            ContestService contestService,
            ContestSettlementService settlementService,
            ObjectProvider<AdminAuditLogService> auditLogs) {
        this.contestService = contestService;
        this.settlementService = settlementService;
        this.auditLogs = auditLogs;
    }

    @GetMapping("/seasons")
    @Operation(summary = "List all contest seasons with counts for admin dashboard")
    public AdminSeasonListResponse listSeasons(
            @RequestParam(required = false) Long cursorId,
            @RequestParam(defaultValue = "20") int size) {
        return contestService.getAdminSeasons(cursorId, size);
    }

    @PostMapping("/seasons")
    @Operation(summary = "Create a new contest season")
    public SeasonView createSeason(
            @AuthenticationPrincipal TradingPrincipal principal,
            @RequestBody AdminSeasonUpsertRequest request) {
        return contestService.createSeason(principal.memberId(), request);
    }

    @PutMapping("/seasons/{seasonId:[0-9]+}")
    @Operation(summary = "Update an existing contest season (rejected if canceled or settled)")
    public SeasonView updateSeason(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @RequestBody AdminSeasonUpsertRequest request) {
        return contestService.updateSeason(principal != null ? principal.memberId() : null, seasonId, request);
    }

    @PatchMapping("/seasons/{seasonId:[0-9]+}/status")
    @Operation(summary = "Toggle contest season visibility (isPublic) or cancellation (isCanceled)")
    public SeasonView patchSeasonStatus(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @RequestBody AdminSeasonStatusPatchRequest request) {
        return contestService.patchSeasonStatus(principal != null ? principal.memberId() : null, seasonId, request);
    }

    @DeleteMapping("/seasons/{seasonId:[0-9]+}")
    @Operation(
            summary = "Delete a draft/recruiting season with 0 participants or a canceled season with 0 active exposure",
            description = "Admin only (ROLE_ADMIN). Hard-deletes seasons with 0 contest accounts; hides/archives canceled seasons that retain immutable financial history without deleting ledger rows.")
    public AdminSeasonDeleteResponse deleteSeason(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId) {
        return contestService.deleteSeason(principal != null ? principal.memberId() : null, seasonId);
    }

    @GetMapping("/seasons/{seasonId:[0-9]+}")
    @Operation(summary = "Get contest season detail, applicants, participants, and settlement runs")
    public AdminSeasonDetailResponse getSeasonDetail(@PathVariable Long seasonId) {
        return contestService.getAdminSeasonDetail(seasonId);
    }

    @PostMapping("/seasons/{seasonId:[0-9]+}/applicants/{applicationId:[0-9]+}/approve")
    @Operation(summary = "Approve a contest application and provision the season-isolated contest wallet")
    public AdminParticipantView approveApplication(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long applicationId) {
        return contestService.approveApplication(principal.memberId(), seasonId, applicationId);
    }

    @PostMapping("/seasons/{seasonId:[0-9]+}/applicants/bulk-approve")
    @Operation(summary = "Bulk approve pending contest applications and provision season-isolated contest wallets")
    public List<AdminParticipantView> bulkApproveApplications(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @RequestBody(required = false) AdminBulkApproveRequest request) {
        return contestService.bulkApproveApplications(
                principal.memberId(),
                seasonId,
                request != null ? request.applicationIds() : null);
    }

    @PostMapping("/seasons/{seasonId:[0-9]+}/applicants/{applicationId:[0-9]+}/reject")
    @Operation(summary = "Reject a contest application with a reason")
    public ContestApplicationView rejectApplication(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long applicationId,
            @RequestBody(required = false) AdminRejectRequest request) {
        return contestService.rejectApplication(
                principal.memberId(),
                seasonId,
                applicationId,
                request != null ? request.reason() : null);
    }

    @PostMapping("/seasons/{seasonId:[0-9]+}/participants/{memberId:[0-9]+}/disqualify")
    @Operation(
            summary = "Disqualify a contest participant",
            description = "Admin only (ROLE_ADMIN). Atomically cancels pending orders, administratively closes open positions (expiring active SL/TP), marks participant DISQUALIFIED and application REJECTED, and records an audit log entry.")
    public AdminDisqualifyParticipantResponse disqualifyParticipant(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId,
            @PathVariable Long memberId,
            @RequestBody(required = false) AdminDisqualifyRequest request) {
        return contestService.disqualifyParticipant(
                principal != null ? principal.memberId() : null,
                seasonId,
                memberId,
                request != null ? request.reason() : null);
    }

    @PostMapping("/seasons/{seasonId:[0-9]+}/settle")
    @Operation(summary = "Early-terminate (if still live) and settle a contest season using 500-item chunks")
    public ContestSettlementResultResponse settleSeason(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId) {
        ContestSettlementResultResponse result = settlementService.settleSeason(seasonId, "ADMIN:" + principal.memberId(), true);
        recordAudit(principal.memberId(), "CONTEST_SEASON_SETTLE", "CONTEST_SEASON", Long.toString(seasonId),
                "runId=" + result.runId() + " canceledOrders=" + result.canceledOrderCount()
                        + " liquidatedPositions=" + result.liquidatedPositionCount()
                        + " participants=" + result.finalizedParticipantCount());
        return result;
    }

    @PostMapping("/seasons/{seasonId:[0-9]+}/cleanup-remaining")
    @Operation(summary = "Re-cancel any remaining pending orders and force-liquidate any remaining open positions in 500-item chunks")
    public ContestSettlementResultResponse cleanupRemaining(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long seasonId) {
        ContestSettlementResultResponse result = settlementService.cleanupRemainingExposure(seasonId, "ADMIN_CLEANUP:" + principal.memberId());
        recordAudit(principal.memberId(), "CONTEST_SEASON_CLEANUP_REMAINING", "CONTEST_SEASON", Long.toString(seasonId),
                "runId=" + result.runId() + " canceledOrders=" + result.canceledOrderCount()
                        + " liquidatedPositions=" + result.liquidatedPositionCount());
        return result;
    }

    private void recordAudit(Long adminMemberId, String action, String targetType, String targetId, String detail) {
        AdminAuditLogService audit = auditLogs != null ? auditLogs.getIfAvailable() : null;
        if (audit != null) {
            audit.record(adminMemberId, action, targetType, targetId, detail);
        }
    }
}
