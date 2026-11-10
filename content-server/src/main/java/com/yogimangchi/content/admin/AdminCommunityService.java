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
