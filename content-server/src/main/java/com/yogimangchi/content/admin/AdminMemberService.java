package com.yogimangchi.content.admin;

import com.yogimangchi.content.auth.repository.RefreshSessionRepository;
import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.community.CommunityService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import com.yogimangchi.content.notification.ContentNotificationSseService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
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
            long withdrawnCount,
            List<AdminMemberDto> content,
            Long nextCursorId,
            boolean hasNext
    ) { }

    private final MemberRepository members;
    private final RefreshSessionRepository refresh;
    private final JdbcTemplate jdbc;
    private final CommunityS3Service s3;
    private final ContentNotificationSseService notificationSse;

    public AdminMemberService(
            MemberRepository members,
            RefreshSessionRepository refresh,
            JdbcTemplate jdbc,
            CommunityS3Service s3) {
        this(members, refresh, jdbc, s3, null);
    }

    @Autowired
    public AdminMemberService(
            MemberRepository members,
            RefreshSessionRepository refresh,
            JdbcTemplate jdbc,
            CommunityS3Service s3,
            @Autowired(required = false) ContentNotificationSseService notificationSse) {
        this.members = members;
        this.refresh = refresh;
        this.jdbc = jdbc;
        this.s3 = s3;
        this.notificationSse = notificationSse;
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
                        + "count(*) filter (where status in ('SUSPENDED', 'BANNED')) as suspended_count, "
                        + "count(*) filter (where status in ('WITHDRAWN', 'WITHDRAWING')) as withdrawn_count "
                        + "from content.member");
        long totalCount = ((Number) counts.get("total_count")).longValue();
        long activeCount = ((Number) counts.get("active_count")).longValue();
        long suspendedCount = ((Number) counts.get("suspended_count")).longValue();
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
        disconnectSseAfterCommit(targetMemberId);
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
        jdbc.update("delete from content.oauth_identity where member_id=?", targetMemberId);
        jdbc.update("delete from content.refresh_session where member_id=?", targetMemberId);
        jdbc.update("delete from content.member_consent_history where member_id=?", targetMemberId);
        jdbc.update("delete from content.notification_group_state where receiver_member_id=?", targetMemberId);
        jdbc.update("delete from content.notification_dedupe_state where receiver_member_id=? or actor_member_id=?", targetMemberId, targetMemberId);
        jdbc.update("delete from content.notification_state where member_id=?", targetMemberId);
        jdbc.update("delete from content.notification where receiver_member_id=?", targetMemberId);

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
        log.info("[AdminAudit] action=FORCE_WITHDRAW_MEMBER adminId={} targetMemberId={} oauthBanned=true", adminId, targetMemberId);
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
