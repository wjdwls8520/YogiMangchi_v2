package com.yogimangchi.content.support;

import com.yogimangchi.content.community.CommunityService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import com.yogimangchi.content.notification.ContentNotificationService;
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

@Service
public class SupportInquiryService {
    private static final Logger log = LoggerFactory.getLogger(SupportInquiryService.class);

    public record CreateInquiryRequest(
            String category,
            String title,
            String content
    ) { }

    public record ReplyInquiryRequest(
            String reply
    ) { }

    public record SupportInquiryResponse(
            Long id,
            Long memberId,
            String memberNickname,
            String category,
            String title,
            String content,
            String status,
            String adminReply,
            Long repliedByMemberId,
            Instant repliedAt,
            Instant createdAt
    ) { }

    public record SupportInquiryPageResponse(
            List<SupportInquiryResponse> items,
            boolean hasNext,
            Long nextCursorId
    ) { }

    public record AdminSupportInquiryPageResponse(
            long openCount,
            long answeredCount,
            List<SupportInquiryResponse> items,
            boolean hasNext,
            Long nextCursorId
    ) { }

    private record InquiryLockRow(Long id, Long memberId, String category, String title) { }

    private final MemberRepository members;
    private final JdbcTemplate jdbc;
    private final ContentNotificationService notifications;

    @Autowired
    public SupportInquiryService(
            MemberRepository members,
            JdbcTemplate jdbc,
            @Autowired(required = false) ContentNotificationService notifications) {
        this.members = members;
        this.jdbc = jdbc;
        this.notifications = notifications;
    }

    @Transactional(timeout = 5)
    public SupportInquiryResponse createInquiry(Long memberId, CreateInquiryRequest body) {
        if (body == null) {
            throw invalidRequest();
        }
        String category = validateCategory(body.category());
        String title = validateText(body.title(), 160);
        String content = validateText(body.content(), 4000);

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        Long id = jdbc.queryForObject(
                "insert into content.support_inquiry(member_id, category, title, content, status, created_at) "
                        + "values (?, ?, ?, ?, 'OPEN', now()) returning id",
                Long.class,
                memberId, category, title, content);

        return querySingleInquiry(id);
    }

    @Transactional(readOnly = true, timeout = 3)
    public SupportInquiryPageResponse listMyInquiries(Long memberId, String status, Long cursorId, Integer size) {
        requireActiveMember(memberId);
        int limit = validateSize(size, 20, 50);
        if (cursorId != null && cursorId <= 0) {
            throw invalidRequest();
        }
        String normalizedStatus = normalizeStatusFilter(status);

        StringBuilder sql = new StringBuilder(
                "select si.id, si.member_id, m.nickname as member_nickname, m.status as member_status, "
                        + "si.category, si.title, si.content, si.status, si.admin_reply, "
                        + "si.replied_by_member_id, si.replied_at, si.created_at "
                        + "from content.support_inquiry si "
                        + "join content.member m on m.id = si.member_id "
                        + "where si.member_id = ?");
        List<Object> params = new ArrayList<>();
        params.add(memberId);

        if (!"ALL".equals(normalizedStatus)) {
            sql.append(" and si.status = ?");
            params.add(normalizedStatus);
        }
        if (cursorId != null) {
            sql.append(" and si.id < ?");
            params.add(cursorId);
        }
        sql.append(" order by si.id desc limit ?");
        params.add(limit + 1);

        List<SupportInquiryResponse> rows = jdbc.query(sql.toString(), (rs, n) -> mapRow(rs), params.toArray());
        boolean hasNext = rows.size() > limit;
        List<SupportInquiryResponse> page = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;
        return new SupportInquiryPageResponse(page, hasNext, nextCursorId);
    }

    @Transactional(readOnly = true, timeout = 5)
    public AdminSupportInquiryPageResponse listAllInquiries(
            Long adminId,
            String status,
            String category,
            Long cursorId,
            Integer size) {
        requireAdmin(adminId);
        int limit = validateSize(size, 20, 100);
        if (cursorId != null && cursorId <= 0) {
            throw invalidRequest();
        }
        String normalizedStatus = normalizeStatusFilter(status);
        String normalizedCategory = (category == null || category.isBlank() || "ALL".equalsIgnoreCase(category.strip()))
                ? null
                : validateCategory(category);

        var counts = jdbc.queryForMap(
                "select "
                        + "count(*) filter (where status = 'OPEN') as open_count, "
                        + "count(*) filter (where status = 'ANSWERED') as answered_count "
                        + "from content.support_inquiry");
        long openCount = ((Number) counts.get("open_count")).longValue();
        long answeredCount = ((Number) counts.get("answered_count")).longValue();

        StringBuilder sql = new StringBuilder(
                "select si.id, si.member_id, m.nickname as member_nickname, m.status as member_status, "
                        + "si.category, si.title, si.content, si.status, si.admin_reply, "
                        + "si.replied_by_member_id, si.replied_at, si.created_at "
                        + "from content.support_inquiry si "
                        + "join content.member m on m.id = si.member_id "
                        + "where 1=1");
        List<Object> params = new ArrayList<>();

        if (!"ALL".equals(normalizedStatus)) {
            sql.append(" and si.status = ?");
            params.add(normalizedStatus);
        }
        if (normalizedCategory != null) {
            sql.append(" and si.category = ?");
            params.add(normalizedCategory);
        }
        if (cursorId != null) {
            sql.append(" and si.id < ?");
            params.add(cursorId);
        }
        sql.append(" order by si.id desc limit ?");
        params.add(limit + 1);

        List<SupportInquiryResponse> rows = jdbc.query(sql.toString(), (rs, n) -> mapRow(rs), params.toArray());
        boolean hasNext = rows.size() > limit;
        List<SupportInquiryResponse> page = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;
        return new AdminSupportInquiryPageResponse(openCount, answeredCount, page, hasNext, nextCursorId);
    }

    @Transactional(timeout = 5)
    public SupportInquiryResponse replyInquiry(Long adminId, Long inquiryId, ReplyInquiryRequest body) {
        if (inquiryId == null || inquiryId <= 0) {
            throw new AuthFailure("INQUIRY_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        if (body == null) {
            throw invalidRequest();
        }
        String reply = validateText(body.reply(), 4000);

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireAdmin(adminId);

        List<InquiryLockRow> locked = jdbc.query(
                "select id, member_id, category, title from content.support_inquiry where id = ? for update",
                (rs, n) -> new InquiryLockRow(
                        rs.getLong("id"),
                        rs.getLong("member_id"),
                        rs.getString("category"),
                        rs.getString("title")),
                inquiryId);
        if (locked.isEmpty()) {
            throw new AuthFailure("INQUIRY_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        InquiryLockRow target = locked.get(0);

        jdbc.update(
                "update content.support_inquiry "
                        + "set status = 'ANSWERED', admin_reply = ?, replied_by_member_id = ?, replied_at = now() "
                        + "where id = ?",
                reply, adminId, inquiryId);

        if (notifications != null) {
            notifications.notifySupportInquiryAnsweredAfterCommit(
                    target.memberId(), target.id(), target.category(), target.title(), reply);
        }
        log.info("[AdminAudit] action=REPLY_SUPPORT_INQUIRY adminId={} inquiryId={} targetMemberId={}",
                adminId, inquiryId, target.memberId());

        return querySingleInquiry(inquiryId);
    }

    private SupportInquiryResponse querySingleInquiry(Long inquiryId) {
        List<SupportInquiryResponse> rows = jdbc.query(
                "select si.id, si.member_id, m.nickname as member_nickname, m.status as member_status, "
                        + "si.category, si.title, si.content, si.status, si.admin_reply, "
                        + "si.replied_by_member_id, si.replied_at, si.created_at "
                        + "from content.support_inquiry si "
                        + "join content.member m on m.id = si.member_id "
                        + "where si.id = ?",
                (rs, n) -> mapRow(rs),
                inquiryId);
        if (rows.isEmpty()) {
            throw new AuthFailure("INQUIRY_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        return rows.get(0);
    }

    private SupportInquiryResponse mapRow(ResultSet rs) throws SQLException {
        String memberStatus = rs.getString("member_status");
        String rawNick = rs.getString("member_nickname");
        String displayNick = "ACTIVE".equals(memberStatus) && rawNick != null && !rawNick.isBlank()
                ? rawNick
                : CommunityService.WITHDRAWN_AUTHOR_NICKNAME;
        long repliedByRaw = rs.getLong("replied_by_member_id");
        Long repliedBy = rs.wasNull() ? null : repliedByRaw;
        Timestamp repliedTs = rs.getTimestamp("replied_at");
        Timestamp createdTs = rs.getTimestamp("created_at");
        return new SupportInquiryResponse(
                rs.getLong("id"),
                rs.getLong("member_id"),
                displayNick,
                rs.getString("category"),
                rs.getString("title"),
                rs.getString("content"),
                rs.getString("status"),
                rs.getString("admin_reply"),
                repliedBy,
                repliedTs == null ? null : repliedTs.toInstant(),
                createdTs == null ? null : createdTs.toInstant());
    }

    private void requireActiveMember(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw AuthFailure.unauthorized();
        }
        members.findById(memberId)
                .filter(m -> m.getStatus() == Member.Status.ACTIVE)
                .orElseThrow(AuthFailure::unauthorized);
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

    private static String validateCategory(String raw) {
        if (raw == null || raw.isBlank() || raw.indexOf('\0') >= 0) {
            throw invalidRequest();
        }
        String upper = raw.strip().toUpperCase(Locale.ROOT);
        if (!upper.matches("[A-Z0-9_]{2,32}")) {
            throw invalidRequest();
        }
        return upper;
    }

    private static String validateText(String raw, int maxLen) {
        if (raw == null || raw.indexOf('\0') >= 0) {
            throw invalidRequest();
        }
        String trimmed = raw.strip();
        if (trimmed.isEmpty() || trimmed.length() > maxLen) {
            throw invalidRequest();
        }
        return trimmed;
    }

    private static String normalizeStatusFilter(String status) {
        if (status == null || status.isBlank()) {
            return "ALL";
        }
        String upper = status.strip().toUpperCase(Locale.ROOT);
        if ("ALL".equals(upper) || "OPEN".equals(upper) || "ANSWERED".equals(upper)) {
            return upper;
        }
        throw invalidRequest();
    }

    private static int validateSize(Integer size, int defaultSize, int maxSize) {
        int resolved = size == null ? defaultSize : size;
        if (resolved < 1 || resolved > maxSize) {
            throw invalidRequest();
        }
        return resolved;
    }

    private static AuthFailure invalidRequest() {
        return new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
    }
}
