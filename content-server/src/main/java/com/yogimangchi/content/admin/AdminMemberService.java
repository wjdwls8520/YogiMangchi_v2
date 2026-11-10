package com.yogimangchi.content.admin;

import com.yogimangchi.content.auth.repository.RefreshSessionRepository;
import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.community.CommunityService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminMemberService {

    public record AdminMemberDto(
            Long memberId,
            String nickname,
            String profileImgUrl,
            String role,
            String deleteYn,
            String status,
            Instant createdAt,
            Instant withdrawnAt,
            String oauthEmail,
            String oauthProvider,
            String oauthProviderUserId
    ) { }

    public record AdminMemberCursorResponse(
            long totalCount,
            long activeCount,
            long withdrawnCount,
            List<AdminMemberDto> content,
            Long nextCursorId,
            boolean hasNext
    ) { }

    private final MemberRepository members;
    private final RefreshSessionRepository refresh;
    private final JdbcTemplate jdbc;
    private final CommunityS3Service s3;

    public AdminMemberService(
            MemberRepository members,
            RefreshSessionRepository refresh,
            JdbcTemplate jdbc,
            CommunityS3Service s3) {
        this.members = members;
        this.refresh = refresh;
        this.jdbc = jdbc;
        this.s3 = s3;
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
                        + "count(*) filter (where status <> 'ACTIVE') as withdrawn_count "
                        + "from content.member");
        long totalCount = ((Number) counts.get("total_count")).longValue();
        long activeCount = ((Number) counts.get("active_count")).longValue();
        long withdrawnCount = ((Number) counts.get("withdrawn_count")).longValue();

        StringBuilder sql = new StringBuilder(
                "select m.id, m.nickname, m.profile_img_url, m.role, m.status, m.created_at, m.withdrawn_at, "
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
        } else if ("WITHDRAWN".equals(normalizedStatus)) {
            sql.append(" and m.status <> 'ACTIVE'");
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
                withdrawnCount,
                content,
                nextCursorId,
                hasNext);
    }

    @Transactional(timeout = 5)
    public void forceWithdrawMember(Long adminId, Long targetMemberId) {
        if (targetMemberId == null || targetMemberId <= 0) {
            throw new AuthFailure("MEMBER_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
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
    }

    private AdminMemberDto mapMember(ResultSet rs) throws SQLException {
        long id = rs.getLong("id");
        String rawStatus = rs.getString("status");
        boolean active = "ACTIVE".equals(rawStatus);
        String rawNickname = rs.getString("nickname");
        String displayNickname = active && rawNickname != null && !rawNickname.isBlank()
                ? rawNickname
                : CommunityService.WITHDRAWN_AUTHOR_NICKNAME;
        Timestamp createdTs = rs.getTimestamp("created_at");
        Timestamp withdrawnTs = rs.getTimestamp("withdrawn_at");

        return new AdminMemberDto(
                id,
                displayNickname,
                rs.getString("profile_img_url"),
                rs.getString("role"),
                active ? "N" : "Y",
                active ? "ACTIVE" : "WITHDRAWN",
                createdTs == null ? null : createdTs.toInstant(),
                withdrawnTs == null ? null : withdrawnTs.toInstant(),
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
        if ("ALL".equals(upper) || "ACTIVE".equals(upper) || "WITHDRAWN".equals(upper)) {
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
