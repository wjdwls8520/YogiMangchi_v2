package com.yogimangchi.content.admin;

import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.community.CommunityService;
import com.yogimangchi.content.error.AuthFailure;
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
public class AdminCommunityService {

    public record AdminPostDto(
            Long postId,
            String category,
            String title,
            String content,
            long likeCount,
            long replyCount,
            long reportCount,
            String deleteYn,
            Instant createdAt,
            Instant updatedAt,
            Long authorId,
            String authorNickname
    ) { }

    public record AdminPostCursorResponse(
            List<AdminPostDto> content,
            Long nextCursorId,
            boolean hasNext
    ) { }

    public record AdminReplyDto(
            Long replyId,
            String content,
            long likeCount,
            long reportCount,
            String deleteYn,
            Instant createdAt,
            Instant updatedAt,
            Long postId,
            String postTitle,
            Long authorId,
            String authorNickname
    ) { }

    public record AdminReplyCursorResponse(
            List<AdminReplyDto> content,
            Long nextCursorId,
            boolean hasNext
    ) { }

    public record AdminReportDto(
            String reportKey,
            String targetType,
            Long targetId,
            Long postId,
            String postTitle,
            String targetContent,
            Long targetAuthorId,
            String targetAuthorNickname,
            String targetDeleteYn,
            long targetReportCount,
            Long reporterId,
            String reporterNickname,
            String reasonType,
            Instant createdAt
    ) { }

    public record AdminReportPageResponse(
            List<AdminReportDto> content,
            int page,
            int size,
            long totalElements,
            int totalPages,
            boolean hasNext,
            long postReportCount,
            long commentReportCount,
            long activeTargetReportCount
    ) { }

    private record PostStatusRow(Long id, String status, Timestamp deletedAt) { }

    private record CommentHierarchyRow(Long id, Long postId, Long parentCommentId, String status, Timestamp deletedAt) { }

    private final JdbcTemplate jdbc;
    private final CommunityS3Service s3;

    public AdminCommunityService(JdbcTemplate jdbc, CommunityS3Service s3) {
        this.jdbc = jdbc;
        this.s3 = s3;
    }

    @Transactional(readOnly = true, timeout = 5)
    public AdminPostCursorResponse listPosts(
            Long adminId,
            String authorStatus,
            String title,
            String content,
            String authorNickname,
            Long cursorId,
            Integer size) {
        requireAdmin(adminId);
        int limit = validateSize(size);
        if (cursorId != null && cursorId <= 0) {
            throw invalidRequest();
        }
        String normalizedAuthorStatus = normalizeAuthorStatus(authorStatus);

        StringBuilder sql = new StringBuilder(
                "select p.id as post_id, p.category, p.title, p.content, "
                        + "p.like_count, p.comment_count, p.report_count, "
                        + "p.status as post_status, p.deleted_at, p.created_at, p.updated_at, "
                        + "p.member_id as author_id, m.nickname as author_nickname, m.status as author_status "
                        + "from content.community_post p "
                        + "join content.member m on m.id = p.member_id "
                        + "where 1=1");
        List<Object> params = new ArrayList<>();

        if ("ACTIVE".equals(normalizedAuthorStatus)) {
            sql.append(" and m.status = 'ACTIVE'");
        } else if ("WITHDRAWN".equals(normalizedAuthorStatus)) {
            sql.append(" and m.status <> 'ACTIVE'");
        }

        if (title != null && !title.isBlank()) {
            String escaped = escapeLike(title.trim());
            sql.append(" and p.title ilike ? escape '\\'");
            params.add("%" + escaped + "%");
        }

        if (content != null && !content.isBlank()) {
            String escaped = escapeLike(content.trim());
            sql.append(" and p.content ilike ? escape '\\'");
            params.add("%" + escaped + "%");
        }

        if (authorNickname != null && !authorNickname.isBlank()) {
            String escaped = escapeLike(authorNickname.trim());
            sql.append(" and (case when m.status = 'ACTIVE' and m.nickname is not null then m.nickname else ? end) ilike ? escape '\\'");
            params.add(CommunityService.WITHDRAWN_AUTHOR_NICKNAME);
            params.add("%" + escaped + "%");
        }

        if (cursorId != null) {
            sql.append(" and p.id < ?");
            params.add(cursorId);
        }

        sql.append(" order by p.id desc limit ?");
        params.add(limit + 1);

        List<AdminPostDto> rows = jdbc.query(
                sql.toString(),
                (rs, n) -> mapPost(rs),
                params.toArray());

        boolean hasNext = rows.size() > limit;
        List<AdminPostDto> pageContent = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !pageContent.isEmpty() ? pageContent.get(pageContent.size() - 1).postId() : null;

        return new AdminPostCursorResponse(pageContent, nextCursorId, hasNext);
    }

    @Transactional(timeout = 5)
    public void deletePost(Long adminId, Long postId) {
        if (postId == null || postId <= 0) {
            throw new AuthFailure("POST_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireAdmin(adminId);

        List<PostStatusRow> locked = jdbc.query(
                "select id, status, deleted_at from content.community_post where id = ? for update",
                (rs, n) -> new PostStatusRow(rs.getLong("id"), rs.getString("status"), rs.getTimestamp("deleted_at")),
                postId);
        if (locked.isEmpty()) {
            throw new AuthFailure("POST_NOT_FOUND", HttpStatus.NOT_FOUND);
        }

        PostStatusRow existing = locked.get(0);
        if ("ACTIVE".equals(existing.status()) || existing.deletedAt() == null) {
            List<String> keys = jdbc.queryForList(
                    "delete from content.community_post_file where post_id = ? returning s3_key",
                    String.class,
                    postId);
            if (!keys.isEmpty()) {
                s3.registerAfterCommitDelete(keys);
            }
            jdbc.update(
                    "update content.community_post set status = 'DELETED', deleted_at = coalesce(deleted_at, now()), updated_at = now() where id = ?",
                    postId);
        }
    }

    @Transactional(readOnly = true, timeout = 5)
    public AdminReplyCursorResponse listReplies(
            Long adminId,
            String authorStatus,
            String postTitle,
            String postContent,
            String replyContent,
            String authorNickname,
            Long cursorId,
            Integer size) {
        requireAdmin(adminId);
        int limit = validateSize(size);
        if (cursorId != null && cursorId <= 0) {
            throw invalidRequest();
        }
        String normalizedAuthorStatus = normalizeAuthorStatus(authorStatus);

        StringBuilder sql = new StringBuilder(
                "select c.id as reply_id, c.content, c.like_count, c.report_count, "
                        + "c.status as comment_status, c.deleted_at, c.created_at, c.updated_at, "
                        + "c.post_id, p.title as post_title, "
                        + "c.member_id as author_id, m.nickname as author_nickname, m.status as author_status "
                        + "from content.community_comment c "
                        + "join content.community_post p on p.id = c.post_id "
                        + "join content.member m on m.id = c.member_id "
                        + "where 1=1");
        List<Object> params = new ArrayList<>();

        if ("ACTIVE".equals(normalizedAuthorStatus)) {
            sql.append(" and m.status = 'ACTIVE'");
        } else if ("WITHDRAWN".equals(normalizedAuthorStatus)) {
            sql.append(" and m.status <> 'ACTIVE'");
        }

        if (postTitle != null && !postTitle.isBlank()) {
            String escaped = escapeLike(postTitle.trim());
            sql.append(" and p.title ilike ? escape '\\'");
            params.add("%" + escaped + "%");
        }

        if (postContent != null && !postContent.isBlank()) {
            String escaped = escapeLike(postContent.trim());
            sql.append(" and p.content ilike ? escape '\\'");
            params.add("%" + escaped + "%");
        }

        if (replyContent != null && !replyContent.isBlank()) {
            String escaped = escapeLike(replyContent.trim());
            sql.append(" and c.content ilike ? escape '\\'");
            params.add("%" + escaped + "%");
        }

        if (authorNickname != null && !authorNickname.isBlank()) {
            String escaped = escapeLike(authorNickname.trim());
            sql.append(" and (case when m.status = 'ACTIVE' and m.nickname is not null then m.nickname else ? end) ilike ? escape '\\'");
            params.add(CommunityService.WITHDRAWN_AUTHOR_NICKNAME);
            params.add("%" + escaped + "%");
        }

        if (cursorId != null) {
            sql.append(" and c.id < ?");
            params.add(cursorId);
        }

        sql.append(" order by c.id desc limit ?");
        params.add(limit + 1);

        List<AdminReplyDto> rows = jdbc.query(
                sql.toString(),
                (rs, n) -> mapReply(rs),
                params.toArray());

        boolean hasNext = rows.size() > limit;
        List<AdminReplyDto> pageContent = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !pageContent.isEmpty() ? pageContent.get(pageContent.size() - 1).replyId() : null;

        return new AdminReplyCursorResponse(pageContent, nextCursorId, hasNext);
    }

    @Transactional(timeout = 5)
    public void deleteReply(Long adminId, Long replyId) {
        if (replyId == null || replyId <= 0) {
            throw new AuthFailure("COMMENT_NOT_FOUND", HttpStatus.NOT_FOUND);
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireAdmin(adminId);

        List<CommentHierarchyRow> locked = jdbc.query(
                "select id, post_id, parent_comment_id, status, deleted_at from content.community_comment where id = ? for update",
                (rs, n) -> {
                    long parentRaw = rs.getLong("parent_comment_id");
                    Long parentId = rs.wasNull() ? null : parentRaw;
                    return new CommentHierarchyRow(
                            rs.getLong("id"),
                            rs.getLong("post_id"),
                            parentId,
                            rs.getString("status"),
                            rs.getTimestamp("deleted_at"));
                },
                replyId);
        if (locked.isEmpty()) {
            throw new AuthFailure("COMMENT_NOT_FOUND", HttpStatus.NOT_FOUND);
        }

        CommentHierarchyRow existing = locked.get(0);
        jdbc.queryForList("select id from content.community_post where id = ? for update", Long.class, existing.postId());

        if ("ACTIVE".equals(existing.status()) || existing.deletedAt() == null) {
            jdbc.update(
                    "update content.community_comment set status = 'DELETED', deleted_at = coalesce(deleted_at, now()), updated_at = now() where id = ?",
                    replyId);
            if (existing.parentCommentId() != null) {
                jdbc.update(
                        "update content.community_comment set reply_count = ("
                                + "select count(*) from content.community_comment where parent_comment_id = ? and status = 'ACTIVE'"
                                + ") where id = ?",
                        existing.parentCommentId(), existing.parentCommentId());
            }
            jdbc.update(
                    "update content.community_post set comment_count = (select count(*) from content.community_comment where post_id = ? and status = 'ACTIVE') where id = ?",
                    existing.postId(), existing.postId());
        }
    }

    @Transactional(readOnly = true, timeout = 5)
    public AdminReportPageResponse listReports(
            Long adminId,
            String targetType,
            String targetStatus,
            String reasonType,
            String keyword,
            Integer page,
            Integer size) {
        requireAdmin(adminId);
        int resolvedPage = page == null ? 0 : page;
        if (resolvedPage < 0) {
            throw invalidRequest();
        }
        int limit = validateSize(size == null ? 20 : size);
        String normalizedTargetType = normalizeReportTargetType(targetType);
        String normalizedTargetStatus = normalizeReportTargetStatus(targetStatus);
        String normalizedReasonType = normalizeReportReasonFilter(reasonType);

        String baseCte = "with unified_reports as ("
                + "select 'POST' as target_type, pr.post_id as target_id, p.id as post_id, p.title as post_title, "
                + "p.content as target_content, p.member_id as target_author_id, ta.nickname as target_author_nickname, "
                + "ta.status as target_author_status, p.status as target_status, p.deleted_at as target_deleted_at, "
                + "p.report_count as target_report_count, pr.member_id as reporter_id, rm.nickname as reporter_nickname, "
                + "rm.status as reporter_status, pr.reason_type, pr.created_at "
                + "from content.community_post_report pr "
                + "join content.community_post p on p.id = pr.post_id "
                + "join content.member ta on ta.id = p.member_id "
                + "join content.member rm on rm.id = pr.member_id "
                + "union all "
                + "select 'COMMENT' as target_type, cr.comment_id as target_id, p.id as post_id, p.title as post_title, "
                + "c.content as target_content, c.member_id as target_author_id, ta.nickname as target_author_nickname, "
                + "ta.status as target_author_status, c.status as target_status, c.deleted_at as target_deleted_at, "
                + "c.report_count as target_report_count, cr.member_id as reporter_id, rm.nickname as reporter_nickname, "
                + "rm.status as reporter_status, cr.reason_type, cr.created_at "
                + "from content.community_comment_report cr "
                + "join content.community_comment c on c.id = cr.comment_id "
                + "join content.community_post p on p.id = c.post_id "
                + "join content.member ta on ta.id = c.member_id "
                + "join content.member rm on rm.id = cr.member_id"
                + ") ";

        StringBuilder whereClause = new StringBuilder(" where 1=1");
        List<Object> filterParams = new ArrayList<>();

        if (!"ALL".equals(normalizedTargetType)) {
            whereClause.append(" and u.target_type = ?");
            filterParams.add(normalizedTargetType);
        }

        if ("ACTIVE".equals(normalizedTargetStatus)) {
            whereClause.append(" and u.target_status = 'ACTIVE' and u.target_deleted_at is null");
        } else if ("DELETED".equals(normalizedTargetStatus)) {
            whereClause.append(" and (u.target_status = 'DELETED' or u.target_deleted_at is not null)");
        }

        if (!"ALL".equals(normalizedReasonType)) {
            whereClause.append(" and u.reason_type = ?");
            filterParams.add(normalizedReasonType);
        }

        if (keyword != null && !keyword.isBlank()) {
            String escaped = "%" + escapeLike(keyword.trim()) + "%";
            whereClause.append(" and (u.post_title ilike ? escape '\\' or u.target_content ilike ? escape '\\' "
                    + "or coalesce(u.target_author_nickname, '') ilike ? escape '\\' "
                    + "or coalesce(u.reporter_nickname, '') ilike ? escape '\\')");
            filterParams.add(escaped);
            filterParams.add(escaped);
            filterParams.add(escaped);
            filterParams.add(escaped);
        }

        Long totalElementsObj = jdbc.queryForObject(
                baseCte + "select count(*) from unified_reports u" + whereClause,
                Long.class,
                filterParams.toArray());
        long totalElements = totalElementsObj == null ? 0L : totalElementsObj;

        List<Object> pageParams = new ArrayList<>(filterParams);
        pageParams.add(limit);
        pageParams.add((long) resolvedPage * limit);

        List<AdminReportDto> content = jdbc.query(
                baseCte + "select * from unified_reports u" + whereClause
                        + " order by u.created_at desc, u.target_type asc, u.target_id desc, u.reporter_id desc limit ? offset ?",
                (rs, n) -> mapReport(rs),
                pageParams.toArray());

        Long postReportsObj = jdbc.queryForObject(
                "select count(*) from content.community_post_report",
                Long.class);
        Long commentReportsObj = jdbc.queryForObject(
                "select count(*) from content.community_comment_report",
                Long.class);
        Long activeTargetReportsObj = jdbc.queryForObject(
                "select ("
                        + "  (select count(*) from content.community_post_report pr join content.community_post p on p.id = pr.post_id where p.status = 'ACTIVE' and p.deleted_at is null)"
                        + "  + "
                        + "  (select count(*) from content.community_comment_report cr join content.community_comment c on c.id = cr.comment_id where c.status = 'ACTIVE' and c.deleted_at is null)"
                        + ")",
                Long.class);

        int totalPages = totalElements == 0 ? 0 : (int) Math.ceil((double) totalElements / limit);
        boolean hasNext = (long) (resolvedPage + 1) * limit < totalElements;

        return new AdminReportPageResponse(
                content,
                resolvedPage,
                limit,
                totalElements,
                totalPages,
                hasNext,
                postReportsObj == null ? 0L : postReportsObj,
                commentReportsObj == null ? 0L : commentReportsObj,
                activeTargetReportsObj == null ? 0L : activeTargetReportsObj);
    }

    @Transactional(timeout = 5)
    public void dismissReport(Long adminId, String targetType, Long targetId, Long reporterId) {
        if (targetId == null || targetId <= 0 || reporterId == null || reporterId <= 0) {
            throw invalidRequest();
        }
        String normalizedType = normalizeSingleReportTargetType(targetType);
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireAdmin(adminId);

        if ("POST".equals(normalizedType)) {
            List<Long> locked = jdbc.queryForList(
                    "select id from content.community_post where id = ? for update",
                    Long.class,
                    targetId);
            if (locked.isEmpty()) {
                throw new AuthFailure("POST_NOT_FOUND", HttpStatus.NOT_FOUND);
            }
            jdbc.update(
                    "delete from content.community_post_report where post_id = ? and member_id = ?",
                    targetId, reporterId);
            jdbc.update(
                    "update content.community_post set report_count = (select count(*) from content.community_post_report where post_id = ?) where id = ?",
                    targetId, targetId);
        } else {
            List<Long> locked = jdbc.queryForList(
                    "select id from content.community_comment where id = ? for update",
                    Long.class,
                    targetId);
            if (locked.isEmpty()) {
                throw new AuthFailure("COMMENT_NOT_FOUND", HttpStatus.NOT_FOUND);
            }
            jdbc.update(
                    "delete from content.community_comment_report where comment_id = ? and member_id = ?",
                    targetId, reporterId);
            jdbc.update(
                    "update content.community_comment set report_count = (select count(*) from content.community_comment_report where comment_id = ?) where id = ?",
                    targetId, targetId);
        }
    }

    @Transactional(timeout = 5)
    public void moderateReportedTarget(Long adminId, String targetType, Long targetId, String action) {
        if (targetId == null || targetId <= 0) {
            throw invalidRequest();
        }
        String normalizedType = normalizeSingleReportTargetType(targetType);
        String normalizedAction = normalizeModerationAction(action);
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireAdmin(adminId);

        if ("POST".equals(normalizedType)) {
            if ("DELETE_TARGET".equals(normalizedAction)) {
                deletePost(adminId, targetId);
            } else {
                List<Long> locked = jdbc.queryForList(
                        "select id from content.community_post where id = ? for update",
                        Long.class,
                        targetId);
                if (locked.isEmpty()) {
                    throw new AuthFailure("POST_NOT_FOUND", HttpStatus.NOT_FOUND);
                }
            }
            jdbc.update("delete from content.community_post_report where post_id = ?", targetId);
            jdbc.update("update content.community_post set report_count = 0 where id = ?", targetId);
        } else {
            if ("DELETE_TARGET".equals(normalizedAction)) {
                deleteReply(adminId, targetId);
            } else {
                List<Long> locked = jdbc.queryForList(
                        "select id from content.community_comment where id = ? for update",
                        Long.class,
                        targetId);
                if (locked.isEmpty()) {
                    throw new AuthFailure("COMMENT_NOT_FOUND", HttpStatus.NOT_FOUND);
                }
            }
            jdbc.update("delete from content.community_comment_report where comment_id = ?", targetId);
            jdbc.update("update content.community_comment set report_count = 0 where id = ?", targetId);
        }
    }

    private AdminPostDto mapPost(ResultSet rs) throws SQLException {
        String postStatus = rs.getString("post_status");
        Timestamp deletedAt = rs.getTimestamp("deleted_at");
        boolean deleted = deletedAt != null || "DELETED".equals(postStatus);
        String authorStatus = rs.getString("author_status");
        String rawNickname = rs.getString("author_nickname");
        String displayNickname = "ACTIVE".equals(authorStatus) && rawNickname != null && !rawNickname.isBlank()
                ? rawNickname
                : CommunityService.WITHDRAWN_AUTHOR_NICKNAME;
        Timestamp createdTs = rs.getTimestamp("created_at");
        Timestamp updatedTs = rs.getTimestamp("updated_at");

        return new AdminPostDto(
                rs.getLong("post_id"),
                rs.getString("category"),
                rs.getString("title"),
                rs.getString("content"),
                rs.getLong("like_count"),
                rs.getLong("comment_count"),
                rs.getLong("report_count"),
                deleted ? "Y" : "N",
                createdTs == null ? null : createdTs.toInstant(),
                updatedTs == null ? null : updatedTs.toInstant(),
                rs.getLong("author_id"),
                displayNickname);
    }

    private AdminReplyDto mapReply(ResultSet rs) throws SQLException {
        String commentStatus = rs.getString("comment_status");
        Timestamp deletedAt = rs.getTimestamp("deleted_at");
        boolean deleted = deletedAt != null || "DELETED".equals(commentStatus);
        String authorStatus = rs.getString("author_status");
        String rawNickname = rs.getString("author_nickname");
        String displayNickname = "ACTIVE".equals(authorStatus) && rawNickname != null && !rawNickname.isBlank()
                ? rawNickname
                : CommunityService.WITHDRAWN_AUTHOR_NICKNAME;
        Timestamp createdTs = rs.getTimestamp("created_at");
        Timestamp updatedTs = rs.getTimestamp("updated_at");

        return new AdminReplyDto(
                rs.getLong("reply_id"),
                rs.getString("content"),
                rs.getLong("like_count"),
                rs.getLong("report_count"),
                deleted ? "Y" : "N",
                createdTs == null ? null : createdTs.toInstant(),
                updatedTs == null ? null : updatedTs.toInstant(),
                rs.getLong("post_id"),
                rs.getString("post_title"),
                rs.getLong("author_id"),
                displayNickname);
    }

    private AdminReportDto mapReport(ResultSet rs) throws SQLException {
        String targetType = rs.getString("target_type");
        long targetId = rs.getLong("target_id");
        long reporterId = rs.getLong("reporter_id");
        String targetStatus = rs.getString("target_status");
        Timestamp targetDeletedAt = rs.getTimestamp("target_deleted_at");
        boolean targetDeleted = targetDeletedAt != null || "DELETED".equals(targetStatus);

        String targetAuthorStatus = rs.getString("target_author_status");
        String rawTargetAuthorNickname = rs.getString("target_author_nickname");
        String displayTargetAuthorNickname = "ACTIVE".equals(targetAuthorStatus)
                && rawTargetAuthorNickname != null && !rawTargetAuthorNickname.isBlank()
                ? rawTargetAuthorNickname
                : CommunityService.WITHDRAWN_AUTHOR_NICKNAME;

        String reporterStatus = rs.getString("reporter_status");
        String rawReporterNickname = rs.getString("reporter_nickname");
        String displayReporterNickname = "ACTIVE".equals(reporterStatus)
                && rawReporterNickname != null && !rawReporterNickname.isBlank()
                ? rawReporterNickname
                : CommunityService.WITHDRAWN_AUTHOR_NICKNAME;

        Timestamp createdTs = rs.getTimestamp("created_at");

        return new AdminReportDto(
                targetType + ":" + targetId + ":" + reporterId,
                targetType,
                targetId,
                rs.getLong("post_id"),
                rs.getString("post_title"),
                rs.getString("target_content"),
                rs.getLong("target_author_id"),
                displayTargetAuthorNickname,
                targetDeleted ? "Y" : "N",
                rs.getLong("target_report_count"),
                reporterId,
                displayReporterNickname,
                rs.getString("reason_type"),
                createdTs == null ? null : createdTs.toInstant());
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

    private String normalizeAuthorStatus(String authorStatus) {
        if (authorStatus == null || authorStatus.isBlank()) {
            return "ALL";
        }
        String upper = authorStatus.trim().toUpperCase(Locale.ROOT);
        if ("ALL".equals(upper) || "ACTIVE".equals(upper) || "WITHDRAWN".equals(upper)) {
            return upper;
        }
        throw invalidRequest();
    }

    private String normalizeReportTargetType(String targetType) {
        if (targetType == null || targetType.isBlank()) {
            return "ALL";
        }
        String upper = targetType.trim().toUpperCase(Locale.ROOT);
        if ("ALL".equals(upper) || "POST".equals(upper) || "COMMENT".equals(upper)) {
            return upper;
        }
        throw invalidRequest();
    }

    private String normalizeSingleReportTargetType(String targetType) {
        if (targetType == null || targetType.isBlank()) {
            throw invalidRequest();
        }
        String upper = targetType.trim().toUpperCase(Locale.ROOT);
        if ("POST".equals(upper) || "COMMENT".equals(upper)) {
            return upper;
        }
        throw invalidRequest();
    }

    private String normalizeReportTargetStatus(String targetStatus) {
        if (targetStatus == null || targetStatus.isBlank()) {
            return "ALL";
        }
        String upper = targetStatus.trim().toUpperCase(Locale.ROOT);
        if ("ALL".equals(upper) || "ACTIVE".equals(upper) || "DELETED".equals(upper)) {
            return upper;
        }
        throw invalidRequest();
    }

    private String normalizeReportReasonFilter(String reasonType) {
        if (reasonType == null || reasonType.isBlank()) {
            return "ALL";
        }
        String upper = reasonType.trim().toUpperCase(Locale.ROOT);
        if ("ALL".equals(upper)
                || "SPAM".equals(upper)
                || "ABUSE".equals(upper)
                || "FRAUD".equals(upper)
                || "INAPPROPRIATE".equals(upper)
                || "OTHER".equals(upper)) {
            return upper;
        }
        throw invalidRequest();
    }

    private String normalizeModerationAction(String action) {
        if (action == null || action.isBlank()) {
            return "DELETE_TARGET";
        }
        String upper = action.trim().toUpperCase(Locale.ROOT);
        if ("DELETE_TARGET".equals(upper) || "CLEAR_REPORTS".equals(upper)) {
            return upper;
        }
        throw invalidRequest();
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
