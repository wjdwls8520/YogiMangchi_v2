package com.yogimangchi.trading.contest;

import com.yogimangchi.trading.contest.ContestDtos.AdminParticipantView;
import com.yogimangchi.trading.contest.ContestDtos.AdminSeasonDetailResponse;
import com.yogimangchi.trading.contest.ContestDtos.AdminSeasonListResponse;
import com.yogimangchi.trading.contest.ContestDtos.AdminSeasonStatusPatchRequest;
import com.yogimangchi.trading.contest.ContestDtos.AdminSeasonUpsertRequest;
import com.yogimangchi.trading.contest.ContestDtos.ApplyContestRequest;
import com.yogimangchi.trading.contest.ContestDtos.ContestApplicationView;
import com.yogimangchi.trading.contest.ContestDtos.ContestSeasonSummaryResponse;
import com.yogimangchi.trading.contest.ContestDtos.LeaderboardEntry;
import com.yogimangchi.trading.contest.ContestDtos.LeaderboardPageResponse;
import com.yogimangchi.trading.contest.ContestDtos.MemberContestParticipationView;
import com.yogimangchi.trading.contest.ContestDtos.MemberContestSeasonsResponse;
import com.yogimangchi.trading.contest.ContestDtos.MyContestOverviewResponse;
import com.yogimangchi.trading.contest.ContestDtos.PublicSeasonsOverviewResponse;
import com.yogimangchi.trading.contest.ContestDtos.RecruitingSeasonForMemberView;
import com.yogimangchi.trading.contest.ContestDtos.SeasonView;
import com.yogimangchi.trading.contest.ContestDtos.SettlementRunView;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.tradingaccount.dto.AccountSummaryResponse;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.repository.TradingAccountRepository;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.service.AccountValuation;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ContestService {
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final BigDecimal DEFAULT_SEED = new BigDecimal("10000");

    private final JdbcTemplate jdbc;
    private final EntityManager entities;
    private final TradingAccountRepository accounts;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final AccountValuation valuation;
    private final TradingAccountService tradingAccountService;

    public ContestService(
            JdbcTemplate jdbc,
            EntityManager entities,
            TradingAccountRepository accounts,
            WalletRepository wallets,
            PositionRepository positions,
            AccountValuation valuation,
            TradingAccountService tradingAccountService) {
        this.jdbc = jdbc;
        this.entities = entities;
        this.accounts = accounts;
        this.wallets = wallets;
        this.positions = positions;
        this.valuation = valuation;
        this.tradingAccountService = tradingAccountService;
    }

    private static final String SEASON_SELECT = """
            SELECT s.*,
                   (SELECT COUNT(*) FROM trading.contest_participant cp WHERE cp.contest_season_id = s.id) AS participant_count,
                   (SELECT COUNT(*) FROM trading.contest_application ca WHERE ca.contest_season_id = s.id AND ca.status = 'PENDING') AS applicant_count,
                   (SELECT COUNT(*) FROM trading.trading_order o JOIN trading.trading_account a ON a.id = o.account_id
                    WHERE a.contest_season_id = s.id AND a.account_type = 'CONTEST' AND o.status = 'PENDING') AS pending_order_count,
                   (SELECT COUNT(*) FROM trading.position p JOIN trading.trading_account a ON a.id = p.account_id
                    WHERE a.contest_season_id = s.id AND a.account_type = 'CONTEST' AND p.status = 'OPEN') AS open_position_count
            FROM trading.contest_season s
            """;

    @Transactional(readOnly = true, timeout = 5)
    public PublicSeasonsOverviewResponse getPublicSeasons() {
        Instant now = Instant.now();
        List<SeasonView> all = jdbc.query(
                SEASON_SELECT + " WHERE s.is_public = true AND s.is_canceled = false ORDER BY s.contest_start_at DESC, s.id DESC",
                (rs, rowNum) -> mapSeasonView(rs, now));

        List<SeasonView> recruiting = new ArrayList<>();
        List<SeasonView> running = new ArrayList<>();
        List<SeasonView> finished = new ArrayList<>();
        for (SeasonView s : all) {
            if ("FINISHED".equals(s.displayStatus())) {
                finished.add(s);
                continue;
            }
            if ("LIVE".equals(s.displayStatus())) {
                running.add(s);
            }
            if (isCurrentlyRecruiting(s, now)) {
                recruiting.add(s);
            }
        }
        return new PublicSeasonsOverviewResponse(
                List.copyOf(recruiting),
                List.copyOf(running),
                List.copyOf(finished),
                List.copyOf(all));
    }

    @Transactional(readOnly = true, timeout = 5)
    public LeaderboardPageResponse getLeaderboard(Long seasonId, Long cursorId, int size) {
        if (seasonId == null || seasonId <= 0 || size < 1 || size > 100 || (cursorId != null && cursorId < 0)) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        Instant now = Instant.now();
        SeasonView season = requireSeasonView(seasonId, now);
        if (!season.isPublic() || season.isCanceled()) {
            throw new BusinessException(ErrorCode.CONTEST_SEASON_NOT_FOUND);
        }
        List<LeaderboardEntry> allRanked = buildRankedLeaderboard(seasonId);

        int startIndex = 0;
        if (cursorId != null) {
            startIndex = Math.min(cursorId.intValue(), allRanked.size());
        }
        int endIndex = Math.min(startIndex + size, allRanked.size());
        List<LeaderboardEntry> page = allRanked.subList(startIndex, endIndex);
        boolean hasNext = endIndex < allRanked.size();
        Long nextCursor = hasNext ? Long.valueOf(endIndex) : null;

        return new LeaderboardPageResponse(season, List.copyOf(page), nextCursor, hasNext);
    }

    @Transactional(readOnly = true, timeout = 5)
    public MemberContestSeasonsResponse getMemberContestSeasons(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        Instant now = Instant.now();
        List<MemberContestParticipationView> allParticipations = loadMemberParticipations(memberId, true, now);
        List<MemberContestParticipationView> ongoing = allParticipations.stream()
                .filter(p -> !"FINISHED".equals(p.displayStatus()) && !"CANCELED".equals(p.displayStatus()))
                .toList();
        MemberContestParticipationView active = ongoing.stream()
                .filter(p -> "LIVE".equals(p.displayStatus()))
                .findFirst()
                .orElse(ongoing.isEmpty() ? null : ongoing.get(0));
        List<MemberContestParticipationView> past = allParticipations.stream()
                .filter(p -> "FINISHED".equals(p.displayStatus()))
                .toList();
        return new MemberContestSeasonsResponse(memberId, active, ongoing, past);
    }

    @Transactional(readOnly = true, timeout = 5)
    public MyContestOverviewResponse getMyOverview(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw new BusinessException(ErrorCode.MEMBER_ACCOUNT_REQUIRED);
        }
        Instant now = Instant.now();
        List<MemberContestParticipationView> participating = loadMemberParticipations(memberId, false, now);

        List<SeasonView> openSeasons = jdbc.query(
                SEASON_SELECT + " WHERE s.is_public = true AND s.is_canceled = false AND s.settled_at IS NULL ORDER BY s.recruitment_end_at ASC, s.id DESC",
                (rs, rowNum) -> mapSeasonView(rs, now));

        var appRows = jdbc.queryForList("""
                SELECT a.*, s.title AS season_title, s.description AS season_description, s.seed_money,
                       s.recruitment_start_at, s.recruitment_end_at,
                       s.contest_start_at, s.contest_end_at, s.is_public, s.is_canceled, s.settled_at
                FROM trading.contest_application a
                JOIN trading.contest_season s ON s.id = a.contest_season_id
                WHERE a.member_id = ?
                ORDER BY a.id DESC
                """, memberId);

        Map<Long, Map<String, Object>> appBySeason = new HashMap<>();
        List<ContestApplicationView> pendingApps = new ArrayList<>();
        List<ContestApplicationView> rejectedApps = new ArrayList<>();

        for (var row : appRows) {
            long sId = ((Number) row.get("contest_season_id")).longValue();
            appBySeason.putIfAbsent(sId, row);
            String status = (String) row.get("status");
            ContestApplicationView view = mapApplicationRow(row, now);
            if ("PENDING".equals(status)) {
                pendingApps.add(view);
            } else if ("REJECTED".equals(status)) {
                rejectedApps.add(view);
            }
        }

        List<RecruitingSeasonForMemberView> recruiting = new ArrayList<>();
        for (SeasonView s : openSeasons) {
            if (isCurrentlyRecruiting(s, now)) {
                var app = appBySeason.get(s.id());
                boolean applied = app != null && ("PENDING".equals(app.get("status")) || "APPROVED".equals(app.get("status")));
                String appStatus = app != null ? (String) app.get("status") : null;
                Long appId = app != null ? ((Number) app.get("id")).longValue() : null;
                String rejectReason = app != null ? (String) app.get("reject_reason") : null;
                recruiting.add(new RecruitingSeasonForMemberView(s, applied, appStatus, appId, rejectReason));
            }
        }

        return new MyContestOverviewResponse(
                participating,
                List.copyOf(recruiting),
                List.copyOf(pendingApps),
                List.copyOf(rejectedApps));
    }

    @Transactional(timeout = 5)
    public ContestApplicationView applyForSeason(Long memberId, Long seasonId, ApplyContestRequest request) {
        if (memberId == null || memberId <= 0) {
            throw new BusinessException(ErrorCode.MEMBER_ACCOUNT_REQUIRED);
        }
        if (seasonId == null || seasonId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        Instant now = Instant.now();
        OffsetDateTime tsNow = at(now);
        SeasonView season = requireSeasonView(seasonId, now);
        if (!season.isPublic() || season.isCanceled() || season.settledAt() != null
                || now.isBefore(season.recruitmentStartAt()) || now.isAfter(season.recruitmentEndAt())) {
            throw new BusinessException(ErrorCode.CONTEST_NOT_RECRUITING);
        }

        Boolean alreadyParticipant = jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM trading.contest_participant WHERE contest_season_id = ? AND member_id = ?)",
                Boolean.class, seasonId, memberId);
        if (Boolean.TRUE.equals(alreadyParticipant)) {
            throw new BusinessException(ErrorCode.CONTEST_APPLICATION_ALREADY_PROCESSED);
        }

        String rawNickname = request != null && request.nickname() != null ? request.nickname().strip() : "";
        String nickname = rawNickname.isEmpty() ? ("트레이더#" + memberId) : rawNickname;
        if (nickname.length() > 32) {
            nickname = nickname.substring(0, 32);
        }

        Long appId = jdbc.queryForObject("""
                INSERT INTO trading.contest_application (
                    contest_season_id, member_id, nickname, status, reject_reason, applied_at, processed_at, processed_by_member_id
                ) VALUES (?, ?, ?, 'PENDING', NULL, ?, NULL, NULL)
                ON CONFLICT (contest_season_id, member_id)
                DO UPDATE SET
                    nickname = EXCLUDED.nickname,
                    status = CASE WHEN trading.contest_application.status = 'APPROVED' THEN 'APPROVED' ELSE 'PENDING' END,
                    reject_reason = CASE WHEN trading.contest_application.status = 'APPROVED' THEN trading.contest_application.reject_reason ELSE NULL END,
                    applied_at = CASE WHEN trading.contest_application.status = 'APPROVED' THEN trading.contest_application.applied_at ELSE EXCLUDED.applied_at END,
                    processed_at = CASE WHEN trading.contest_application.status = 'APPROVED' THEN trading.contest_application.processed_at ELSE NULL END,
                    processed_by_member_id = CASE WHEN trading.contest_application.status = 'APPROVED' THEN trading.contest_application.processed_by_member_id ELSE NULL END
                RETURNING id
                """, Long.class, seasonId, memberId, nickname, tsNow);

        var row = jdbc.queryForMap("""
                SELECT a.*, s.title AS season_title, s.description AS season_description, s.seed_money,
                       s.recruitment_start_at, s.recruitment_end_at,
                       s.contest_start_at, s.contest_end_at, s.is_public, s.is_canceled, s.settled_at
                FROM trading.contest_application a
                JOIN trading.contest_season s ON s.id = a.contest_season_id
                WHERE a.id = ?
                """, appId);
        if ("APPROVED".equals(row.get("status"))) {
            throw new BusinessException(ErrorCode.CONTEST_APPLICATION_ALREADY_PROCESSED);
        }
        return mapApplicationRow(row, now);
    }

    @Transactional(readOnly = true, timeout = 5)
    public Long requireActiveContestAccountForTrading(Long memberId, Long seasonId) {
        if (memberId == null || memberId <= 0) {
            throw new BusinessException(ErrorCode.MEMBER_ACCOUNT_REQUIRED);
        }
        if (seasonId == null || seasonId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        Instant now = Instant.now();
        SeasonView season = requireSeasonView(seasonId, now);
        if (!season.isPublic() || season.isCanceled() || season.settledAt() != null
                || now.isBefore(season.contestStartAt()) || now.isAfter(season.contestEndAt())) {
            throw new BusinessException(ErrorCode.CONTEST_NOT_RUNNING);
        }
        return requireContestAccountForRead(memberId, seasonId);
    }

    @Transactional(readOnly = true, timeout = 5)
    public Long requireContestAccountForRead(Long memberId, Long seasonId) {
        if (memberId == null || memberId <= 0) {
            throw new BusinessException(ErrorCode.MEMBER_ACCOUNT_REQUIRED);
        }
        if (seasonId == null || seasonId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        var rows = jdbc.queryForList(
                "SELECT account_id FROM trading.contest_participant WHERE contest_season_id = ? AND member_id = ?",
                Long.class, seasonId, memberId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.CONTEST_PARTICIPATION_REQUIRED);
        }
        return rows.get(0);
    }

    @Transactional( timeout = 5)
    public ContestSeasonSummaryResponse getContestSeasonSummary(Long memberId, Long seasonId) {
        Long accountId = requireContestAccountForRead(memberId, seasonId);
        Instant now = Instant.now();
        SeasonView season = requireSeasonView(seasonId, now);
        List<MemberContestParticipationView> all = loadMemberParticipations(memberId, false, now);
        MemberContestParticipationView participation = all.stream()
                .filter(p -> seasonId.equals(p.seasonId()))
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.CONTEST_PARTICIPATION_REQUIRED));
        AccountSummaryResponse accountSummary = tradingAccountService.summary(accountId);
        return new ContestSeasonSummaryResponse(season, participation, accountSummary);
    }

    @Transactional(readOnly = true, timeout = 5)
    public AdminSeasonListResponse getAdminSeasons(Long cursorId, int size) {
        if (size < 1 || size > 100 || (cursorId != null && cursorId <= 0)) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        Instant now = Instant.now();
        List<SeasonView> allSeasons = jdbc.query(
                SEASON_SELECT + " ORDER BY s.id DESC",
                (rs, rowNum) -> mapSeasonView(rs, now));

        long totalCount = allSeasons.size();
        long recruitingCount = allSeasons.stream().filter(s -> isCurrentlyRecruiting(s, now)).count();
        long liveCount = allSeasons.stream().filter(s -> "LIVE".equals(s.displayStatus())).count();
        long finishedCount = allSeasons.stream().filter(s -> "FINISHED".equals(s.displayStatus())).count();

        List<SeasonView> filtered = cursorId == null
                ? allSeasons
                : allSeasons.stream().filter(s -> s.id() < cursorId).toList();
        List<SeasonView> page = filtered.stream().limit(size).toList();
        boolean hasNext = filtered.size() > size;
        Long nextCursorId = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;

        return new AdminSeasonListResponse(
                totalCount,
                recruitingCount,
                liveCount,
                finishedCount,
                page,
                nextCursorId,
                hasNext);
    }

    @Transactional(readOnly = true, timeout = 5)
    public AdminSeasonDetailResponse getAdminSeasonDetail(Long seasonId) {
        if (seasonId == null || seasonId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        Instant now = Instant.now();
        SeasonView season = requireSeasonView(seasonId, now);

        List<SettlementRunView> runs = jdbc.query("""
                SELECT *
                FROM trading.contest_settlement_run
                WHERE contest_season_id = ?
                ORDER BY id DESC
                LIMIT 20
                """, (rs, rowNum) -> new SettlementRunView(
                        rs.getLong("id"),
                        rs.getLong("contest_season_id"),
                        rs.getInt("attempt_no"),
                        rs.getString("triggered_by"),
                        rs.getString("status"),
                        rs.getString("last_completed_phase"),
                        rs.getInt("deactivated_wallet_count"),
                        rs.getInt("canceled_order_count"),
                        rs.getInt("liquidated_position_count"),
                        rs.getInt("finalized_participant_count"),
                        rs.getString("failure_reason"),
                        ts(rs, "started_at"),
                        ts(rs, "completed_at")),
                seasonId);

        var appRows = jdbc.queryForList("""
                SELECT a.*, s.title AS season_title, s.description AS season_description, s.seed_money,
                       s.recruitment_start_at, s.recruitment_end_at,
                       s.contest_start_at, s.contest_end_at, s.is_public, s.is_canceled, s.settled_at
                FROM trading.contest_application a
                JOIN trading.contest_season s ON s.id = a.contest_season_id
                WHERE a.contest_season_id = ?
                ORDER BY a.id DESC
                """, seasonId);

        List<ContestApplicationView> pendingApplicants = new ArrayList<>();
        List<ContestApplicationView> rejectedApplicants = new ArrayList<>();
        for (var row : appRows) {
            String status = (String) row.get("status");
            if ("PENDING".equals(status)) {
                pendingApplicants.add(mapApplicationRow(row, now));
            } else if ("REJECTED".equals(status)) {
                rejectedApplicants.add(mapApplicationRow(row, now));
            }
        }

        List<AdminParticipantView> participants = buildAdminParticipantViews(seasonId);

        return new AdminSeasonDetailResponse(
                season,
                season.pendingOrderCount(),
                season.openPositionCount(),
                runs,
                List.copyOf(pendingApplicants),
                participants,
                List.copyOf(rejectedApplicants));
    }

    @Transactional(timeout = 5)
    public SeasonView createSeason(Long adminMemberId, AdminSeasonUpsertRequest req) {
        validateSeasonUpsert(req);
        Instant now = Instant.now();
        OffsetDateTime tsNow = at(now);
        BigDecimal seed = parseSeedMoney(req.seedMoney());
        boolean isPublic = req.isPublic() == null || req.isPublic();
        String description = req.description() == null ? "" : req.description().strip();

        Long seasonId = jdbc.queryForObject("""
                INSERT INTO trading.contest_season (
                    title, description, seed_money,
                    recruitment_start_at, recruitment_end_at,
                    contest_start_at, contest_end_at,
                    is_public, is_canceled, created_by_member_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, false, ?, ?, ?)
                RETURNING id
                """,
                Long.class,
                req.title().strip(),
                description,
                seed,
                at(req.recruitmentStartAt()),
                at(req.recruitmentEndAt()),
                at(req.contestStartAt()),
                at(req.contestEndAt()),
                isPublic,
                adminMemberId,
                tsNow,
                tsNow);

        return requireSeasonView(seasonId, now);
    }

    @Transactional(timeout = 5)
    public SeasonView updateSeason(Long seasonId, AdminSeasonUpsertRequest req) {
        if (seasonId == null || seasonId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        validateSeasonUpsert(req);
        Instant now = Instant.now();
        SeasonView existing = requireSeasonView(seasonId, now);
        if (existing.settledAt() != null) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }

        BigDecimal seed = parseSeedMoney(req.seedMoney());
        if (existing.participantCount() > 0
                && seed.compareTo(new BigDecimal(existing.seedMoney())) != 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        boolean isPublic = req.isPublic() == null || req.isPublic();
        String description = req.description() == null ? "" : req.description().strip();

        jdbc.update("""
                UPDATE trading.contest_season
                SET title = ?,
                    description = ?,
                    seed_money = ?,
                    recruitment_start_at = ?,
                    recruitment_end_at = ?,
                    contest_start_at = ?,
                    contest_end_at = ?,
                    is_public = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                req.title().strip(),
                description,
                seed,
                at(req.recruitmentStartAt()),
                at(req.recruitmentEndAt()),
                at(req.contestStartAt()),
                at(req.contestEndAt()),
                isPublic,
                at(now),
                seasonId);

        return requireSeasonView(seasonId, now);
    }

    @Transactional(timeout = 5)
    public SeasonView patchSeasonStatus(Long seasonId, AdminSeasonStatusPatchRequest req) {
        if (seasonId == null || seasonId <= 0 || req == null) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        Instant now = Instant.now();
        SeasonView current = requireSeasonView(seasonId, now);
        boolean nextPublic = req.isPublic() != null ? req.isPublic() : current.isPublic();
        boolean nextCanceled = req.isCanceled() != null ? req.isCanceled() : current.isCanceled();

        jdbc.update("""
                UPDATE trading.contest_season
                SET is_public = ?,
                    is_canceled = ?,
                    updated_at = ?
                WHERE id = ?
                """, nextPublic, nextCanceled, at(now), seasonId);

        return requireSeasonView(seasonId, now);
    }

    @Transactional(timeout = 10)
    public AdminParticipantView approveApplication(Long adminMemberId, Long seasonId, Long applicationId) {
        if (seasonId == null || seasonId <= 0 || applicationId == null || applicationId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        var appRows = jdbc.queryForList("""
                SELECT *
                FROM trading.contest_application
                WHERE id = ? AND contest_season_id = ?
                FOR UPDATE
                """, applicationId, seasonId);
        if (appRows.isEmpty()) {
            throw new BusinessException(ErrorCode.CONTEST_APPLICATION_NOT_FOUND);
        }
        var app = appRows.get(0);
        long applicantMemberId = ((Number) app.get("member_id")).longValue();
        String nickname = (String) app.get("nickname");
        Instant appliedAt = ((Timestamp) app.get("applied_at")).toInstant();

        var seasonRows = jdbc.queryForList(
                "SELECT seed_money, is_canceled, settled_at, contest_end_at FROM trading.contest_season WHERE id = ?",
                seasonId);
        if (seasonRows.isEmpty()) {
            throw new BusinessException(ErrorCode.CONTEST_SEASON_NOT_FOUND);
        }
        var seasonRow = seasonRows.get(0);
        Instant now = Instant.now();
        Instant contestEndAt = ((Timestamp) seasonRow.get("contest_end_at")).toInstant();
        if (Boolean.TRUE.equals(seasonRow.get("is_canceled"))
                || seasonRow.get("settled_at") != null
                || now.isAfter(contestEndAt)) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        BigDecimal seedMoney = (BigDecimal) seasonRow.get("seed_money");

        OffsetDateTime tsNow = at(now);

        Long accountId = accounts.findContestAccountId(applicantMemberId, seasonId).orElseGet(() -> {
            TradingAccount created = accounts.save(TradingAccount.contest(applicantMemberId, seasonId, now));
            wallets.save(Wallet.openWithSeed(created.getId(), seedMoney));
            entities.flush();
            return created.getId();
        });

        jdbc.update("""
                INSERT INTO trading.contest_participant (
                    contest_season_id, member_id, nickname, account_id, seed_money,
                    applied_at, approved_at, approved_by_member_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (contest_season_id, member_id)
                DO UPDATE SET nickname = EXCLUDED.nickname
                """,
                seasonId,
                applicantMemberId,
                nickname,
                accountId,
                TradingMath.amount(seedMoney),
                at(appliedAt),
                tsNow,
                adminMemberId);

        jdbc.update("""
                UPDATE trading.contest_application
                SET status = 'APPROVED',
                    reject_reason = NULL,
                    processed_at = ?,
                    processed_by_member_id = ?
                WHERE id = ?
                """, tsNow, adminMemberId, applicationId);

        return buildAdminParticipantViews(seasonId).stream()
                .filter(p -> applicantMemberId == p.memberId())
                .findFirst()
                .orElseThrow();
    }

    @Transactional(timeout = 20)
    public List<AdminParticipantView> bulkApproveApplications(Long adminMemberId, Long seasonId, List<Long> applicationIds) {
        if (seasonId == null || seasonId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        List<Long> targetIds;
        if (applicationIds == null || applicationIds.isEmpty()) {
            targetIds = jdbc.queryForList("""
                    SELECT id
                    FROM trading.contest_application
                    WHERE contest_season_id = ? AND status = 'PENDING'
                    ORDER BY id ASC
                    """, Long.class, seasonId);
        } else {
            targetIds = applicationIds;
        }
        List<AdminParticipantView> approved = new ArrayList<>(targetIds.size());
        for (Long appId : targetIds) {
            approved.add(approveApplication(adminMemberId, seasonId, appId));
        }
        return approved;
    }

    @Transactional(timeout = 5)
    public ContestApplicationView rejectApplication(Long adminMemberId, Long seasonId, Long applicationId, String reason) {
        if (seasonId == null || seasonId <= 0 || applicationId == null || applicationId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
        var appRows = jdbc.queryForList("""
                SELECT *
                FROM trading.contest_application
                WHERE id = ? AND contest_season_id = ?
                FOR UPDATE
                """, applicationId, seasonId);
        if (appRows.isEmpty()) {
            throw new BusinessException(ErrorCode.CONTEST_APPLICATION_NOT_FOUND);
        }
        if ("APPROVED".equals(appRows.get(0).get("status"))) {
            throw new BusinessException(ErrorCode.CONTEST_APPLICATION_ALREADY_PROCESSED);
        }
        Instant now = Instant.now();
        String safeReason = (reason == null || reason.isBlank()) ? "운영진 심사 반려" : reason.strip();
        if (safeReason.length() > 500) {
            safeReason = safeReason.substring(0, 500);
        }
        jdbc.update("""
                UPDATE trading.contest_application
                SET status = 'REJECTED',
                    reject_reason = ?,
                    processed_at = ?,
                    processed_by_member_id = ?
                WHERE id = ?
                """, safeReason, at(now), adminMemberId, applicationId);

        var updated = jdbc.queryForMap("""
                SELECT a.*, s.title AS season_title, s.description AS season_description, s.seed_money,
                       s.recruitment_start_at, s.recruitment_end_at,
                       s.contest_start_at, s.contest_end_at, s.is_public, s.is_canceled, s.settled_at
                FROM trading.contest_application a
                JOIN trading.contest_season s ON s.id = a.contest_season_id
                WHERE a.id = ?
                """, applicationId);
        return mapApplicationRow(updated, now);
    }

    private static String formatWinRate(long winningCount, long closedCount) {
        if (closedCount <= 0) {
            return "0.0%";
        }
        return BigDecimal.valueOf(winningCount)
                .multiply(HUNDRED)
                .divide(BigDecimal.valueOf(closedCount), 1, RoundingMode.HALF_UP)
                .toPlainString() + "%";
    }

    private List<LeaderboardEntry> buildRankedLeaderboard(Long seasonId) {
        var rows = jdbc.queryForList("""
                SELECT cp.*, w.balance, w.used_margin, w.reserved_margin, w.realized_pnl,
                       (SELECT COUNT(*) FROM trading.position p WHERE p.account_id = cp.account_id AND p.status = 'OPEN') AS open_position_count,
                       (SELECT COUNT(*) FROM trading.position p WHERE p.account_id = cp.account_id) AS total_position_count,
                       (SELECT COUNT(*) FROM trading.position p WHERE p.account_id = cp.account_id AND p.status IN ('CLOSED', 'LIQUIDATED')) AS closed_position_count,
                       (SELECT COUNT(*) FROM trading.position p WHERE p.account_id = cp.account_id AND p.status IN ('CLOSED', 'LIQUIDATED') AND p.realized_pnl > 0) AS winning_position_count
                FROM trading.contest_participant cp
                JOIN trading.wallet w ON w.account_id = cp.account_id
                WHERE cp.contest_season_id = ?
                ORDER BY cp.id ASC
                """, seasonId);

        List<Long> unsettledAccountIds = new ArrayList<>();
        for (var row : rows) {
            Timestamp settledTs = (Timestamp) row.get("settled_at");
            if (settledTs == null || row.get("final_balance") == null || row.get("final_roi_pct") == null) {
                unsettledAccountIds.add(((Number) row.get("account_id")).longValue());
            }
        }

        Map<Long, Wallet> walletByAccountId = new HashMap<>();
        Map<Long, List<Position>> openByAccountId = new HashMap<>();
        if (!unsettledAccountIds.isEmpty()) {
            for (Wallet w : wallets.findByAccountIdIn(unsettledAccountIds)) {
                walletByAccountId.put(w.getAccountId(), w);
            }
            for (Position p : positions.findByAccountIdInAndStatusOrderByIdAsc(unsettledAccountIds, Position.Status.OPEN)) {
                openByAccountId.computeIfAbsent(p.getAccountId(), k -> new ArrayList<>()).add(p);
            }
        }

        record RawEntry(
                long participantId,
                long memberId,
                String nickname,
                long accountId,
                BigDecimal seedMoney,
                BigDecimal totalEquity,
                BigDecimal balance,
                BigDecimal realizedPnl,
                BigDecimal unrealizedPnl,
                BigDecimal roiPct,
                long openPositionCount,
                boolean settled,
                Instant settledAt,
                Integer fixedRank,
                long tradeCount,
                String winRate) { }

        List<RawEntry> raws = new ArrayList<>(rows.size());
        for (var row : rows) {
            long participantId = ((Number) row.get("id")).longValue();
            long memberId = ((Number) row.get("member_id")).longValue();
            String nickname = (String) row.get("nickname");
            long accountId = ((Number) row.get("account_id")).longValue();
            BigDecimal seedMoney = (BigDecimal) row.get("seed_money");
            BigDecimal balance = (BigDecimal) row.get("balance");
            BigDecimal realizedPnl = (BigDecimal) row.get("realized_pnl");
            long openPosCount = ((Number) row.get("open_position_count")).longValue();
            long tradeCount = ((Number) row.get("total_position_count")).longValue();
            long closedPosCount = ((Number) row.get("closed_position_count")).longValue();
            long winningPosCount = ((Number) row.get("winning_position_count")).longValue();
            String winRate = formatWinRate(winningPosCount, closedPosCount);
            Timestamp settledTs = (Timestamp) row.get("settled_at");
            Integer finalRank = row.get("final_rank") != null ? ((Number) row.get("final_rank")).intValue() : null;

            if (settledTs != null && row.get("final_balance") != null && row.get("final_roi_pct") != null) {
                BigDecimal finalBal = (BigDecimal) row.get("final_balance");
                BigDecimal finalRealized = row.get("final_realized_pnl") != null
                        ? (BigDecimal) row.get("final_realized_pnl") : realizedPnl;
                BigDecimal finalRoi = (BigDecimal) row.get("final_roi_pct");
                raws.add(new RawEntry(
                        participantId, memberId, nickname, accountId, seedMoney,
                        finalBal, finalBal, finalRealized, BigDecimal.ZERO, finalRoi,
                        openPosCount, true, settledTs.toInstant(), finalRank, tradeCount, winRate));
            } else {
                Wallet wallet = walletByAccountId.get(accountId);
                List<Position> open = openByAccountId.getOrDefault(accountId, List.of());
                BigDecimal unrealized = BigDecimal.ZERO;
                BigDecimal equity = balance;
                if (wallet != null && !open.isEmpty()) {
                    var val = valuation.calculate(wallet, open);
                    if (val.fresh() && val.unrealizedPnl() != null && val.equity() != null) {
                        unrealized = val.unrealizedPnl();
                        equity = val.equity();
                    }
                }
                BigDecimal roiPct = seedMoney.signum() > 0
                        ? equity.subtract(seedMoney).multiply(HUNDRED).divide(seedMoney, 4, RoundingMode.HALF_UP)
                        : BigDecimal.ZERO.setScale(4, RoundingMode.HALF_UP);
                raws.add(new RawEntry(
                        participantId, memberId, nickname, accountId, seedMoney,
                        equity, balance, realizedPnl, unrealized, roiPct,
                        openPosCount, false, null, null, tradeCount, winRate));
            }
        }

        raws.sort(Comparator
                .comparing(RawEntry::roiPct, Comparator.reverseOrder())
                .thenComparing(RawEntry::realizedPnl, Comparator.reverseOrder())
                .thenComparingLong(RawEntry::participantId));

        List<LeaderboardEntry> result = new ArrayList<>(raws.size());
        int currentRank = 1;
        for (int i = 0; i < raws.size(); i++) {
            RawEntry cur = raws.get(i);
            if (i > 0) {
                RawEntry prev = raws.get(i - 1);
                if (cur.roiPct().compareTo(prev.roiPct()) != 0
                        || cur.realizedPnl().compareTo(prev.realizedPnl()) != 0) {
                    currentRank = i + 1;
                }
            }
            int assignedRank = cur.fixedRank() != null ? cur.fixedRank() : currentRank;
            result.add(new LeaderboardEntry(
                    assignedRank,
                    cur.participantId(),
                    cur.memberId(),
                    cur.nickname(),
                    cur.accountId(),
                    plain(cur.seedMoney()),
                    plain(cur.totalEquity()),
                    plain(cur.balance()),
                    plain(cur.realizedPnl()),
                    plain(cur.unrealizedPnl()),
                    plain(cur.roiPct()),
                    cur.openPositionCount(),
                    cur.settled(),
                    cur.settledAt(),
                    cur.tradeCount(),
                    cur.winRate()));
        }
        return result;
    }

    private List<MemberContestParticipationView> loadMemberParticipations(Long memberId, boolean publicOnly, Instant now) {
        String filter = publicOnly ? " AND s.is_public = true AND s.is_canceled = false " : "";
        var rows = jdbc.queryForList("""
                SELECT cp.*, s.title, s.description, s.recruitment_start_at, s.recruitment_end_at,
                       s.contest_start_at, s.contest_end_at, s.is_public, s.is_canceled, s.settled_at AS season_settled_at,
                       w.balance, w.used_margin, w.reserved_margin, w.realized_pnl,
                       (SELECT COUNT(*) FROM trading.contest_participant cp2 WHERE cp2.contest_season_id = s.id) AS total_participants,
                       (SELECT COUNT(*) FROM trading.position p WHERE p.account_id = cp.account_id AND p.status = 'OPEN') AS open_position_count,
                       (SELECT COUNT(*) FROM trading.trading_order o WHERE o.account_id = cp.account_id AND o.status = 'PENDING') AS pending_order_count,
                       (SELECT COUNT(*) FROM trading.position p WHERE p.account_id = cp.account_id) AS total_position_count,
                       (SELECT COUNT(*) FROM trading.position p WHERE p.account_id = cp.account_id AND p.status IN ('CLOSED', 'LIQUIDATED')) AS closed_position_count,
                       (SELECT COUNT(*) FROM trading.position p WHERE p.account_id = cp.account_id AND p.status IN ('CLOSED', 'LIQUIDATED') AND p.realized_pnl > 0) AS winning_position_count
                FROM trading.contest_participant cp
                JOIN trading.contest_season s ON s.id = cp.contest_season_id
                JOIN trading.wallet w ON w.account_id = cp.account_id
                WHERE cp.member_id = ?
                """ + filter + " ORDER BY s.contest_start_at DESC, s.id DESC", memberId);

        List<Long> accountIds = new ArrayList<>(rows.size());
        for (var row : rows) {
            accountIds.add(((Number) row.get("account_id")).longValue());
        }
        Map<Long, Wallet> walletByAccountId = new HashMap<>();
        Map<Long, List<Position>> openByAccountId = new HashMap<>();
        if (!accountIds.isEmpty()) {
            for (Wallet w : wallets.findByAccountIdIn(accountIds)) {
                walletByAccountId.put(w.getAccountId(), w);
            }
            for (Position p : positions.findByAccountIdInAndStatusOrderByIdAsc(accountIds, Position.Status.OPEN)) {
                openByAccountId.computeIfAbsent(p.getAccountId(), k -> new ArrayList<>()).add(p);
            }
        }
        Map<Long, List<LeaderboardEntry>> leaderboardBySeason = new HashMap<>();

        List<MemberContestParticipationView> result = new ArrayList<>(rows.size());
        for (var row : rows) {
            long seasonId = ((Number) row.get("contest_season_id")).longValue();
            long participantId = ((Number) row.get("id")).longValue();
            long accountId = ((Number) row.get("account_id")).longValue();
            String nickname = (String) row.get("nickname");
            BigDecimal seedMoney = (BigDecimal) row.get("seed_money");
            BigDecimal balance = (BigDecimal) row.get("balance");
            BigDecimal usedMargin = (BigDecimal) row.get("used_margin");
            BigDecimal reservedMargin = (BigDecimal) row.get("reserved_margin");
            BigDecimal realizedPnl = (BigDecimal) row.get("realized_pnl");
            long totalParticipants = ((Number) row.get("total_participants")).longValue();
            long openPositionCount = ((Number) row.get("open_position_count")).longValue();
            long pendingOrderCount = ((Number) row.get("pending_order_count")).longValue();
            long tradeCount = ((Number) row.get("total_position_count")).longValue();
            long closedPosCount = ((Number) row.get("closed_position_count")).longValue();
            long winningPosCount = ((Number) row.get("winning_position_count")).longValue();
            String winRate = formatWinRate(winningPosCount, closedPosCount);

            Instant recStart = ((Timestamp) row.get("recruitment_start_at")).toInstant();
            Instant recEnd = ((Timestamp) row.get("recruitment_end_at")).toInstant();
            Instant conStart = ((Timestamp) row.get("contest_start_at")).toInstant();
            Instant conEnd = ((Timestamp) row.get("contest_end_at")).toInstant();
            boolean isCanceled = Boolean.TRUE.equals(row.get("is_canceled"));
            Timestamp seasonSettledTs = (Timestamp) row.get("season_settled_at");
            Instant seasonSettledAt = seasonSettledTs != null ? seasonSettledTs.toInstant() : null;
            StatusPair statusPair = computeStatus(isCanceled, seasonSettledAt, recStart, recEnd, conStart, conEnd, now);

            Wallet wallet = walletByAccountId.get(accountId);
            List<Position> open = openByAccountId.getOrDefault(accountId, List.of());
            BigDecimal unrealized = BigDecimal.ZERO;
            BigDecimal equity = balance;
            BigDecimal available = balance.subtract(usedMargin).subtract(reservedMargin).max(BigDecimal.ZERO);
            if (wallet != null) {
                var val = valuation.calculate(wallet, open);
                if (val.availableBalance() != null) {
                    available = val.availableBalance();
                }
                if (val.fresh() && val.unrealizedPnl() != null && val.equity() != null) {
                    unrealized = val.unrealizedPnl();
                    equity = val.equity();
                }
            }

            BigDecimal totalPnl = equity.subtract(seedMoney);
            BigDecimal roiPct = row.get("final_roi_pct") != null
                    ? (BigDecimal) row.get("final_roi_pct")
                    : (seedMoney.signum() > 0
                            ? totalPnl.multiply(HUNDRED).divide(seedMoney, 4, RoundingMode.HALF_UP)
                            : BigDecimal.ZERO);
            Integer rank = row.get("final_rank") != null
                    ? ((Number) row.get("final_rank")).intValue()
                    : leaderboardBySeason.computeIfAbsent(seasonId, this::buildRankedLeaderboard).stream()
                            .filter(e -> e.participantId().equals(participantId))
                            .map(LeaderboardEntry::rank)
                            .findFirst()
                            .orElse(1);

            result.add(new MemberContestParticipationView(
                    seasonId,
                    (String) row.get("title"),
                    (String) row.get("description"),
                    statusPair.code(),
                    statusPair.label(),
                    recStart,
                    recEnd,
                    conStart,
                    conEnd,
                    seasonSettledAt,
                    participantId,
                    memberId,
                    nickname,
                    accountId,
                    plain(seedMoney),
                    plain(balance),
                    plain(available),
                    plain(usedMargin),
                    plain(reservedMargin),
                    plain(equity),
                    plain(realizedPnl),
                    plain(unrealized),
                    plain(totalPnl),
                    plain(roiPct),
                    rank,
                    totalParticipants,
                    openPositionCount,
                    pendingOrderCount,
                    tradeCount,
                    winRate));
        }
        return List.copyOf(result);
    }

    private List<AdminParticipantView> buildAdminParticipantViews(Long seasonId) {
        Map<Long, LeaderboardEntry> rankedByParticipant = new HashMap<>();
        for (LeaderboardEntry entry : buildRankedLeaderboard(seasonId)) {
            rankedByParticipant.put(entry.participantId(), entry);
        }

        var rows = jdbc.queryForList("""
                SELECT cp.*, a.status AS account_status, w.balance, w.used_margin, w.reserved_margin, w.realized_pnl,
                       (SELECT COUNT(*) FROM trading.position p WHERE p.account_id = cp.account_id AND p.status = 'OPEN') AS open_position_count,
                       (SELECT COUNT(*) FROM trading.trading_order o WHERE o.account_id = cp.account_id AND o.status = 'PENDING') AS pending_order_count
                FROM trading.contest_participant cp
                JOIN trading.trading_account a ON a.id = cp.account_id
                JOIN trading.wallet w ON w.account_id = cp.account_id
                WHERE cp.contest_season_id = ?
                ORDER BY COALESCE(cp.final_rank, 999999) ASC, cp.id ASC
                """, seasonId);

        List<AdminParticipantView> result = new ArrayList<>(rows.size());
        for (var row : rows) {
            long participantId = ((Number) row.get("id")).longValue();
            long memberId = ((Number) row.get("member_id")).longValue();
            long accountId = ((Number) row.get("account_id")).longValue();
            LeaderboardEntry ranked = rankedByParticipant.get(participantId);

            result.add(new AdminParticipantView(
                    participantId,
                    seasonId,
                    memberId,
                    (String) row.get("nickname"),
                    accountId,
                    (String) row.get("account_status"),
                    plain((BigDecimal) row.get("seed_money")),
                    plain((BigDecimal) row.get("balance")),
                    plain((BigDecimal) row.get("used_margin")),
                    plain((BigDecimal) row.get("reserved_margin")),
                    ranked != null ? ranked.totalEquity() : plain((BigDecimal) row.get("balance")),
                    plain((BigDecimal) row.get("realized_pnl")),
                    ranked != null ? ranked.unrealizedPnl() : "0",
                    ranked != null ? ranked.roiPct() : "0",
                    ranked != null ? ranked.rank() : null,
                    ((Number) row.get("open_position_count")).longValue(),
                    ((Number) row.get("pending_order_count")).longValue(),
                    ((Timestamp) row.get("applied_at")).toInstant(),
                    ((Timestamp) row.get("approved_at")).toInstant(),
                    row.get("settled_at") != null ? ((Timestamp) row.get("settled_at")).toInstant() : null,
                    ranked != null ? ranked.tradeCount() : 0L,
                    ranked != null ? ranked.winRate() : "0.0%"));
        }
        return List.copyOf(result);
    }

    private SeasonView requireSeasonView(Long seasonId, Instant now) {
        List<SeasonView> rows = jdbc.query(
                SEASON_SELECT + " WHERE s.id = ?",
                (rs, rowNum) -> mapSeasonView(rs, now),
                seasonId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.CONTEST_SEASON_NOT_FOUND);
        }
        return rows.get(0);
    }

    private SeasonView mapSeasonView(ResultSet rs, Instant now) throws SQLException {
        Instant recStart = ts(rs, "recruitment_start_at");
        Instant recEnd = ts(rs, "recruitment_end_at");
        Instant conStart = ts(rs, "contest_start_at");
        Instant conEnd = ts(rs, "contest_end_at");
        boolean isPublic = rs.getBoolean("is_public");
        boolean isCanceled = rs.getBoolean("is_canceled");
        Instant settledAt = ts(rs, "settled_at");
        StatusPair status = computeStatus(isCanceled, settledAt, recStart, recEnd, conStart, conEnd, now);

        return new SeasonView(
                rs.getLong("id"),
                rs.getString("title"),
                rs.getString("description"),
                plain(rs.getBigDecimal("seed_money")),
                recStart,
                recEnd,
                conStart,
                conEnd,
                isPublic,
                isCanceled,
                settledAt,
                status.code(),
                status.label(),
                rs.getLong("participant_count"),
                rs.getLong("applicant_count"),
                rs.getLong("pending_order_count"),
                rs.getLong("open_position_count"),
                ts(rs, "created_at"),
                ts(rs, "updated_at"));
    }

    private ContestApplicationView mapApplicationRow(Map<String, Object> row, Instant now) {
        Instant recStart = ((Timestamp) row.get("recruitment_start_at")).toInstant();
        Instant recEnd = ((Timestamp) row.get("recruitment_end_at")).toInstant();
        Instant conStart = ((Timestamp) row.get("contest_start_at")).toInstant();
        Instant conEnd = ((Timestamp) row.get("contest_end_at")).toInstant();
        boolean isCanceled = Boolean.TRUE.equals(row.get("is_canceled"));
        Instant settledAt = row.get("settled_at") != null ? ((Timestamp) row.get("settled_at")).toInstant() : null;
        StatusPair seasonStatus = computeStatus(isCanceled, settledAt, recStart, recEnd, conStart, conEnd, now);
        BigDecimal seedMoney = row.get("seed_money") instanceof BigDecimal bd ? bd : DEFAULT_SEED;
        String seasonDescription = row.get("season_description") instanceof String desc ? desc : "";

        return new ContestApplicationView(
                ((Number) row.get("id")).longValue(),
                ((Number) row.get("contest_season_id")).longValue(),
                (String) row.get("season_title"),
                seasonDescription,
                plain(seedMoney),
                seasonStatus.code(),
                recStart,
                recEnd,
                conStart,
                conEnd,
                ((Number) row.get("member_id")).longValue(),
                (String) row.get("nickname"),
                (String) row.get("status"),
                (String) row.get("reject_reason"),
                ((Timestamp) row.get("applied_at")).toInstant(),
                row.get("processed_at") != null ? ((Timestamp) row.get("processed_at")).toInstant() : null,
                row.get("processed_by_member_id") != null ? ((Number) row.get("processed_by_member_id")).longValue() : null);
    }

    private static boolean isCurrentlyRecruiting(SeasonView s, Instant now) {
        return !s.isCanceled()
                && s.settledAt() == null
                && !now.isBefore(s.recruitmentStartAt())
                && !now.isAfter(s.recruitmentEndAt());
    }

    private record StatusPair(String code, String label) { }

    private static StatusPair computeStatus(
            boolean isCanceled,
            Instant settledAt,
            Instant recStart,
            Instant recEnd,
            Instant conStart,
            Instant conEnd,
            Instant now) {
        if (isCanceled) {
            return new StatusPair("CANCELED", "취소됨");
        }
        if (settledAt != null || now.isAfter(conEnd)) {
            return new StatusPair("FINISHED", settledAt != null ? "정산완료" : "종료됨");
        }
        if (!now.isBefore(conStart) && !now.isAfter(conEnd)) {
            return new StatusPair("LIVE", "대회 진행중");
        }
        if (!now.isBefore(recStart) && !now.isAfter(recEnd)) {
            return new StatusPair("RECRUITING", "참가 신청중");
        }
        if (now.isBefore(recStart)) {
            return new StatusPair("UPCOMING", "모집 예정");
        }
        return new StatusPair("UPCOMING", "개최 대기중");
    }

    private static void validateSeasonUpsert(AdminSeasonUpsertRequest req) {
        if (req == null || req.title() == null || req.title().isBlank() || req.title().strip().length() > 120
                || req.recruitmentStartAt() == null || req.recruitmentEndAt() == null
                || req.contestStartAt() == null || req.contestEndAt() == null
                || req.recruitmentEndAt().isBefore(req.recruitmentStartAt())
                || req.contestEndAt().isBefore(req.contestStartAt())) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
    }

    private static BigDecimal parseSeedMoney(String raw) {
        if (raw == null || raw.isBlank()) {
            return TradingMath.amount(DEFAULT_SEED);
        }
        try {
            BigDecimal val = new BigDecimal(raw.strip());
            if (val.signum() <= 0) {
                throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
            }
            return TradingMath.amount(val);
        } catch (NumberFormatException ex) {
            throw new BusinessException(ErrorCode.INVALID_CONTEST_REQUEST);
        }
    }

    private static Instant ts(ResultSet rs, String col) throws SQLException {
        Timestamp t = rs.getTimestamp(col);
        return t != null ? t.toInstant() : null;
    }

    private static OffsetDateTime at(Instant value) {
        return value.atOffset(ZoneOffset.UTC);
    }

    private static String plain(BigDecimal value) {
        return value == null ? "0" : value.stripTrailingZeros().toPlainString();
    }
}
