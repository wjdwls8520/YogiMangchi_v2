package com.yogimangchi.content.support;

import com.yogimangchi.content.community.CommunityService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import com.yogimangchi.content.notification.ContentNotificationService;
import com.yogimangchi.content.ops.AdminAuditLogService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
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

@Service
public class SupportInquiryService {
    private static final Logger log = LoggerFactory.getLogger(SupportInquiryService.class);

    public record CreateInquiryRequest(
            String category,
            String title,
            String content
    ) { }

    public record UpdateInquiryRequest(
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
            String memberStatus,
            String category,
            String title,
            String content,
            String status,
            String adminReply,
            Long repliedByMemberId,
            Instant repliedAt,
            Instant createdAt,
            Instant updatedAt,
            Instant closedAt
    ) {
        public SupportInquiryResponse(
                Long id,
                Long memberId,
                String memberNickname,
                String memberStatus,
                String category,
                String title,
                String content,
                String status,
                String adminReply,
                Long repliedByMemberId,
                Instant repliedAt,
                Instant createdAt) {
            this(id, memberId, memberNickname, memberStatus, category, title, content, status,
                    adminReply, repliedByMemberId, repliedAt, createdAt, null, null);
        }

        public SupportInquiryResponse(
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
                Instant createdAt) {
            this(id, memberId, memberNickname, null, category, title, content, status,
                    adminReply, repliedByMemberId, repliedAt, createdAt, null, null);
        }
    }

    public record SupportInquiryPageResponse(
            List<SupportInquiryResponse> items,
            boolean hasNext,
            Long nextCursorId
    ) { }

    public record AdminSupportInquiryPageResponse(
            long openCount,
            long answeredCount,
            long closedCount,
            List<SupportInquiryResponse> items,
            boolean hasNext,
            Long nextCursorId
    ) {
        public AdminSupportInquiryPageResponse(
                long openCount,
                long answeredCount,
                List<SupportInquiryResponse> items,
                boolean hasNext,
                Long nextCursorId) {
            this(openCount, answeredCount, 0L, items, hasNext, nextCursorId);
        }
    }

    private record InquiryLockRow(Long id, Long memberId, String category, String title, String content, String status) { }

    private final MemberRepository members;
    private final JdbcTemplate jdbc;
    private final ContentNotificationService notifications;
    private final AdminAuditLogService auditLogs;

    public SupportInquiryService(
            MemberRepository members,
            JdbcTemplate jdbc,
            ContentNotificationService notifications) {
        this(members, jdbc, notifications, null);
    }

    @Autowired
    public SupportInquiryService(
            MemberRepository members,
            JdbcTemplate jdbc,
            @Autowired(required = false) ContentNotificationService notifications,
            @Autowired(required = false) AdminAuditLogService auditLogs) {
        this.members = members;
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.auditLogs = auditLogs;
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
        requireMemberForSupport(memberId);

        Long id = jdbc.queryForObject(
                "insert into content.support_inquiry(member_id, category, title, content, status, created_at, updated_at) "
                        + "values (?, ?, ?, ?, 'OPEN', now(), now()) returning id",
                Long.class,
                memberId, category, title, content);

        return querySingleInquiry(id);
    }

    @Transactional(timeout = 5)
    public SupportInquiryResponse updateInquiry(Long memberId, Long inquiryId, UpdateInquiryRequest body) {
        if (inquiryId == null || inquiryId <= 0) {
            throw new AuthFailure("INQUIRY_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        if (body == null || (body.category() == null && body.title() == null && body.content() == null)) {
            throw invalidRequest();
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireMemberForSupport(memberId);

        InquiryLockRow target = lockInquiryOrThrow(inquiryId);
        if (!target.memberId().equals(memberId)) {
            throw new AuthFailure("ACCESS_DENIED", HttpStatus.FORBIDDEN);
        }
        if (!"OPEN".equals(target.status())) {
            throw new AuthFailure(
                    "INQUIRY_STATUS_CONFLICT",
                    HttpStatus.CONFLICT,
                    "답변 완료되었거나 종료된 문의는 수정할 수 없습니다.");
        }

        String nextCategory = body.category() == null ? target.category() : validateCategory(body.category());
        String nextTitle = body.title() == null ? target.title() : validateText(body.title(), 160);
        String nextContent = body.content() == null ? target.content() : validateText(body.content(), 4000);

        jdbc.update(
                "update content.support_inquiry set category = ?, title = ?, content = ?, updated_at = now() where id = ?",
                nextCategory, nextTitle, nextContent, inquiryId);

        return querySingleInquiry(inquiryId);
    }

    @Transactional(timeout = 5)
    public void deleteInquiry(Long memberId, Long inquiryId) {
        if (inquiryId == null || inquiryId <= 0) {
            throw new AuthFailure("INQUIRY_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireMemberForSupport(memberId);

        InquiryLockRow target = lockInquiryOrThrow(inquiryId);
        if (!target.memberId().equals(memberId)) {
            throw new AuthFailure("ACCESS_DENIED", HttpStatus.FORBIDDEN);
        }
        if (!"OPEN".equals(target.status())) {
            throw new AuthFailure(
                    "INQUIRY_STATUS_CONFLICT",
                    HttpStatus.CONFLICT,
                    "답변 완료되었거나 종료된 문의는 삭제할 수 없습니다.");
        }

        jdbc.update("delete from content.support_inquiry where id = ?", inquiryId);
    }

    @Transactional(timeout = 5)
    public SupportInquiryResponse closeInquiry(Long memberId, Long inquiryId) {
        if (inquiryId == null || inquiryId <= 0) {
            throw new AuthFailure("INQUIRY_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireMemberForSupport(memberId);

        InquiryLockRow target = lockInquiryOrThrow(inquiryId);
        if (!target.memberId().equals(memberId)) {
            throw new AuthFailure("ACCESS_DENIED", HttpStatus.FORBIDDEN);
        }
        if (!"CLOSED".equals(target.status())) {
            jdbc.update(
                    "update content.support_inquiry set status = 'CLOSED', closed_at = coalesce(closed_at, now()), updated_at = now() where id = ?",
                    inquiryId);
        }
        return querySingleInquiry(inquiryId);
    }

    @Transactional(readOnly = true, timeout = 3)
    public SupportInquiryPageResponse listMyInquiries(Long memberId, String status, Long cursorId, Integer size) {
        requireMemberForSupport(memberId);
        int limit = validateSize(size, 20, 50);
        if (cursorId != null && cursorId <= 0) {
            throw invalidRequest();
        }
        String normalizedStatus = normalizeStatusFilter(status);

        StringBuilder sql = new StringBuilder(
                "select si.id, si.member_id, m.nickname as member_nickname, m.status as member_status, "
                        + "si.category, si.title, si.content, si.status, si.admin_reply, "
                        + "si.replied_by_member_id, si.replied_at, si.created_at, si.updated_at, si.closed_at "
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
        return listAllInquiries(adminId, status, category, null, cursorId, size);
    }

    @Transactional(readOnly = true, timeout = 5)
    public AdminSupportInquiryPageResponse listAllInquiries(
            Long adminId,
            String status,
            String category,
            String keyword,
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
                        + "count(*) filter (where status = 'ANSWERED') as answered_count, "
                        + "count(*) filter (where status = 'CLOSED') as closed_count "
                        + "from content.support_inquiry");
        long openCount = ((Number) counts.get("open_count")).longValue();
        long answeredCount = ((Number) counts.get("answered_count")).longValue();
        long closedCount = ((Number) counts.get("closed_count")).longValue();

        StringBuilder sql = new StringBuilder(
                "select si.id, si.member_id, m.nickname as member_nickname, m.status as member_status, "
                        + "si.category, si.title, si.content, si.status, si.admin_reply, "
                        + "si.replied_by_member_id, si.replied_at, si.created_at, si.updated_at, si.closed_at "
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
        if (keyword != null && !keyword.isBlank()) {
            if (keyword.indexOf('\0') >= 0 || keyword.length() > 100) {
                throw invalidRequest();
            }
            String escaped = "%" + escapeLike(keyword.trim()) + "%";
            sql.append(" and (si.title ilike ? escape '\\' or si.content ilike ? escape '\\' "
                    + "or coalesce(si.admin_reply, '') ilike ? escape '\\' "
                    + "or coalesce(m.nickname, '') ilike ? escape '\\')");
            params.add(escaped);
            params.add(escaped);
            params.add(escaped);
            params.add(escaped);
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
        return new AdminSupportInquiryPageResponse(openCount, answeredCount, closedCount, page, hasNext, nextCursorId);
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

        InquiryLockRow target = lockInquiryOrThrow(inquiryId);
        if ("CLOSED".equals(target.status())) {
            throw new AuthFailure(
                    "INQUIRY_STATUS_CONFLICT",
                    HttpStatus.CONFLICT,
                    "이미 종료된 문의에는 답변을 등록할 수 없습니다.");
        }

        jdbc.update(
                "update content.support_inquiry "
                        + "set status = 'ANSWERED', admin_reply = ?, replied_by_member_id = ?, replied_at = now(), updated_at = now() "
                        + "where id = ?",
                reply, adminId, inquiryId);

        if (notifications != null) {
            notifications.notifySupportInquiryAnsweredAfterCommit(
                    target.memberId(), target.id(), target.category(), target.title(), reply);
        }
        if (auditLogs != null) {
            auditLogs.record(adminId, "REPLY_SUPPORT_INQUIRY", "SUPPORT_INQUIRY", String.valueOf(inquiryId),
                    "1:1 문의 답변 등록",
                    Map.of("inquiryId", inquiryId, "targetMemberId", target.memberId(), "category", target.category()));
        }
        log.info("[AdminAudit] action=REPLY_SUPPORT_INQUIRY adminId={} inquiryId={} targetMemberId={}",
                adminId, inquiryId, target.memberId());

        return querySingleInquiry(inquiryId);
    }

    private InquiryLockRow lockInquiryOrThrow(Long inquiryId) {
        List<InquiryLockRow> locked = jdbc.query(
                "select id, member_id, category, title, content, status from content.support_inquiry where id = ? for update",
                (rs, n) -> new InquiryLockRow(
                        rs.getLong("id"),
                        rs.getLong("member_id"),
                        rs.getString("category"),
                        rs.getString("title"),
                        rs.getString("content"),
                        rs.getString("status")),
                inquiryId);
        if (locked.isEmpty()) {
            throw new AuthFailure("INQUIRY_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        return locked.get(0);
    }

    private SupportInquiryResponse querySingleInquiry(Long inquiryId) {
        List<SupportInquiryResponse> rows = jdbc.query(
                "select si.id, si.member_id, m.nickname as member_nickname, m.status as member_status, "
                        + "si.category, si.title, si.content, si.status, si.admin_reply, "
                        + "si.replied_by_member_id, si.replied_at, si.created_at, si.updated_at, si.closed_at "
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
        boolean withdrawn = CommunityService.isWithdrawnStatus(memberStatus);
        String displayNick = !withdrawn && rawNick != null && !rawNick.isBlank()
                ? rawNick
                : CommunityService.WITHDRAWN_AUTHOR_NICKNAME;
        long repliedByRaw = rs.getLong("replied_by_member_id");
        Long repliedBy = rs.wasNull() ? null : repliedByRaw;
        Timestamp repliedTs = rs.getTimestamp("replied_at");
        Timestamp createdTs = rs.getTimestamp("created_at");
        Timestamp updatedTs = rs.getTimestamp("updated_at");
        Timestamp closedTs = rs.getTimestamp("closed_at");
        return new SupportInquiryResponse(
                rs.getLong("id"),
                rs.getLong("member_id"),
                displayNick,
                memberStatus,
                rs.getString("category"),
                rs.getString("title"),
                rs.getString("content"),
                rs.getString("status"),
                rs.getString("admin_reply"),
                repliedBy,
                repliedTs == null ? null : repliedTs.toInstant(),
                createdTs == null ? null : createdTs.toInstant(),
                updatedTs == null ? null : updatedTs.toInstant(),
                closedTs == null ? null : closedTs.toInstant());
    }

    private void requireMemberForSupport(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw AuthFailure.unauthorized();
        }
        members.findById(memberId)
                .filter(m -> m.getStatus() == Member.Status.ACTIVE || m.getStatus() == Member.Status.SUSPENDED)
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
        if ("ALL".equals(upper) || "OPEN".equals(upper) || "ANSWERED".equals(upper) || "CLOSED".equals(upper)) {
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
