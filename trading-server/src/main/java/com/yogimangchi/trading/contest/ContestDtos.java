package com.yogimangchi.trading.contest;

import com.yogimangchi.trading.tradingaccount.dto.AccountSummaryResponse;
import java.time.Instant;
import java.util.List;

public final class ContestDtos {
    private ContestDtos() { }

    public record SeasonView(
            Long id,
            String title,
            String description,
            String seedMoney,
            Instant recruitmentStartAt,
            Instant recruitmentEndAt,
            Instant contestStartAt,
            Instant contestEndAt,
            boolean isPublic,
            boolean isCanceled,
            Instant settledAt,
            String displayStatus,
            String statusLabel,
            long participantCount,
            long applicantCount,
            long pendingOrderCount,
            long openPositionCount,
            Instant createdAt,
            Instant updatedAt) { }

    public record PublicSeasonsOverviewResponse(
            List<SeasonView> recruiting,
            List<SeasonView> running,
            List<SeasonView> finished,
            List<SeasonView> seasons) { }

    public record LeaderboardEntry(
            int rank,
            Long participantId,
            Long memberId,
            String nickname,
            Long accountId,
            String seedMoney,
            String totalEquity,
            String balance,
            String realizedPnl,
            String unrealizedPnl,
            String roiPct,
            long openPositionCount,
            boolean settled,
            Instant settledAt,
            long tradeCount,
            String winRate) { }

    public record LeaderboardPageResponse(
            SeasonView season,
            List<LeaderboardEntry> items,
            Long nextCursorId,
            boolean hasNext) { }

    public record MemberContestParticipationView(
            Long seasonId,
            String title,
            String description,
            String displayStatus,
            String statusLabel,
            Instant recruitmentStartAt,
            Instant recruitmentEndAt,
            Instant contestStartAt,
            Instant contestEndAt,
            Instant settledAt,
            Long participantId,
            Long memberId,
            String nickname,
            Long accountId,
            String seedMoney,
            String balance,
            String availableBalance,
            String usedMargin,
            String reservedMargin,
            String totalEquity,
            String realizedPnl,
            String unrealizedPnl,
            String totalPnl,
            String roiPct,
            Integer rank,
            long totalParticipants,
            long openPositionCount,
            long pendingOrderCount,
            long tradeCount,
            String winRate) { }

    public record MemberContestSeasonsResponse(
            Long memberId,
            MemberContestParticipationView activeSeason,
            List<MemberContestParticipationView> participatingSeasons,
            List<MemberContestParticipationView> pastSeasons) { }

    public record RecruitingSeasonForMemberView(
            SeasonView season,
            boolean applied,
            String applicationStatus,
            Long applicationId,
            String rejectReason) { }

    public record ContestApplicationView(
            Long applicationId,
            Long seasonId,
            String seasonTitle,
            String seasonDisplayStatus,
            Instant contestStartAt,
            Instant contestEndAt,
            Long memberId,
            String nickname,
            String status,
            String rejectReason,
            Instant appliedAt,
            Instant processedAt,
            Long processedByMemberId) { }

    public record MyContestOverviewResponse(
            List<MemberContestParticipationView> participatingSeasons,
            List<RecruitingSeasonForMemberView> recruitingSeasons,
            List<ContestApplicationView> pendingApplications,
            List<ContestApplicationView> rejectedApplications) { }

    public record ApplyContestRequest(String nickname) { }

    public record ContestSeasonSummaryResponse(
            SeasonView season,
            MemberContestParticipationView participation,
            AccountSummaryResponse accountSummary) { }

    public record AdminSeasonUpsertRequest(
            String title,
            String description,
            String seedMoney,
            Instant recruitmentStartAt,
            Instant recruitmentEndAt,
            Instant contestStartAt,
            Instant contestEndAt,
            Boolean isPublic) { }

    public record AdminSeasonStatusPatchRequest(
            Boolean isPublic,
            Boolean isCanceled) { }

    public record AdminRejectRequest(String reason) { }

    public record AdminBulkApproveRequest(List<Long> applicationIds) { }

    public record AdminSeasonListResponse(
            long totalCount,
            long recruitingCount,
            long liveCount,
            long finishedCount,
            List<SeasonView> items,
            Long nextCursorId,
            boolean hasNext) { }

    public record AdminParticipantView(
            Long participantId,
            Long seasonId,
            Long memberId,
            String nickname,
            Long accountId,
            String accountStatus,
            String seedMoney,
            String balance,
            String usedMargin,
            String reservedMargin,
            String totalEquity,
            String realizedPnl,
            String unrealizedPnl,
            String roiPct,
            Integer rank,
            long openPositionCount,
            long pendingOrderCount,
            Instant appliedAt,
            Instant approvedAt,
            Instant settledAt,
            long tradeCount,
            String winRate) { }

    public record SettlementRunView(
            Long id,
            Long seasonId,
            int attemptNo,
            String triggeredBy,
            String status,
            String lastCompletedPhase,
            int deactivatedWalletCount,
            int canceledOrderCount,
            int liquidatedPositionCount,
            int finalizedParticipantCount,
            String failureReason,
            Instant startedAt,
            Instant completedAt) { }

    public record AdminSeasonDetailResponse(
            SeasonView season,
            long pendingOrderCount,
            long openPositionCount,
            List<SettlementRunView> settlementRuns,
            List<ContestApplicationView> applicants,
            List<AdminParticipantView> participants,
            List<ContestApplicationView> rejectedApplicants) { }

    public record ContestSettlementResultResponse(
            Long runId,
            Long seasonId,
            int attemptNo,
            String triggeredBy,
            String status,
            String lastCompletedPhase,
            int deactivatedWalletCount,
            int canceledOrderCount,
            int liquidatedPositionCount,
            int finalizedParticipantCount,
            Instant startedAt,
            Instant completedAt,
            Instant settledAt) { }
}
