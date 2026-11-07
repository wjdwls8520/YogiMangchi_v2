package com.yogimangchi.content.community;

import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CommunityService {
    private static final Set<String> CATEGORIES = Set.of("MARKET", "ANALYSIS", "POSITION", "FREE");
    private static final Set<String> SORTS = Set.of("LATEST", "POPULAR");
    public static final String WITHDRAWN_AUTHOR_NICKNAME = "탈퇴한회원";

    public record CreatePostRequest(String category, String symbolTag, String title, String content) { }

    public record UpdatePostRequest(String category, String symbolTag, String title, String content) { }

    public record CreateCommentRequest(String content, Long parentCommentId) { }

    public record CommunityPostResponse(
            Long id,
            Long memberId,
            String authorNickname,
            boolean authorWithdrawn,
            String category,
            String symbolTag,
            String title,
            String content,
            int likeCount,
            int commentCount,
            boolean likedByMe,
            boolean mine,
            Instant createdAt,
            Instant updatedAt
    ) { }

    public record CommunityPostPageResponse(
            List<CommunityPostResponse> items,
            boolean hasNext,
            Long nextCursorId
    ) { }

    public record PostLikeResponse(
            Long postId,
            int likeCount,
            boolean likedByMe
    ) { }

    public record CommunityCommentResponse(
            Long id,
            Long postId,
            Long memberId,
            String authorNickname,
            boolean authorWithdrawn,
            Long parentCommentId,
            String content,
            boolean mine,
            Instant createdAt,
            Instant updatedAt
    ) { }

    public record CommunityCommentListResponse(
            List<CommunityCommentResponse> items
    ) { }

    private final MemberRepository members;
    private final JdbcTemplate jdbc;

    public CommunityService(MemberRepository members, JdbcTemplate jdbc) {
        this.members = members;
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true, timeout = 3)
    public CommunityPostPageResponse listPosts(
            String category,
            String sort,
            String symbolTag,
            String keyword,
            Long cursorId,
            Integer size,
            Long viewerId) {
        int limit = size == null ? 10 : size;
        if (limit < 1 || limit > 30 || cursorId != null && cursorId <= 0) {
            throw invalidRequest();
        }

        String normalizedCategory = null;
        if (category != null && !category.isBlank()) {
            normalizedCategory = category.strip().toUpperCase(Locale.ROOT);
            if (!CATEGORIES.contains(normalizedCategory)) {
                throw invalidRequest();
            }
        }

        String normalizedSort = sort == null || sort.isBlank() ? "LATEST" : sort.strip().toUpperCase(Locale.ROOT);
        if (!SORTS.contains(normalizedSort)) {
            throw invalidRequest();
        }

        String normalizedSymbol = normalizeSymbolTag(symbolTag);

        String search = "";
        if (keyword != null) {
            if (keyword.codePointCount(0, keyword.length()) > 40 || keyword.indexOf('\0') >= 0) {
                throw invalidRequest();
            }
            search = keyword.strip();
        }

        StringBuilder sql = new StringBuilder(
                "select p.id, p.member_id, m.nickname as member_nickname, m.status as member_status, "
                        + "p.category, p.symbol_tag, p.title, p.content, p.like_count, p.comment_count, "
                        + "p.created_at, p.updated_at, "
                        + (viewerId == null
                        ? "false as liked_by_me "
                        : "exists(select 1 from content.community_post_like l where l.post_id = p.id and l.member_id = ?) as liked_by_me ")
                        + "from content.community_post p "
                        + "join content.member m on m.id = p.member_id "
                        + "where p.status = 'ACTIVE'");

        List<Object> params = new ArrayList<>();
        if (viewerId != null) {
            params.add(viewerId);
        }

        if ("LATEST".equals(normalizedSort) && cursorId != null) {
            sql.append(" and p.id < ?");
            params.add(cursorId);
        } else if ("POPULAR".equals(normalizedSort) && cursorId != null) {
            sql.append(" and (p.like_count < coalesce((select c.like_count from content.community_post c where c.id = ?), 2147483647) "
                    + "or (p.like_count = coalesce((select c.like_count from content.community_post c where c.id = ?), 2147483647) and p.id < ?))");
            params.add(cursorId);
            params.add(cursorId);
            params.add(cursorId);
        }

        if (normalizedCategory != null) {
            sql.append(" and p.category = ?");
            params.add(normalizedCategory);
        }
        if (normalizedSymbol != null) {
            sql.append(" and p.symbol_tag = ?");
            params.add(normalizedSymbol);
        }
        if (!search.isEmpty()) {
            sql.append(" and (position(lower(?) in lower(p.title)) > 0 or position(lower(?) in lower(p.content)) > 0)");
            params.add(search);
            params.add(search);
        }

        if ("POPULAR".equals(normalizedSort)) {
            sql.append(" order by p.like_count desc, p.id desc limit ?");
        } else {
            sql.append(" order by p.id desc limit ?");
        }
        params.add(limit + 1);

        var rows = jdbc.query(sql.toString(), (rs, n) -> mapPost(rs, viewerId), params.toArray());
        boolean hasNext = rows.size() > limit;
        var page = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;
        return new CommunityPostPageResponse(page, hasNext, nextCursorId);
    }

    @Transactional(readOnly = true, timeout = 3)
    public CommunityPostResponse getPost(Long postId, Long viewerId) {
        if (postId == null || postId <= 0) {
            throw notFound();
        }
        return queryActivePost(postId, viewerId);
    }

    @Transactional(timeout = 5)
    public CommunityPostResponse createPost(Long memberId, CreatePostRequest body) {
        if (body == null) {
            throw invalidRequest();
        }
        String category = validateCategory(body.category());
        String symbolTag = normalizeSymbolTag(body.symbolTag());
        String title = validateTitle(body.title());
        String content = validatePostContent(body.content());

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        Long postId = jdbc.queryForObject(
                "insert into content.community_post(member_id, category, symbol_tag, title, content, status, like_count, comment_count, created_at, updated_at) "
                        + "values (?, ?, ?, ?, ?, 'ACTIVE', 0, 0, now(), now()) returning id",
                Long.class,
                memberId, category, symbolTag, title, content);
        return queryActivePost(postId, memberId);
    }

    @Transactional(timeout = 5)
    public CommunityPostResponse updatePost(Long memberId, Long postId, UpdatePostRequest body) {
        if (postId == null || postId <= 0 || body == null) {
            throw invalidRequest();
        }
        if (body.category() == null && body.symbolTag() == null && body.title() == null && body.content() == null) {
            throw invalidRequest();
        }

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var locked = jdbc.query(
                "select id, member_id, category, symbol_tag, title, content, status from content.community_post where id = ? for update",
                (rs, n) -> new LockedPost(
                        rs.getLong("id"),
                        rs.getLong("member_id"),
                        rs.getString("category"),
                        rs.getString("symbol_tag"),
                        rs.getString("title"),
                        rs.getString("content"),
                        rs.getString("status")),
                postId);
        if (locked.isEmpty() || !"ACTIVE".equals(locked.get(0).status())) {
            throw notFound();
        }
        LockedPost existing = locked.get(0);
        if (!existing.memberId().equals(memberId)) {
            throw forbidden();
        }

        String category = body.category() == null ? existing.category() : validateCategory(body.category());
        String symbolTag = body.symbolTag() == null ? existing.symbolTag() : normalizeSymbolTag(body.symbolTag());
        String title = body.title() == null ? existing.title() : validateTitle(body.title());
        String content = body.content() == null ? existing.content() : validatePostContent(body.content());

        jdbc.update(
                "update content.community_post set category = ?, symbol_tag = ?, title = ?, content = ?, updated_at = now() where id = ?",
                category, symbolTag, title, content, postId);
        return queryActivePost(postId, memberId);
    }

    @Transactional(timeout = 5)
    public void deletePost(Long memberId, Long postId) {
        if (postId == null || postId <= 0) {
            throw notFound();
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var locked = jdbc.query(
                "select member_id, status from content.community_post where id = ? for update",
                (rs, n) -> new OwnerStatus(rs.getLong("member_id"), rs.getString("status")),
                postId);
        if (locked.isEmpty()) {
            throw notFound();
        }
        OwnerStatus existing = locked.get(0);
        if (!existing.memberId().equals(memberId)) {
            throw forbidden();
        }
        if ("ACTIVE".equals(existing.status())) {
            jdbc.update(
                    "update content.community_post set status = 'DELETED', deleted_at = now(), updated_at = now() where id = ?",
                    postId);
        }
    }

    @Transactional(timeout = 5)
    public PostLikeResponse changeLike(Long memberId, Long postId, boolean like) {
        if (postId == null || postId <= 0) {
            throw notFound();
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var statusRows = jdbc.queryForList(
                "select status from content.community_post where id = ? for update",
                String.class,
                postId);
        if (statusRows.isEmpty() || !"ACTIVE".equals(statusRows.get(0))) {
            throw notFound();
        }

        if (like) {
            jdbc.update(
                    "insert into content.community_post_like(post_id, member_id, created_at) values (?, ?, now()) on conflict(post_id, member_id) do nothing",
                    postId, memberId);
        } else {
            jdbc.update(
                    "delete from content.community_post_like where post_id = ? and member_id = ?",
                    postId, memberId);
        }

        Integer likeCount = jdbc.queryForObject(
                "update content.community_post set like_count = (select count(*) from content.community_post_like where post_id = ?) where id = ? returning like_count",
                Integer.class,
                postId, postId);
        return new PostLikeResponse(postId, likeCount == null ? 0 : likeCount, like);
    }

    @Transactional(readOnly = true, timeout = 3)
    public CommunityCommentListResponse listComments(Long postId, Long viewerId) {
        if (postId == null || postId <= 0) {
            throw notFound();
        }
        Boolean activePost = jdbc.queryForObject(
                "select exists(select 1 from content.community_post where id = ? and status = 'ACTIVE')",
                Boolean.class,
                postId);
        if (!Boolean.TRUE.equals(activePost)) {
            throw notFound();
        }

        var items = jdbc.query(
                "select c.id, c.post_id, c.member_id, m.nickname as member_nickname, m.status as member_status, "
                        + "c.parent_comment_id, c.content, c.created_at, c.updated_at "
                        + "from content.community_comment c "
                        + "join content.member m on m.id = c.member_id "
                        + "where c.post_id = ? and c.status = 'ACTIVE' "
                        + "order by c.id asc",
                (rs, n) -> mapComment(rs, viewerId),
                postId);
        return new CommunityCommentListResponse(items);
    }

    @Transactional(timeout = 5)
    public CommunityCommentResponse createComment(Long memberId, Long postId, CreateCommentRequest body) {
        if (postId == null || postId <= 0) {
            throw notFound();
        }
        if (body == null) {
            throw invalidRequest();
        }
        String content = validateCommentContent(body.content());
        Long parentCommentId = body.parentCommentId();
        if (parentCommentId != null && parentCommentId <= 0) {
            throw invalidRequest();
        }

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var postStatus = jdbc.queryForList(
                "select status from content.community_post where id = ? for update",
                String.class,
                postId);
        if (postStatus.isEmpty() || !"ACTIVE".equals(postStatus.get(0))) {
            throw notFound();
        }

        if (parentCommentId != null) {
            Boolean validParent = jdbc.queryForObject(
                    "select exists(select 1 from content.community_comment where id = ? and post_id = ? and status = 'ACTIVE')",
                    Boolean.class,
                    parentCommentId, postId);
            if (!Boolean.TRUE.equals(validParent)) {
                throw invalidRequest();
            }
        }

        Long commentId = jdbc.queryForObject(
                "insert into content.community_comment(post_id, member_id, parent_comment_id, content, status, created_at, updated_at) "
                        + "values (?, ?, ?, ?, 'ACTIVE', now(), now()) returning id",
                Long.class,
                postId, memberId, parentCommentId, content);

        jdbc.update(
                "update content.community_post set comment_count = (select count(*) from content.community_comment where post_id = ? and status = 'ACTIVE') where id = ?",
                postId, postId);

        var created = jdbc.query(
                "select c.id, c.post_id, c.member_id, m.nickname as member_nickname, m.status as member_status, "
                        + "c.parent_comment_id, c.content, c.created_at, c.updated_at "
                        + "from content.community_comment c "
                        + "join content.member m on m.id = c.member_id "
                        + "where c.id = ?",
                (rs, n) -> mapComment(rs, memberId),
                commentId);
        return created.get(0);
    }

    @Transactional(timeout = 5)
    public void deleteComment(Long memberId, Long commentId) {
        if (commentId == null || commentId <= 0) {
            throw notFound();
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var locked = jdbc.query(
                "select post_id, member_id, status from content.community_comment where id = ? for update",
                (rs, n) -> new CommentOwnerStatus(rs.getLong("post_id"), rs.getLong("member_id"), rs.getString("status")),
                commentId);
        if (locked.isEmpty()) {
            throw notFound();
        }
        CommentOwnerStatus existing = locked.get(0);
        if (!existing.memberId().equals(memberId)) {
            throw forbidden();
        }

        jdbc.queryForList("select id from content.community_post where id = ? for update", Long.class, existing.postId());
        if ("ACTIVE".equals(existing.status())) {
            jdbc.update(
                    "update content.community_comment set status = 'DELETED', deleted_at = now(), updated_at = now() where id = ?",
                    commentId);
            jdbc.update(
                    "update content.community_post set comment_count = (select count(*) from content.community_comment where post_id = ? and status = 'ACTIVE') where id = ?",
                    existing.postId(), existing.postId());
        }
    }

    private CommunityPostResponse queryActivePost(Long postId, Long viewerId) {
        String sql = "select p.id, p.member_id, m.nickname as member_nickname, m.status as member_status, "
                + "p.category, p.symbol_tag, p.title, p.content, p.like_count, p.comment_count, "
                + "p.created_at, p.updated_at, "
                + (viewerId == null
                ? "false as liked_by_me "
                : "exists(select 1 from content.community_post_like l where l.post_id = p.id and l.member_id = ?) as liked_by_me ")
                + "from content.community_post p "
                + "join content.member m on m.id = p.member_id "
                + "where p.id = ? and p.status = 'ACTIVE'";
        var rows = viewerId == null
                ? jdbc.query(sql, (rs, n) -> mapPost(rs, null), postId)
                : jdbc.query(sql, (rs, n) -> mapPost(rs, viewerId), viewerId, postId);
        if (rows.isEmpty()) {
            throw notFound();
        }
        return rows.get(0);
    }

    private void requireActiveMember(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw AuthFailure.unauthorized();
        }
        members.lockById(memberId)
                .filter(m -> m.getStatus() == Member.Status.ACTIVE)
                .orElseThrow(() -> new AuthFailure("MEMBER_NOT_ACTIVE", HttpStatus.UNAUTHORIZED));
    }

    private static String validateCategory(String category) {
        if (category == null || category.isBlank()) {
            throw invalidRequest();
        }
        String normalized = category.strip().toUpperCase(Locale.ROOT);
        if (!CATEGORIES.contains(normalized)) {
            throw invalidRequest();
        }
        return normalized;
    }

    private static String normalizeSymbolTag(String symbolTag) {
        if (symbolTag == null || symbolTag.isBlank()) {
            return null;
        }
        String normalized = symbolTag.strip().toUpperCase(Locale.ROOT);
        if (!normalized.matches("[A-Z0-9]{1,16}")) {
            throw invalidRequest();
        }
        return normalized;
    }

    private static String validateTitle(String title) {
        if (title == null || title.indexOf('\0') >= 0) {
            throw invalidRequest();
        }
        String trimmed = title.strip();
        if (trimmed.isEmpty() || trimmed.length() > 120) {
            throw invalidRequest();
        }
        return trimmed;
    }

    private static String validatePostContent(String content) {
        if (content == null || content.indexOf('\0') >= 0) {
            throw invalidRequest();
        }
        String trimmed = content.strip();
        if (trimmed.isEmpty() || trimmed.length() > 4000) {
            throw invalidRequest();
        }
        return trimmed;
    }

    private static String validateCommentContent(String content) {
        if (content == null || content.indexOf('\0') >= 0) {
            throw invalidRequest();
        }
        String trimmed = content.strip();
        if (trimmed.isEmpty() || trimmed.length() > 1000) {
            throw invalidRequest();
        }
        return trimmed;
    }

    private static CommunityPostResponse mapPost(ResultSet rs, Long viewerId) throws SQLException {
        long authorId = rs.getLong("member_id");
        String nickname = rs.getString("member_nickname");
        String memberStatus = rs.getString("member_status");
        boolean authorWithdrawn = "WITHDRAWN".equals(memberStatus) || nickname == null;
        String displayNickname = authorWithdrawn ? WITHDRAWN_AUTHOR_NICKNAME : nickname;
        return new CommunityPostResponse(
                rs.getLong("id"),
                authorId,
                displayNickname,
                authorWithdrawn,
                rs.getString("category"),
                rs.getString("symbol_tag"),
                rs.getString("title"),
                rs.getString("content"),
                rs.getInt("like_count"),
                rs.getInt("comment_count"),
                rs.getBoolean("liked_by_me"),
                viewerId != null && viewerId.equals(authorId),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant()
        );
    }

    private static CommunityCommentResponse mapComment(ResultSet rs, Long viewerId) throws SQLException {
        long authorId = rs.getLong("member_id");
        String nickname = rs.getString("member_nickname");
        String memberStatus = rs.getString("member_status");
        boolean authorWithdrawn = "WITHDRAWN".equals(memberStatus) || nickname == null;
        String displayNickname = authorWithdrawn ? WITHDRAWN_AUTHOR_NICKNAME : nickname;
        long parentRaw = rs.getLong("parent_comment_id");
        Long parentCommentId = rs.wasNull() ? null : parentRaw;
        return new CommunityCommentResponse(
                rs.getLong("id"),
                rs.getLong("post_id"),
                authorId,
                displayNickname,
                authorWithdrawn,
                parentCommentId,
                rs.getString("content"),
                viewerId != null && viewerId.equals(authorId),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant()
        );
    }

    private record LockedPost(
            Long id,
            Long memberId,
            String category,
            String symbolTag,
            String title,
            String content,
            String status
    ) { }

    private record OwnerStatus(Long memberId, String status) { }

    private record CommentOwnerStatus(Long postId, Long memberId, String status) { }

    private static AuthFailure invalidRequest() {
        return new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
    }

    private static AuthFailure notFound() {
        return new AuthFailure("RESOURCE_NOT_FOUND", HttpStatus.NOT_FOUND);
    }

    private static AuthFailure forbidden() {
        return new AuthFailure("ACCESS_DENIED", HttpStatus.FORBIDDEN);
    }
}
