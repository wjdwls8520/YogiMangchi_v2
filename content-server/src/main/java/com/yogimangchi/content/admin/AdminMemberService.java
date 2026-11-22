package com.yogimangchi.content.admin;

import com.yogimangchi.content.auth.repository.RefreshSessionRepository;
import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.community.CommunityService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import com.yogimangchi.content.member.service.MemberSuspensionDelivery;
import com.yogimangchi.content.member.service.MemberSuspensionOutbox;
import com.yogimangchi.content.member.service.MemberWithdrawals;
import com.yogimangchi.content.notification.ContentNotificationSseService;
import com.yogimangchi.content.ops.AdminAuditLogService;
import com.yogimangchi.content.ops.RequestIdMdcFilter;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class AdminMemberService {
    private static final Logger log = LoggerFactory.getLogger(AdminMemberService.class);

    public record SuspendMemberRequest(String reason) { }

    public record AdminMemberStatusResponse(
            Long memberId,
            String status,
            Instant suspendedAt,
            String suspendedReason
    ) { }

    public record AdminMemberDto(
            Long memberId,
            String nickname,
            String profileImgUrl,
            String role,
            String deleteYn,
            String status,
            Instant createdAt,
            Instant withdrawnAt,
            Instant suspendedAt,
            String suspendedReason,
            String oauthEmail,
            String oauthProvider,
            String oauthProviderUserId
    ) { }

    public record AdminMemberCursorResponse(
            long totalCount,
            long activeCount,
            long suspendedCount,
            long bannedCount,
            long withdrawnCount,
            List<AdminMemberDto> content,
            Long nextCursorId,
            boolean hasNext
    ) {
        public AdminMemberCursorResponse(
                long totalCount,
                long activeCount,
                long suspendedCount,
                long withdrawnCount,
                List<AdminMemberDto> content,
                Long nextCursorId,
                boolean hasNext) {
            this(totalCount, activeCount, suspendedCount, 0L, withdrawnCount, content, nextCursorId, hasNext);
        }
    }

    public record BannedOAuthIdentityDto(
            Long id,
            String provider,
            String providerSubject,
            String maskedProviderSubject,
            String reason,
            Instant bannedAt,
            Long bannedByMemberId,
            String bannedByNickname
    ) { }

    public record BannedOAuthIdentityPageResponse(
            long totalCount,
            List<BannedOAuthIdentityDto> items,
            int page,
            int size,
            boolean hasNext,
            Long nextCursorId
    ) { }

    private final MemberRepository members;
    private final RefreshSessionRepository refresh;
    private final JdbcTemplate jdbc;
    private final CommunityS3Service s3;
    private final ContentNotificationSseService notificationSse;
    private final MemberSuspensionOutbox suspensionOutbox;
    private final MemberSuspensionDelivery suspensionDelivery;
    private final AdminAuditLogService auditLogs;

    public AdminMemberService(
            MemberRepository members,
            RefreshSessionRepository refresh,
            JdbcTemplate jdbc,
            CommunityS3Service s3) {
        this(members, refresh, jdbc, s3, null, null, null, null);
    }

    public AdminMemberService(
            MemberRepository members,
            RefreshSessionRepository refresh,
            JdbcTemplate jdbc,
            CommunityS3Service s3,
            ContentNotificationSseService notificationSse) {
        this(members, refresh, jdbc, s3, notificationSse, null, null, null);
    }

    @Autowired
    public AdminMemberService(
            MemberRepository members,
            RefreshSessionRepository refresh,
            JdbcTemplate jdbc,
            CommunityS3Service s3,
            @Autowired(required = false) ContentNotificationSseService notificationSse,
            @Autowired(required = false) MemberSuspensionOutbox suspensionOutbox,
            @Autowired(required = false) MemberSuspensionDelivery suspensionDelivery,
            @Autowired(required = false) AdminAuditLogService auditLogs) {
        this.members = members;
        this.refresh = refresh;
        this.jdbc = jdbc;
        this.s3 = s3;
        this.notificationSse = notificationSse;
        this.suspensionOutbox = suspensionOutbox;
        this.suspensionDelivery = suspensionDelivery;
        this.auditLogs = auditLogs;
    }

    @Transactional(readOnly = true, timeout = 5)
    public AdminMemberCursorResponse listMembers(
            Long adminId,
            String status,
            String role,
            Long memberId,
            String nickname,
            Long cursorId,
            Integer size) {
        requireAdmin(adminId);
        int limit = validateSize(size);
        if (cursorId != null && cursorId <= 0) {
            throw invalidRequest();
        }
        String normalizedStatus = normalizeStatusFilter(status);
        String normalizedRole = normalizeRoleFilter(role);

        var counts = jdbc.queryForMap(
                "select "
                        + "count(*) as total_count, "
                        + "count(*) filter (where status = 'ACTIVE') as active_count, "
                        + "count(*) filter (where status = 'SUSPENDED') as suspended_count, "
                        + "count(*) filter (where status = 'BANNED') as banned_count, "
                        + "count(*) filter (where status in ('WITHDRAWN', 'WITHDRAWING')) as withdrawn_count "
                        + "from content.member");
        long totalCount = ((Number) counts.get("total_count")).longValue();
        long activeCount = ((Number) counts.get("active_count")).longValue();
        long suspendedCount = ((Number) counts.get("suspended_count")).longValue();
        long bannedCount = ((Number) counts.get("banned_count")).longValue();
        long withdrawnCount = ((Number) counts.get("withdrawn_count")).longValue();

        StringBuilder sql = new StringBuilder(
                "select m.id, m.nickname, m.profile_img_url, m.role, m.status, m.created_at, m.withdrawn_at, "
                        + "m.suspended_at, m.suspended_reason, "
                        + "oa.email as oauth_email, oa.provider as oauth_provider, oa.provider_subject as oauth_provider_user_id "
                        + "from content.member m "
                        + "left join lateral ("
                        + "  select oi.email, oi.provider, oi.provider_subject "
                        + "  from content.oauth_identity oi "
                        + "  where oi.member_id = m.id "
                        + "  order by oi.id desc limit 1"
                        + ") oa on true "
                        + "where 1=1");
        List<Object> params = new ArrayList<>();

        if ("ACTIVE".equals(normalizedStatus)) {
            sql.append(" and m.status = 'ACTIVE'");
        } else if ("SUSPENDED".equals(normalizedStatus)) {
            sql.append(" and m.status = 'SUSPENDED'");
        } else if ("BANNED".equals(normalizedStatus)) {
            sql.append(" and m.status = 'BANNED'");
        } else if ("WITHDRAWN".equals(normalizedStatus)) {
            sql.append(" and m.status in ('WITHDRAWN', 'WITHDRAWING')");
        }

        if (!"ALL".equals(normalizedRole)) {
            sql.append(" and m.role = ?");
            params.add(normalizedRole);
        }

        if (memberId != null) {
            sql.append(" and m.id = ?");
            params.add(memberId);
        }

        if (nickname != null && !nickname.isBlank()) {
            String escaped = escapeLike(nickname.trim());
            sql.append(" and coalesce(m.nickname, ?) ilike ? escape '\\'");
            params.add(CommunityService.WITHDRAWN_AUTHOR_NICKNAME);
            params.add("%" + escaped + "%");
        }

        if (cursorId != null) {
            sql.append(" and m.id < ?");
            params.add(cursorId);
        }

        sql.append(" order by m.id desc limit ?");
        params.add(limit + 1);

        List<AdminMemberDto> rows = jdbc.query(
                sql.toString(),
                (rs, n) -> mapMember(rs),
                params.toArray());

        boolean hasNext = rows.size() > limit;
        List<AdminMemberDto> content = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !content.isEmpty() ? content.get(content.size() - 1).memberId() : null;

        return new AdminMemberCursorResponse(
                totalCount,
                activeCount,
                suspendedCount,
                bannedCount,
                withdrawnCount,
                content,
                nextCursorId,
                hasNext);
    }

    @Transactional(timeout = 5)
    public AdminMemberStatusResponse suspendMember(Long adminId, Long targetMemberId, String rawReason) {
        if (targetMemberId == null || targetMemberId <= 0) {
            throw new AuthFailure("MEMBER_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        String reason = normalizeReason(rawReason, "운영 정책 위반으로 계정이 일시 정지되었습니다.");
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireAdmin(adminId);

        if (targetMemberId.equals(adminId)) {
            throw new AuthFailure("CANNOT_SUSPEND_ADMIN", HttpStatus.FORBIDDEN);
        }

        Member target = members.lockById(targetMemberId)
                .orElseThrow(() -> new AuthFailure("MEMBER_NOT_FOUND", HttpStatus.NOT_FOUND));

        if (target.getRole() == Member.Role.ADMIN) {
            throw new AuthFailure("CANNOT_SUSPEND_ADMIN", HttpStatus.FORBIDDEN);
        }
        if (target.getStatus() != Member.Status.ACTIVE && target.getStatus() != Member.Status.SUSPENDED) {
            throw new AuthFailure("INVALID_MEMBER_STATUS", HttpStatus.CONFLICT);
        }

        Instant now = Instant.now();
        target.suspend(now, reason);
        refresh.revokeMember(targetMemberId, now);
        enqueueAndDispatchSuspension(targetMemberId, true, reason);
        disconnectSseAfterCommit(targetMemberId);

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("memberId", targetMemberId);
        detail.put("status", "SUSPENDED");
        detail.put("reason", reason);
        recordAudit(adminId, "SUSPEND_MEMBER", "MEMBER", String.valueOf(targetMemberId),
                "회원 계정 일시 정지", detail);
        log.info("[AdminAudit] action=SUSPEND_MEMBER adminId={} targetMemberId={} status=SUSPENDED", adminId, targetMemberId);

        return new AdminMemberStatusResponse(
                target.getId(),
                target.getStatus().name(),
                target.getSuspendedAt(),
                target.getSuspendedReason());
    }

    @Transactional(timeout = 5)
    public AdminMemberStatusResponse unsuspendMember(Long adminId, Long targetMemberId) {
        if (targetMemberId == null || targetMemberId <= 0) {
            throw new AuthFailure("MEMBER_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireAdmin(adminId);

        Member target = members.lockById(targetMemberId)
                .orElseThrow(() -> new AuthFailure("MEMBER_NOT_FOUND", HttpStatus.NOT_FOUND));

        if (target.getStatus() == Member.Status.SUSPENDED) {
            target.unsuspend();
            enqueueAndDispatchSuspension(targetMemberId, false, null);
            recordAudit(adminId, "UNSUSPEND_MEMBER", "MEMBER", String.valueOf(targetMemberId),
                    "회원 계정 정지 해제", Map.of("memberId", targetMemberId, "status", "ACTIVE"));
            log.info("[AdminAudit] action=UNSUSPEND_MEMBER adminId={} targetMemberId={} status=ACTIVE", adminId, targetMemberId);
        } else if (target.getStatus() != Member.Status.ACTIVE) {
            throw new AuthFailure("INVALID_MEMBER_STATUS", HttpStatus.CONFLICT);
        }

        return new AdminMemberStatusResponse(
                target.getId(),
                target.getStatus().name(),
                target.getSuspendedAt(),
                target.getSuspendedReason());
    }

    @Transactional(timeout = 5)
    public void forceWithdrawMember(Long adminId, Long targetMemberId) {
        forceWithdrawMember(adminId, targetMemberId, null);
    }

    @Transactional(timeout = 5)
    public void forceWithdrawMember(Long adminId, Long targetMemberId, String rawReason) {
        if (targetMemberId == null || targetMemberId <= 0) {
            throw new AuthFailure("MEMBER_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        String banReason = normalizeReason(rawReason, "관리자 강제 탈퇴 및 재가입 차단");
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireAdmin(adminId);

        if (targetMemberId.equals(adminId)) {
            throw new AuthFailure("CANNOT_WITHDRAW_ADMIN", HttpStatus.FORBIDDEN);
        }

        Member target = members.lockById(targetMemberId)
                .orElseThrow(() -> new AuthFailure("MEMBER_NOT_FOUND", HttpStatus.NOT_FOUND));

        if (target.getRole() == Member.Role.ADMIN) {
            throw new AuthFailure("CANNOT_WITHDRAW_ADMIN", HttpStatus.FORBIDDEN);
        }

        Instant now = Instant.now();
        // Record OAuth identities in banned_oauth_identity BEFORE removing oauth_identity so force-withdrawn users cannot immediately re-signup.
        jdbc.update(
                "insert into content.banned_oauth_identity(provider, provider_subject, reason, banned_at, banned_by_member_id) "
                        + "select provider, provider_subject, ?, ?, ? "
                        + "from content.oauth_identity where member_id = ? "
                        + "on conflict (provider, provider_subject) do update "
                        + "set reason = excluded.reason, banned_at = excluded.banned_at, banned_by_member_id = excluded.banned_by_member_id",
                banReason,
                Timestamp.from(now),
                adminId,
                targetMemberId);

        jdbc.update(
                "update content.member_follow set active=false, deactivated_at=now() where active and (follower_id=? or following_id=?)",
                targetMemberId, targetMemberId);
        refresh.revokeMember(targetMemberId, now);
        jdbc.update(
                "update content.member_trading_provision set status='CANCELED' where member_id=? and status='PENDING'",
                targetMemberId);

        MemberWithdrawals.cleanupMemberPiiAndInteractions(jdbc, targetMemberId);

        if (target.getProfileImgS3Key() != null && !target.getProfileImgS3Key().isBlank()) {
            s3.registerAfterCommitDelete(List.of(target.getProfileImgS3Key()), "MEMBER_WITHDRAWN");
        }

        target.withdraw(now);

        jdbc.update(
                "insert into content.member_withdrawal(member_id, status, requested_at, next_attempt_at, confirmation_version, confirmed_at) "
                        + "values (?, 'PENDING', ?, ?, ?, ?) on conflict(member_id) do nothing",
                targetMemberId,
                Timestamp.from(now),
                Timestamp.from(now),
                "ym-admin-force-v1",
                Timestamp.from(now));

        disconnectSseAfterCommit(targetMemberId);
        recordAudit(adminId, "FORCE_WITHDRAW_MEMBER", "MEMBER", String.valueOf(targetMemberId),
                "회원 강제 탈퇴 및 소셜 계정 재가입 차단",
                Map.of("memberId", targetMemberId, "reason", banReason, "oauthBanned", true));
        log.info("[AdminAudit] action=FORCE_WITHDRAW_MEMBER adminId={} targetMemberId={} oauthBanned=true", adminId, targetMemberId);
    }

    @Transactional(readOnly = true, timeout = 5)
    public BannedOAuthIdentityPageResponse listBannedOAuthIdentities(
            Long adminId,
            String provider,
            String keyword,
            Integer page,
            Long cursorId,
            Integer size) {
        requireAdmin(adminId);
        int limit = validateSize(size == null ? 20 : size);
        int resolvedPage = page == null ? 0 : page;
        if (resolvedPage < 0 || (cursorId != null && cursorId <= 0)) {
            throw invalidRequest();
        }
        String normalizedProvider = normalizeProviderFilter(provider);

        StringBuilder where = new StringBuilder(" where 1=1");
        List<Object> filterParams = new ArrayList<>();

        if (!"ALL".equals(normalizedProvider)) {
            where.append(" and b.provider = ?");
            filterParams.add(normalizedProvider);
        }
        if (keyword != null && !keyword.isBlank()) {
            String escaped = "%" + escapeLike(keyword.trim()) + "%";
            where.append(" and (coalesce(b.reason, '') ilike ? escape '\\' "
                    + "or b.provider_subject ilike ? escape '\\' "
                    + "or coalesce(m.nickname, '') ilike ? escape '\\')");
            filterParams.add(escaped);
            filterParams.add(escaped);
            filterParams.add(escaped);
        }

        Long totalCountObj = jdbc.queryForObject(
                "select count(*) from content.banned_oauth_identity b "
                        + "left join content.member m on m.id = b.banned_by_member_id" + where,
                Long.class,
                filterParams.toArray());
        long totalCount = totalCountObj == null ? 0L : totalCountObj;

        StringBuilder querySql = new StringBuilder(
                "select b.id, b.provider, b.provider_subject, b.reason, b.banned_at, b.banned_by_member_id, "
                        + "m.nickname as banned_by_nickname "
                        + "from content.banned_oauth_identity b "
                        + "left join content.member m on m.id = b.banned_by_member_id")
                .append(where);
        List<Object> queryParams = new ArrayList<>(filterParams);

        if (cursorId != null) {
            querySql.append(" and b.id < ?");
            queryParams.add(cursorId);
        }
        querySql.append(" order by b.banned_at desc, b.id desc limit ?");
        queryParams.add(limit + 1);
        if (cursorId == null && resolvedPage > 0) {
            querySql.append(" offset ?");
            queryParams.add((long) resolvedPage * limit);
        }

        List<BannedOAuthIdentityDto> rows = jdbc.query(
                querySql.toString(),
                (rs, n) -> {
                    long bannedByRaw = rs.getLong("banned_by_member_id");
                    Long bannedBy = rs.wasNull() ? null : bannedByRaw;
                    Timestamp bannedTs = rs.getTimestamp("banned_at");
                    String subject = rs.getString("provider_subject");
                    return new BannedOAuthIdentityDto(
                            rs.getLong("id"),
                            rs.getString("provider"),
                            subject,
                            maskSubject(subject),
                            rs.getString("reason"),
                            bannedTs != null ? bannedTs.toInstant() : null,
                            bannedBy,
                            rs.getString("banned_by_nickname"));
                },
                queryParams.toArray());

        boolean hasNext = rows.size() > limit;
        List<BannedOAuthIdentityDto> items = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !items.isEmpty() ? items.get(items.size() - 1).id() : null;
        return new BannedOAuthIdentityPageResponse(totalCount, items, resolvedPage, limit, hasNext, nextCursorId);
    }

    @Transactional(timeout = 5)
    public void unbanOAuthIdentity(Long adminId, Long banId) {
        if (banId == null || banId <= 0) {
            throw new AuthFailure("BANNED_IDENTITY_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireAdmin(adminId);

        List<Map<String, Object>> existing = jdbc.queryForList(
                "select id, provider, provider_subject, reason from content.banned_oauth_identity where id = ? for update",
                banId);
        if (existing.isEmpty()) {
            throw new AuthFailure("BANNED_IDENTITY_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        Map<String, Object> row = existing.get(0);
        String provider = String.valueOf(row.get("provider"));
        String subject = String.valueOf(row.get("provider_subject"));

        jdbc.update("delete from content.banned_oauth_identity where id = ?", banId);

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("banId", banId);
        detail.put("provider", provider);
        detail.put("maskedSubject", maskSubject(subject));
        if (row.get("reason") != null) {
            detail.put("previousReason", String.valueOf(row.get("reason")));
        }
        recordAudit(adminId, "UNBAN_OAUTH_IDENTITY", "BANNED_OAUTH_IDENTITY", String.valueOf(banId),
                "차단된 소셜 계정 재가입 제한 해제 (" + provider + ")", detail);
        log.info("[AdminAudit] action=UNBAN_OAUTH_IDENTITY adminId={} banId={} provider={}", adminId, banId, provider);
    }

    private void enqueueAndDispatchSuspension(Long targetMemberId, boolean suspended, String reason) {
        if (suspensionOutbox == null) {
            return;
        }
        long deliveryId = suspensionOutbox.enqueue(targetMemberId, suspended, reason);
        if (suspensionDelivery == null || deliveryId <= 0) {
            return;
        }
        String traceId = RequestIdMdcFilter.currentOrGenerate();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    suspensionDelivery.dispatchAfterCommitAsync(deliveryId, traceId);
                }
            });
        } else {
            suspensionDelivery.dispatchAfterCommitAsync(deliveryId, traceId);
        }
    }

    private void recordAudit(
            Long adminId,
            String action,
            String targetType,
            String targetId,
            String summary,
            Map<String, Object> detail) {
        if (auditLogs != null) {
            auditLogs.record(adminId, action, targetType, targetId, summary, detail);
        }
    }

    private void disconnectSseAfterCommit(Long targetMemberId) {
        if (notificationSse == null) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    notificationSse.disconnectMember(targetMemberId);
                }
            });
        } else {
            notificationSse.disconnectMember(targetMemberId);
        }
    }

    private AdminMemberDto mapMember(ResultSet rs) throws SQLException {
        long id = rs.getLong("id");
        String rawStatus = rs.getString("status");
        boolean withdrawn = "WITHDRAWN".equals(rawStatus) || "WITHDRAWING".equals(rawStatus);
        String rawNickname = rs.getString("nickname");
        String displayNickname = !withdrawn && rawNickname != null && !rawNickname.isBlank()
                ? rawNickname
                : CommunityService.WITHDRAWN_AUTHOR_NICKNAME;
        Timestamp createdTs = rs.getTimestamp("created_at");
        Timestamp withdrawnTs = rs.getTimestamp("withdrawn_at");
        Timestamp suspendedTs = rs.getTimestamp("suspended_at");
        String mappedStatus = withdrawn ? "WITHDRAWN" : rawStatus;

        return new AdminMemberDto(
                id,
                displayNickname,
                s3.sanitizeProfileImageUrl(rs.getString("profile_img_url")),
                rs.getString("role"),
                withdrawn ? "Y" : "N",
                mappedStatus,
                createdTs == null ? null : createdTs.toInstant(),
                withdrawnTs == null ? null : withdrawnTs.toInstant(),
                suspendedTs == null ? null : suspendedTs.toInstant(),
                rs.getString("suspended_reason"),
                rs.getString("oauth_email"),
                rs.getString("oauth_provider"),
                rs.getString("oauth_provider_user_id"));
    }

    private void requireAdmin(Long adminId) {
        if (adminId == null) {
            throw AuthFailure.unauthorized();
        }
        Boolean isAdmin = jdbc.queryForObject(
                "select exists(select 1 from content.member where id = ? and status = 'ACTIVE' and role = 'ADMIN')",
                Boolean.class,
                adminId);
        if (!Boolean.TRUE.equals(isAdmin)) {
            throw new AuthFailure("ACCESS_DENIED", HttpStatus.FORBIDDEN);
        }
    }

    private String normalizeStatusFilter(String status) {
        if (status == null || status.isBlank()) {
            return "ALL";
        }
        String upper = status.trim().toUpperCase(Locale.ROOT);
        if ("ALL".equals(upper)
                || "ACTIVE".equals(upper)
                || "SUSPENDED".equals(upper)
                || "BANNED".equals(upper)
                || "WITHDRAWN".equals(upper)) {
            return upper;
        }
        throw invalidRequest();
    }

    private String normalizeRoleFilter(String role) {
        if (role == null || role.isBlank()) {
            return "ALL";
        }
        String upper = role.trim().toUpperCase(Locale.ROOT);
        return switch (upper) {
            case "ALL" -> "ALL";
            case "USER", "MEMBER", "VERIFIED_USER" -> "MEMBER";
            case "ADMIN" -> "ADMIN";
            default -> throw invalidRequest();
        };
    }

    private String normalizeProviderFilter(String provider) {
        if (provider == null || provider.isBlank()) {
            return "ALL";
        }
        String upper = provider.trim().toUpperCase(Locale.ROOT);
        if ("ALL".equals(upper) || "GOOGLE".equals(upper) || "KAKAO".equals(upper)) {
            return upper;
        }
        throw invalidRequest();
    }

    private static String maskSubject(String subject) {
        if (subject == null || subject.isBlank()) {
            return "";
        }
        String s = subject.strip();
        if (s.length() <= 6) {
            return s.charAt(0) + "***";
        }
        return s.substring(0, 3) + "***" + s.substring(s.length() - 3);
    }

    private String normalizeReason(String rawReason, String defaultReason) {
        if (rawReason == null || rawReason.isBlank()) {
            return defaultReason;
        }
        if (rawReason.indexOf('\0') >= 0) {
            throw invalidRequest();
        }
        String trimmed = rawReason.strip();
        if (trimmed.length() > 500) {
            throw invalidRequest();
        }
        return trimmed;
    }

    private int validateSize(Integer size) {
        int resolved = size == null ? 10 : size;
        if (resolved < 1 || resolved > 100) {
            throw invalidRequest();
        }
        return resolved;
    }

    private static String escapeLike(String keyword) {
        return keyword
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
    }

    private static AuthFailure invalidRequest() {
        return new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
    }
}
