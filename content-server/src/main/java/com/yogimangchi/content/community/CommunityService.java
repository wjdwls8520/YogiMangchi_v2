package com.yogimangchi.content.community;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class CommunityService {
    private static final Set<String> CATEGORIES = Set.of("MARKET", "ANALYSIS", "POSITION", "FREE");
    public static final String WITHDRAWN_AUTHOR_NICKNAME = "탈퇴한회원";
    public static final String DELETED_COMMENT_MASK = "삭제된 댓글입니다.";

    private static final Map<String, String> REPORT_REASONS;
    static {
        Map<String, String> reasons = new LinkedHashMap<>();
        reasons.put("SPAM", "스팸 홍보/도배글입니다.");
        reasons.put("SEXUAL", "음란물입니다.");
        reasons.put("ILLEGAL", "불법정보를 포함하고 있습니다.");
        reasons.put("YOUTH_HARMFUL", "청소년에게 유해한 내용입니다.");
        reasons.put("ABUSE", "욕설/생명경시/혐오/차별적 표현입니다.");
        reasons.put("PRIVACY", "개인정보 노출 게시물입니다.");
        reasons.put("INAPPROPRIATE", "불쾌한 표현이 있습니다.");
        reasons.put("FRAUD", "사기·허위정보");
        reasons.put("ETC", "기타");
        REPORT_REASONS = Collections.unmodifiableMap(reasons);
    }

    public record SharedPositionSnapshot(
            String id,
            String marketLabel,
            String symbol,
            String pair,
            String side,
            int leverage,
            String entryPrice,
            String markPrice,
            String liquidationPrice,
            String roePct,
            String pnlUsdt,
            boolean positive,
            Boolean showPnlAmount,
            Boolean verified
    ) { }

    public record PostFileResponse(
            Long id,
            Long postId,
            String originalName,
            long size,
            String url,
            String contentType,
            Instant createdAt
    ) { }

    public record CreatePostRequest(
            String category,
            String symbolTag,
            String title,
            String content,
            SharedPositionSnapshot sharedPosition
    ) {
        public CreatePostRequest(String category, String symbolTag, String title, String content) {
            this(category, symbolTag, title, content, null);
        }
    }

    public record UpdatePostRequest(
            String category,
            String symbolTag,
            String title,
            String content,
            SharedPositionSnapshot sharedPosition,
            List<Long> deleteFileIds,
            Boolean clearSharedPosition
    ) {
        public UpdatePostRequest(
                String category,
                String symbolTag,
                String title,
                String content,
                SharedPositionSnapshot sharedPosition,
                List<Long> deleteFileIds) {
            this(category, symbolTag, title, content, sharedPosition, deleteFileIds, null);
        }

        public UpdatePostRequest(String category, String symbolTag, String title, String content) {
            this(category, symbolTag, title, content, null, null, null);
        }
    }

    public record CreateCommentRequest(
            String content,
            Long parentCommentId,
            Long targetCommentId,
            Long targetMemberId
    ) {
        public CreateCommentRequest(String content, Long parentCommentId) {
            this(content, parentCommentId, null, null);
        }
    }

    public record UpdateCommentRequest(String content) { }

    public record ReportRequest(String reasonType, String reason) { }

    public record ReportReasonResponse(String code, String description) { }

    public record ReportResponse(Long targetId, int reportCount, boolean reportedByMe) { }

    public record CommunityPostResponse(
            Long id,
            Long memberId,
            String authorNickname,
            String authorProfileImgUrl,
            boolean authorWithdrawn,
            String category,
            String symbolTag,
            String title,
            String content,
            int likeCount,
            int commentCount,
            int reportCount,
            boolean likedByMe,
            boolean reportedByMe,
            boolean mine,
            List<PostFileResponse> files,
            SharedPositionSnapshot sharedPosition,
            Instant createdAt,
            Instant updatedAt
    ) {
        public CommunityPostResponse(
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
                int reportCount,
                boolean likedByMe,
                boolean reportedByMe,
                boolean mine,
                List<PostFileResponse> files,
                SharedPositionSnapshot sharedPosition,
                Instant createdAt,
                Instant updatedAt) {
            this(id, memberId, authorNickname, null, authorWithdrawn, category, symbolTag, title, content,
                    likeCount, commentCount, reportCount, likedByMe, reportedByMe, mine, files, sharedPosition, createdAt, updatedAt);
        }
    }

    public record CommunityPostPageResponse(
            List<CommunityPostResponse> items,
            boolean hasNext,
            Long nextCursorId
    ) { }

    public record LatestPostsCheckResponse(
            long newPostCount,
            Long latestPostId,
            List<CommunityPostResponse> items
    ) { }

    public record PostLikeResponse(
            Long postId,
            int likeCount,
            boolean likedByMe
    ) { }

    public record CommentLikeResponse(
            Long commentId,
            int likeCount,
            boolean likedByMe
    ) { }

    public record CommunityCommentResponse(
            Long id,
            Long postId,
            Long memberId,
            String authorNickname,
            String authorProfileImgUrl,
            boolean authorWithdrawn,
            Long parentCommentId,
            Long targetCommentId,
            Long targetMemberId,
            String targetNickname,
            String content,
            int likeCount,
            int reportCount,
            boolean likedByMe,
            boolean reportedByMe,
            boolean mine,
            boolean deleted,
            Instant createdAt,
            Instant updatedAt
    ) {
        public CommunityCommentResponse(
                Long id,
                Long postId,
                Long memberId,
                String authorNickname,
                boolean authorWithdrawn,
                Long parentCommentId,
                Long targetCommentId,
                Long targetMemberId,
                String targetNickname,
                String content,
                int likeCount,
                int reportCount,
                boolean likedByMe,
                boolean reportedByMe,
                boolean mine,
                boolean deleted,
                Instant createdAt,
                Instant updatedAt) {
            this(id, postId, memberId, authorNickname, null, authorWithdrawn, parentCommentId, targetCommentId,
                    targetMemberId, targetNickname, content, likeCount, reportCount, likedByMe, reportedByMe, mine, deleted, createdAt, updatedAt);
        }
    }

    public record CommunityCommentListResponse(
            List<CommunityCommentResponse> items,
            boolean hasNext,
            Long nextCursorId
    ) {
        public CommunityCommentListResponse(List<CommunityCommentResponse> items) {
            this(items, false, null);
        }
    }

    public record MemberCommunityCommentItem(
            Long id,
            Long postId,
            String postTitle,
            String postCategory,
            String postSymbolTag,
            Long memberId,
            String authorNickname,
            String authorProfileImgUrl,
            boolean authorWithdrawn,
            Long parentCommentId,
            Long targetCommentId,
            Long targetMemberId,
            String targetNickname,
            String content,
            int likeCount,
            int reportCount,
            boolean likedByMe,
            boolean reportedByMe,
            boolean mine,
            Instant createdAt,
            Instant updatedAt
    ) { }

    public record MemberCommunityCommentPageResponse(
            List<MemberCommunityCommentItem> items,
            boolean hasNext,
            Long nextCursorId
    ) { }

    public record MemberCommunityReportItem(
            Long id,
            String targetType,
            Long targetId,
            Long postId,
            String title,
            String reasonType,
            String reasonDescription,
            String status,
            Instant createdAt
    ) { }

    public record MemberCommunityReportPageResponse(
            List<MemberCommunityReportItem> items,
            boolean hasNext,
            Long nextCursorId
    ) { }

    private final MemberRepository members;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final CommunityS3Service s3;
    private final CommunityUxSseService uxSse;

    public CommunityService(
            MemberRepository members,
            JdbcTemplate jdbc,
            ObjectMapper json,
            CommunityS3Service s3,
            CommunityUxSseService uxSse) {
        this.members = members;
        this.jdbc = jdbc;
        this.json = json;
        this.s3 = s3;
        this.uxSse = uxSse;
    }

    public List<ReportReasonResponse> listReportReasons() {
        return REPORT_REASONS.entrySet().stream()
                .map(e -> new ReportReasonResponse(e.getKey(), e.getValue()))
                .toList();
    }

    public SharedPositionSnapshot parseSharedPositionJson(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return null;
        }
        try {
            return json.readValue(rawJson, SharedPositionSnapshot.class);
        } catch (JsonProcessingException e) {
            throw invalidRequest();
        }
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
            String upper = category.strip().toUpperCase(Locale.ROOT);
            if (!"ALL".equals(upper)) {
                if (!CATEGORIES.contains(upper)) {
                    throw invalidRequest();
                }
                normalizedCategory = upper;
            }
        }

        String normalizedSort = normalizeSort(sort);
        String normalizedSymbol = normalizeSymbolTag(symbolTag);

        String search = "";
        if (keyword != null) {
            if (keyword.codePointCount(0, keyword.length()) > 40 || keyword.indexOf('\0') >= 0) {
                throw invalidRequest();
            }
            search = keyword.strip();
        }

        StringBuilder sql = new StringBuilder(
                "select p.id, p.member_id, m.nickname as member_nickname, m.profile_img_url as member_profile_img_url, m.status as member_status, "
                        + "p.category, p.symbol_tag, p.title, p.content, p.like_count, p.comment_count, p.report_count, "
                        + "p.shared_position_json, p.created_at, p.updated_at, "
                        + (viewerId == null
                        ? "false as liked_by_me, false as reported_by_me "
                        : "exists(select 1 from content.community_post_like l where l.post_id = p.id and l.member_id = ?) as liked_by_me, "
                          + "exists(select 1 from content.community_post_report r where r.post_id = p.id and r.member_id = ?) as reported_by_me ")
                        + "from content.community_post p "
                        + "join content.member m on m.id = p.member_id "
                        + "where p.status = 'ACTIVE'");

        List<Object> params = new ArrayList<>();
        if (viewerId != null) {
            params.add(viewerId);
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

        var rawRows = jdbc.query(sql.toString(), (rs, n) -> mapRawPost(rs, viewerId), params.toArray());
        boolean hasNext = rawRows.size() > limit;
        var pageRaw = rawRows.subList(0, Math.min(limit, rawRows.size()));
        var hydrated = hydratePostFiles(pageRaw);
        Long nextCursorId = hasNext && !hydrated.isEmpty() ? hydrated.get(hydrated.size() - 1).id() : null;
        return new CommunityPostPageResponse(hydrated, hasNext, nextCursorId);
    }

    @Transactional(readOnly = true, timeout = 3)
    public LatestPostsCheckResponse checkLatestPosts(Long sincePostId, String category, String symbolTag, Long viewerId) {
        if (sincePostId != null && sincePostId < 0) {
            throw invalidRequest();
        }
        String normalizedCategory = null;
        if (category != null && !category.isBlank()) {
            String upper = category.strip().toUpperCase(Locale.ROOT);
            if (!"ALL".equals(upper)) {
                if (!CATEGORIES.contains(upper)) {
                    throw invalidRequest();
                }
                normalizedCategory = upper;
            }
        }
        String normalizedSymbol = normalizeSymbolTag(symbolTag);

        long baselineId = sincePostId == null ? 0L : sincePostId;
        StringBuilder countSql = new StringBuilder(
                "select count(*) from content.community_post p where p.status = 'ACTIVE' and p.id > ?");
        List<Object> countParams = new ArrayList<>();
        countParams.add(baselineId);
        if (normalizedCategory != null) {
            countSql.append(" and p.category = ?");
            countParams.add(normalizedCategory);
        }
        if (normalizedSymbol != null) {
            countSql.append(" and p.symbol_tag = ?");
            countParams.add(normalizedSymbol);
        }
        Long newCount = jdbc.queryForObject(countSql.toString(), Long.class, countParams.toArray());

        CommunityPostPageResponse topPage = listPosts(normalizedCategory, "LATEST", normalizedSymbol, null, null, 10, viewerId);
        List<CommunityPostResponse> freshItems = sincePostId == null
                ? topPage.items()
                : topPage.items().stream().filter(p -> p.id() > sincePostId).toList();
        Long latestId = topPage.items().isEmpty() ? sincePostId : topPage.items().get(0).id();
        return new LatestPostsCheckResponse(newCount == null ? 0L : newCount, latestId, freshItems);
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
        return createPost(memberId, body, List.of());
    }

    @Transactional(timeout = 5)
    public CommunityPostResponse createPost(Long memberId, CreatePostRequest body, List<MultipartFile> files) {
        if (body == null) {
            throw invalidRequest();
        }
        String category = validateCategory(body.category());
        String symbolTag = normalizeSymbolTag(body.symbolTag());
        String title = validateTitle(body.title());
        String content = validatePostContent(body.content());
        String sharedPositionJson = serializeSharedPosition(body.sharedPosition());

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        List<CommunityS3Service.UploadResult> uploadedFiles = s3.validateAndUploadPostImages(files, 0);

        Long postId = jdbc.queryForObject(
                "insert into content.community_post("
                        + "member_id, category, symbol_tag, title, content, shared_position_json, "
                        + "status, like_count, comment_count, report_count, created_at, updated_at"
                        + ") values (?, ?, ?, ?, ?, ?, 'ACTIVE', 0, 0, 0, now(), now()) returning id",
                Long.class,
                memberId, category, symbolTag, title, content, sharedPositionJson);

        insertUploadedFiles(postId, uploadedFiles);

        CommunityPostResponse created = queryActivePost(postId, memberId);
        CommunityPostResponse publicSnapshot = new CommunityPostResponse(
                created.id(),
                created.memberId(),
                created.authorNickname(),
                created.authorProfileImgUrl(),
                created.authorWithdrawn(),
                created.category(),
                created.symbolTag(),
                created.title(),
                created.content(),
                created.likeCount(),
                created.commentCount(),
                created.reportCount(),
                false,
                false,
                false,
                created.files(),
                created.sharedPosition(),
                created.createdAt(),
                created.updatedAt()
        );
        uxSse.publishPostCreatedAfterCommit(new CommunityUxSseService.PostCreatedUxEvent(
                created.id(),
                created.title(),
                created.memberId(),
                created.authorNickname(),
                created.category(),
                created.symbolTag(),
                created.createdAt(),
                publicSnapshot
        ));
        return created;
    }

    @Transactional(timeout = 5)
    public CommunityPostResponse updatePost(Long memberId, Long postId, UpdatePostRequest body) {
        return updatePost(memberId, postId, body, List.of());
    }

    @Transactional(timeout = 5)
    public CommunityPostResponse updatePost(Long memberId, Long postId, UpdatePostRequest body, List<MultipartFile> newFiles) {
        if (postId == null || postId <= 0 || body == null) {
            throw invalidRequest();
        }
        boolean hasFileMutations = (body.deleteFileIds() != null && !body.deleteFileIds().isEmpty())
                || (newFiles != null && newFiles.stream().anyMatch(f -> f != null && !f.isEmpty()));
        if (body.category() == null && body.symbolTag() == null && body.title() == null
                && body.content() == null && body.sharedPosition() == null
                && !Boolean.TRUE.equals(body.clearSharedPosition()) && !hasFileMutations) {
            throw invalidRequest();
        }

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var locked = jdbc.query(
                "select id, member_id, category, symbol_tag, title, content, shared_position_json, status "
                        + "from content.community_post where id = ? for update",
                (rs, n) -> new LockedPost(
                        rs.getLong("id"),
                        rs.getLong("member_id"),
                        rs.getString("category"),
                        rs.getString("symbol_tag"),
                        rs.getString("title"),
                        rs.getString("content"),
                        rs.getString("shared_position_json"),
                        rs.getString("status")),
                postId);
        if (locked.isEmpty() || !"ACTIVE".equals(locked.get(0).status())) {
            throw notFound();
        }
        LockedPost existing = locked.get(0);
        if (!existing.memberId().equals(memberId)) {
            throw forbidden();
        }

        List<String> keysToDeleteAfterCommit = new ArrayList<>();
        if (body.deleteFileIds() != null && !body.deleteFileIds().isEmpty()) {
            List<Long> cleanDeleteIds = body.deleteFileIds().stream()
                    .filter(Objects::nonNull)
                    .distinct()
                    .toList();
            for (Long fileId : cleanDeleteIds) {
                var s3Keys = jdbc.queryForList(
                        "delete from content.community_post_file where id = ? and post_id = ? returning s3_key",
                        String.class,
                        fileId, postId);
                keysToDeleteAfterCommit.addAll(s3Keys);
            }
        }

        Integer remainingFilesCount = jdbc.queryForObject(
                "select count(*) from content.community_post_file where post_id = ?",
                Integer.class,
                postId);
        List<CommunityS3Service.UploadResult> uploadedFiles = s3.validateAndUploadPostImages(
                newFiles,
                remainingFilesCount == null ? 0 : remainingFilesCount);
        insertUploadedFiles(postId, uploadedFiles);

        if (!keysToDeleteAfterCommit.isEmpty()) {
            s3.registerAfterCommitDelete(keysToDeleteAfterCommit);
        }

        String category = body.category() == null ? existing.category() : validateCategory(body.category());
        String symbolTag = body.symbolTag() == null ? existing.symbolTag() : normalizeSymbolTag(body.symbolTag());
        String title = body.title() == null ? existing.title() : validateTitle(body.title());
        String content = body.content() == null ? existing.content() : validatePostContent(body.content());
        String sharedPositionJson;
        if (Boolean.TRUE.equals(body.clearSharedPosition())) {
            sharedPositionJson = null;
        } else if (body.sharedPosition() != null) {
            sharedPositionJson = serializeSharedPosition(body.sharedPosition());
        } else {
            sharedPositionJson = existing.sharedPositionJson();
        }

        jdbc.update(
                "update content.community_post set category = ?, symbol_tag = ?, title = ?, content = ?, shared_position_json = ?, updated_at = now() where id = ?",
                category, symbolTag, title, content, sharedPositionJson, postId);
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
            List<String> keys = jdbc.queryForList(
                    "delete from content.community_post_file where post_id = ? returning s3_key",
                    String.class,
                    postId);
            s3.registerAfterCommitDelete(keys);
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

    @Transactional(timeout = 5)
    public ReportResponse changePostReport(Long memberId, Long postId, String reasonType, boolean report) {
        if (postId == null || postId <= 0) {
            throw notFound();
        }
        String normalizedReason = report ? normalizeReportReason(reasonType) : "SPAM";

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var locked = jdbc.query(
                "select member_id, status from content.community_post where id = ? for update",
                (rs, n) -> new OwnerStatus(rs.getLong("member_id"), rs.getString("status")),
                postId);
        if (locked.isEmpty() || !"ACTIVE".equals(locked.get(0).status())) {
            throw notFound();
        }
        if (locked.get(0).memberId().equals(memberId)) {
            throw invalidRequest();
        }

        if (report) {
            jdbc.update(
                    "insert into content.community_post_report(post_id, member_id, reason_type, created_at) "
                            + "values (?, ?, ?, now()) "
                            + "on conflict(post_id, member_id) do update set reason_type = excluded.reason_type",
                    postId, memberId, normalizedReason);
        } else {
            jdbc.update(
                    "delete from content.community_post_report where post_id = ? and member_id = ?",
                    postId, memberId);
        }

        Integer reportCount = jdbc.queryForObject(
                "update content.community_post set report_count = (select count(*) from content.community_post_report where post_id = ?) where id = ? returning report_count",
                Integer.class,
                postId, postId);
        return new ReportResponse(postId, reportCount == null ? 0 : reportCount, report);
    }

    @Transactional(readOnly = true, timeout = 3)
    public CommunityCommentListResponse listComments(Long postId, Long viewerId) {
        return listComments(postId, null, null, viewerId);
    }

    @Transactional(readOnly = true, timeout = 3)
    public CommunityCommentListResponse listComments(Long postId, Long cursorId, Integer size, Long viewerId) {
        if (postId == null || postId <= 0) {
            throw notFound();
        }
        int limit = size == null ? 20 : size;
        if (limit < 1 || limit > 100 || (cursorId != null && cursorId <= 0)) {
            throw invalidRequest();
        }
        Boolean activePost = jdbc.queryForObject(
                "select exists(select 1 from content.community_post where id = ? and status = 'ACTIVE')",
                Boolean.class,
                postId);
        if (!Boolean.TRUE.equals(activePost)) {
            throw notFound();
        }

        String selectCols = "select c.id, c.post_id, c.member_id, m.nickname as member_nickname, m.profile_img_url as member_profile_img_url, m.status as member_status, "
                + "c.parent_comment_id, c.target_comment_id, c.target_member_id, "
                + "tm.nickname as target_member_nickname, tm.status as target_member_status, "
                + "c.content, c.status as comment_status, c.like_count, c.report_count, c.created_at, c.updated_at, "
                + (viewerId == null
                ? "false as liked_by_me, false as reported_by_me "
                : "exists(select 1 from content.community_comment_like l where l.comment_id = c.id and l.member_id = ?) as liked_by_me, "
                  + "exists(select 1 from content.community_comment_report r where r.comment_id = c.id and r.member_id = ?) as reported_by_me ")
                + "from content.community_comment c "
                + "join content.member m on m.id = c.member_id "
                + "left join content.member tm on tm.id = c.target_member_id ";

        StringBuilder rootSql = new StringBuilder(selectCols)
                .append("where c.post_id = ? and c.parent_comment_id is null ")
                .append("and (c.status = 'ACTIVE' or exists(")
                .append("  select 1 from content.community_comment child ")
                .append("  where child.post_id = c.post_id and child.parent_comment_id = c.id and child.status = 'ACTIVE'")
                .append(")) ");

        List<Object> rootParams = new ArrayList<>();
        if (viewerId != null) {
            rootParams.add(viewerId);
            rootParams.add(viewerId);
        }
        rootParams.add(postId);
        if (cursorId != null) {
            rootSql.append("and c.id > ? ");
            rootParams.add(cursorId);
        }
        rootSql.append("order by c.id asc limit ?");
        rootParams.add(limit + 1);

        List<CommunityCommentResponse> rootRows = jdbc.query(
                rootSql.toString(),
                (rs, n) -> mapComment(rs, viewerId),
                rootParams.toArray());

        boolean hasNext = rootRows.size() > limit;
        List<CommunityCommentResponse> pagedRoots = rootRows.subList(0, Math.min(limit, rootRows.size()));
        Long nextCursorId = hasNext && !pagedRoots.isEmpty() ? pagedRoots.get(pagedRoots.size() - 1).id() : null;
        if (pagedRoots.isEmpty()) {
            return new CommunityCommentListResponse(List.of(), false, null);
        }

        List<Long> rootIds = pagedRoots.stream().map(CommunityCommentResponse::id).toList();
        String placeholders = rootIds.stream().map(id -> "?").collect(Collectors.joining(","));
        String childSql = selectCols
                + "where c.post_id = ? and c.parent_comment_id in (" + placeholders + ") and c.status = 'ACTIVE' "
                + "order by c.id asc";

        List<Object> childParams = new ArrayList<>();
        if (viewerId != null) {
            childParams.add(viewerId);
            childParams.add(viewerId);
        }
        childParams.add(postId);
        childParams.addAll(rootIds);

        List<CommunityCommentResponse> childRows = jdbc.query(
                childSql,
                (rs, n) -> mapComment(rs, viewerId),
                childParams.toArray());

        Map<Long, List<CommunityCommentResponse>> childrenByParent = new HashMap<>();
        for (CommunityCommentResponse child : childRows) {
            if (child.parentCommentId() != null) {
                childrenByParent.computeIfAbsent(child.parentCommentId(), k -> new ArrayList<>()).add(child);
            }
        }

        List<CommunityCommentResponse> combined = new ArrayList<>(pagedRoots.size() + childRows.size());
        for (CommunityCommentResponse root : pagedRoots) {
            combined.add(root);
            combined.addAll(childrenByParent.getOrDefault(root.id(), List.of()));
        }
        return new CommunityCommentListResponse(combined, hasNext, nextCursorId);
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
        Long targetCommentId = body.targetCommentId();
        Long targetMemberId = body.targetMemberId();
        if (parentCommentId != null && parentCommentId <= 0
                || targetCommentId != null && targetCommentId <= 0
                || targetMemberId != null && targetMemberId <= 0) {
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
            var parentRows = jdbc.query(
                    "select id, member_id, parent_comment_id, status from content.community_comment where id = ? and post_id = ?",
                    (rs, n) -> {
                        long pRaw = rs.getLong("parent_comment_id");
                        Long pId = rs.wasNull() ? null : pRaw;
                        return new CommentNodeRow(rs.getLong("id"), rs.getLong("member_id"), pId, rs.getString("status"));
                    },
                    parentCommentId, postId);
            if (parentRows.isEmpty() || !"ACTIVE".equals(parentRows.get(0).status())) {
                throw invalidRequest();
            }
            CommentNodeRow parentNode = parentRows.get(0);
            if (parentNode.parentCommentId() != null) {
                // Depth >= 2 reply to a child reply: normalize parentCommentId to the root comment
                // and preserve @targetNickname pointing to the replied-to child comment.
                Long rootCommentId = parentNode.parentCommentId();
                var rootRows = jdbc.query(
                        "select id from content.community_comment where id = ? and post_id = ?",
                        (rs, n) -> rs.getLong("id"),
                        rootCommentId, postId);
                if (rootRows.isEmpty()) {
                    throw invalidRequest();
                }
                parentCommentId = rootCommentId;
                if (targetCommentId == null) {
                    targetCommentId = parentNode.id();
                    targetMemberId = parentNode.memberId();
                }
            }

            if (targetCommentId != null) {
                var targetRows = jdbc.query(
                        "select member_id from content.community_comment where id = ? and post_id = ?",
                        (rs, n) -> rs.getLong("member_id"),
                        targetCommentId, postId);
                if (targetRows.isEmpty()) {
                    throw invalidRequest();
                }
                if (targetMemberId == null) {
                    targetMemberId = targetRows.get(0);
                }
            }
        } else if (targetCommentId != null) {
            throw invalidRequest();
        } else {
            targetMemberId = null;
        }

        if (targetMemberId != null) {
            Boolean memberExists = jdbc.queryForObject(
                    "select exists(select 1 from content.member where id = ?)",
                    Boolean.class,
                    targetMemberId);
            if (!Boolean.TRUE.equals(memberExists)) {
                throw invalidRequest();
            }
        }

        Long commentId = jdbc.queryForObject(
                "insert into content.community_comment("
                        + "post_id, member_id, parent_comment_id, target_comment_id, target_member_id, "
                        + "content, status, like_count, report_count, reply_count, created_at, updated_at"
                        + ") values (?, ?, ?, ?, ?, ?, 'ACTIVE', 0, 0, 0, now(), now()) returning id",
                Long.class,
                postId, memberId, parentCommentId, targetCommentId, targetMemberId, content);

        if (parentCommentId != null) {
            jdbc.update(
                    "update content.community_comment set reply_count = ("
                            + "select count(*) from content.community_comment where parent_comment_id = ? and status = 'ACTIVE'"
                            + ") where id = ?",
                    parentCommentId, parentCommentId);
        }

        jdbc.update(
                "update content.community_post set comment_count = (select count(*) from content.community_comment where post_id = ? and status = 'ACTIVE') where id = ?",
                postId, postId);

        return querySingleComment(commentId, memberId);
    }

    @Transactional(timeout = 5)
    public CommunityCommentResponse updateComment(Long memberId, Long commentId, UpdateCommentRequest body) {
        if (commentId == null || commentId <= 0) {
            throw notFound();
        }
        if (body == null) {
            throw invalidRequest();
        }
        String content = validateCommentContent(body.content());

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var locked = jdbc.query(
                "select post_id, member_id, status from content.community_comment where id = ? for update",
                (rs, n) -> new CommentOwnerStatus(rs.getLong("post_id"), rs.getLong("member_id"), rs.getString("status")),
                commentId);
        if (locked.isEmpty() || !"ACTIVE".equals(locked.get(0).status())) {
            throw notFound();
        }
        if (!locked.get(0).memberId().equals(memberId)) {
            throw forbidden();
        }

        jdbc.update(
                "update content.community_comment set content = ?, updated_at = now() where id = ?",
                content, commentId);
        return querySingleComment(commentId, memberId);
    }

    @Transactional(timeout = 5)
    public void deleteComment(Long memberId, Long commentId) {
        if (commentId == null || commentId <= 0) {
            throw notFound();
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var locked = jdbc.query(
                "select post_id, member_id, parent_comment_id, status from content.community_comment where id = ? for update",
                (rs, n) -> {
                    long parentRaw = rs.getLong("parent_comment_id");
                    Long parentId = rs.wasNull() ? null : parentRaw;
                    return new CommentOwnerHierarchy(rs.getLong("post_id"), rs.getLong("member_id"), parentId, rs.getString("status"));
                },
                commentId);
        if (locked.isEmpty()) {
            throw notFound();
        }
        CommentOwnerHierarchy existing = locked.get(0);
        if (!existing.memberId().equals(memberId)) {
            throw forbidden();
        }

        jdbc.queryForList("select id from content.community_post where id = ? for update", Long.class, existing.postId());
        if ("ACTIVE".equals(existing.status())) {
            jdbc.update(
                    "update content.community_comment set status = 'DELETED', deleted_at = now(), updated_at = now() where id = ?",
                    commentId);
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

    @Transactional(timeout = 5)
    public CommentLikeResponse changeCommentLike(Long memberId, Long commentId, boolean like) {
        if (commentId == null || commentId <= 0) {
            throw notFound();
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var statusRows = jdbc.queryForList(
                "select status from content.community_comment where id = ? for update",
                String.class,
                commentId);
        if (statusRows.isEmpty() || !"ACTIVE".equals(statusRows.get(0))) {
            throw notFound();
        }

        if (like) {
            jdbc.update(
                    "insert into content.community_comment_like(comment_id, member_id, created_at) values (?, ?, now()) on conflict(comment_id, member_id) do nothing",
                    commentId, memberId);
        } else {
            jdbc.update(
                    "delete from content.community_comment_like where comment_id = ? and member_id = ?",
                    commentId, memberId);
        }

        Integer likeCount = jdbc.queryForObject(
                "update content.community_comment set like_count = (select count(*) from content.community_comment_like where comment_id = ?) where id = ? returning like_count",
                Integer.class,
                commentId, commentId);
        return new CommentLikeResponse(commentId, likeCount == null ? 0 : likeCount, like);
    }

    @Transactional(timeout = 5)
    public ReportResponse changeCommentReport(Long memberId, Long commentId, String reasonType, boolean report) {
        if (commentId == null || commentId <= 0) {
            throw notFound();
        }
        String normalizedReason = report ? normalizeReportReason(reasonType) : "SPAM";

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        requireActiveMember(memberId);

        var locked = jdbc.query(
                "select member_id, status from content.community_comment where id = ? for update",
                (rs, n) -> new OwnerStatus(rs.getLong("member_id"), rs.getString("status")),
                commentId);
        if (locked.isEmpty() || !"ACTIVE".equals(locked.get(0).status())) {
            throw notFound();
        }
        if (locked.get(0).memberId().equals(memberId)) {
            throw invalidRequest();
        }

        if (report) {
            jdbc.update(
                    "insert into content.community_comment_report(comment_id, member_id, reason_type, created_at) "
                            + "values (?, ?, ?, now()) "
                            + "on conflict(comment_id, member_id) do update set reason_type = excluded.reason_type",
                    commentId, memberId, normalizedReason);
        } else {
            jdbc.update(
                    "delete from content.community_comment_report where comment_id = ? and member_id = ?",
                    commentId, memberId);
        }

        Integer reportCount = jdbc.queryForObject(
                "update content.community_comment set report_count = (select count(*) from content.community_comment_report where comment_id = ?) where id = ? returning report_count",
                Integer.class,
                commentId, commentId);
        return new ReportResponse(commentId, reportCount == null ? 0 : reportCount, report);
    }

    @Transactional(readOnly = true, timeout = 3)
    public CommunityPostPageResponse listMemberPosts(Long targetMemberId, Long cursorId, Integer size, Long viewerId) {
        int limit = validateActivityPageLimit(cursorId, size);
        requirePublicActiveMember(targetMemberId);

        StringBuilder sql = new StringBuilder(
                "select p.id, p.member_id, m.nickname as member_nickname, m.profile_img_url as member_profile_img_url, m.status as member_status, "
                        + "p.category, p.symbol_tag, p.title, p.content, p.like_count, p.comment_count, p.report_count, "
                        + "p.shared_position_json, p.created_at, p.updated_at, "
                        + (viewerId == null
                        ? "false as liked_by_me, false as reported_by_me "
                        : "exists(select 1 from content.community_post_like l where l.post_id = p.id and l.member_id = ?) as liked_by_me, "
                          + "exists(select 1 from content.community_post_report r where r.post_id = p.id and r.member_id = ?) as reported_by_me ")
                        + "from content.community_post p "
                        + "join content.member m on m.id = p.member_id "
                        + "where p.status = 'ACTIVE' and p.member_id = ?");

        List<Object> params = new ArrayList<>();
        if (viewerId != null) {
            params.add(viewerId);
            params.add(viewerId);
        }
        params.add(targetMemberId);
        if (cursorId != null) {
            sql.append(" and p.id < ?");
            params.add(cursorId);
        }
        sql.append(" order by p.id desc limit ?");
        params.add(limit + 1);

        var rawRows = jdbc.query(sql.toString(), (rs, n) -> mapRawPost(rs, viewerId), params.toArray());
        boolean hasNext = rawRows.size() > limit;
        var pageRaw = rawRows.subList(0, Math.min(limit, rawRows.size()));
        var hydrated = hydratePostFiles(pageRaw);
        Long nextCursorId = hasNext && !hydrated.isEmpty() ? hydrated.get(hydrated.size() - 1).id() : null;
        return new CommunityPostPageResponse(hydrated, hasNext, nextCursorId);
    }

    @Transactional(readOnly = true, timeout = 3)
    public MemberCommunityCommentPageResponse listMemberComments(Long targetMemberId, Long cursorId, Integer size, Long viewerId) {
        int limit = validateActivityPageLimit(cursorId, size);
        requirePublicActiveMember(targetMemberId);

        StringBuilder sql = new StringBuilder(
                "select c.id, c.post_id, p.title as post_title, p.category as post_category, p.symbol_tag as post_symbol_tag, "
                        + "c.member_id, m.nickname as member_nickname, m.profile_img_url as member_profile_img_url, m.status as member_status, "
                        + "c.parent_comment_id, c.target_comment_id, c.target_member_id, "
                        + "tm.nickname as target_member_nickname, tm.status as target_member_status, "
                        + "c.content, c.like_count, c.report_count, c.created_at, c.updated_at, "
                        + (viewerId == null
                        ? "false as liked_by_me, false as reported_by_me "
                        : "exists(select 1 from content.community_comment_like l where l.comment_id = c.id and l.member_id = ?) as liked_by_me, "
                          + "exists(select 1 from content.community_comment_report r where r.comment_id = c.id and r.member_id = ?) as reported_by_me ")
                        + "from content.community_comment c "
                        + "join content.community_post p on p.id = c.post_id "
                        + "join content.member m on m.id = c.member_id "
                        + "left join content.member tm on tm.id = c.target_member_id "
                        + "where c.member_id = ? and c.status = 'ACTIVE' and p.status = 'ACTIVE'");

        List<Object> params = new ArrayList<>();
        if (viewerId != null) {
            params.add(viewerId);
            params.add(viewerId);
        }
        params.add(targetMemberId);
        if (cursorId != null) {
            sql.append(" and c.id < ?");
            params.add(cursorId);
        }
        sql.append(" order by c.id desc limit ?");
        params.add(limit + 1);

        var rows = jdbc.query(sql.toString(), (rs, n) -> mapMemberCommentItem(rs, viewerId), params.toArray());
        boolean hasNext = rows.size() > limit;
        var page = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;
        return new MemberCommunityCommentPageResponse(page, hasNext, nextCursorId);
    }

    @Transactional(readOnly = true, timeout = 3)
    public CommunityPostPageResponse listMemberLikedPosts(Long targetMemberId, Long cursorId, Integer size, Long viewerId) {
        int limit = validateActivityPageLimit(cursorId, size);
        requirePublicActiveMember(targetMemberId);

        StringBuilder sql = new StringBuilder(
                "select p.id, p.member_id, m.nickname as member_nickname, m.profile_img_url as member_profile_img_url, m.status as member_status, "
                        + "p.category, p.symbol_tag, p.title, p.content, p.like_count, p.comment_count, p.report_count, "
                        + "p.shared_position_json, p.created_at, p.updated_at, "
                        + (viewerId == null
                        ? "false as liked_by_me, false as reported_by_me "
                        : "exists(select 1 from content.community_post_like l where l.post_id = p.id and l.member_id = ?) as liked_by_me, "
                          + "exists(select 1 from content.community_post_report r where r.post_id = p.id and r.member_id = ?) as reported_by_me ")
                        + "from content.community_post p "
                        + "join content.member m on m.id = p.member_id "
                        + "where p.status = 'ACTIVE' "
                        + "and exists(select 1 from content.community_post_like pl where pl.post_id = p.id and pl.member_id = ?)");

        List<Object> params = new ArrayList<>();
        if (viewerId != null) {
            params.add(viewerId);
            params.add(viewerId);
        }
        params.add(targetMemberId);
        if (cursorId != null) {
            sql.append(" and p.id < ?");
            params.add(cursorId);
        }
        sql.append(" order by p.id desc limit ?");
        params.add(limit + 1);

        var rawRows = jdbc.query(sql.toString(), (rs, n) -> mapRawPost(rs, viewerId), params.toArray());
        boolean hasNext = rawRows.size() > limit;
        var pageRaw = rawRows.subList(0, Math.min(limit, rawRows.size()));
        var hydrated = hydratePostFiles(pageRaw);
        Long nextCursorId = hasNext && !hydrated.isEmpty() ? hydrated.get(hydrated.size() - 1).id() : null;
        return new CommunityPostPageResponse(hydrated, hasNext, nextCursorId);
    }

    @Transactional(readOnly = true, timeout = 3)
    public MemberCommunityCommentPageResponse listMemberLikedComments(Long targetMemberId, Long cursorId, Integer size, Long viewerId) {
        int limit = validateActivityPageLimit(cursorId, size);
        requirePublicActiveMember(targetMemberId);

        StringBuilder sql = new StringBuilder(
                "select c.id, c.post_id, p.title as post_title, p.category as post_category, p.symbol_tag as post_symbol_tag, "
                        + "c.member_id, m.nickname as member_nickname, m.profile_img_url as member_profile_img_url, m.status as member_status, "
                        + "c.parent_comment_id, c.target_comment_id, c.target_member_id, "
                        + "tm.nickname as target_member_nickname, tm.status as target_member_status, "
                        + "c.content, c.like_count, c.report_count, c.created_at, c.updated_at, "
                        + (viewerId == null
                        ? "false as liked_by_me, false as reported_by_me "
                        : "exists(select 1 from content.community_comment_like l where l.comment_id = c.id and l.member_id = ?) as liked_by_me, "
                          + "exists(select 1 from content.community_comment_report r where r.comment_id = c.id and r.member_id = ?) as reported_by_me ")
                        + "from content.community_comment c "
                        + "join content.community_post p on p.id = c.post_id "
                        + "join content.member m on m.id = c.member_id "
                        + "left join content.member tm on tm.id = c.target_member_id "
                        + "where c.status = 'ACTIVE' and p.status = 'ACTIVE' "
                        + "and exists(select 1 from content.community_comment_like cl where cl.comment_id = c.id and cl.member_id = ?)");

        List<Object> params = new ArrayList<>();
        if (viewerId != null) {
            params.add(viewerId);
            params.add(viewerId);
        }
        params.add(targetMemberId);
        if (cursorId != null) {
            sql.append(" and c.id < ?");
            params.add(cursorId);
        }
        sql.append(" order by c.id desc limit ?");
        params.add(limit + 1);

        var rows = jdbc.query(sql.toString(), (rs, n) -> mapMemberCommentItem(rs, viewerId), params.toArray());
        boolean hasNext = rows.size() > limit;
        var page = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;
        return new MemberCommunityCommentPageResponse(page, hasNext, nextCursorId);
    }

    @Transactional(readOnly = true, timeout = 3)
    public MemberCommunityReportPageResponse listMyReports(Long memberId, Long cursorId, Integer size) {
        if (memberId == null || memberId <= 0) {
            throw AuthFailure.unauthorized();
        }
        int limit = validateActivityPageLimit(cursorId, size);
        members.findById(memberId)
                .filter(m -> m.getStatus() == Member.Status.ACTIVE)
                .orElseThrow(() -> new AuthFailure("MEMBER_NOT_ACTIVE", HttpStatus.UNAUTHORIZED));

        StringBuilder sql = new StringBuilder(
                "select synthetic_id, target_type, target_id, post_id, title, reason_type, created_at from ("
                        + "select (pr.post_id * 2 + 1) as synthetic_id, 'POST' as target_type, pr.post_id as target_id, "
                        + "pr.post_id as post_id, p.title as title, pr.reason_type as reason_type, pr.created_at as created_at "
                        + "from content.community_post_report pr "
                        + "join content.community_post p on p.id = pr.post_id "
                        + "where pr.member_id = ? and p.status = 'ACTIVE' "
                        + "union all "
                        + "select (cr.comment_id * 2) as synthetic_id, 'COMMENT' as target_type, cr.comment_id as target_id, "
                        + "c.post_id as post_id, c.content as title, cr.reason_type as reason_type, cr.created_at as created_at "
                        + "from content.community_comment_report cr "
                        + "join content.community_comment c on c.id = cr.comment_id "
                        + "join content.community_post p on p.id = c.post_id "
                        + "where cr.member_id = ? and c.status = 'ACTIVE' and p.status = 'ACTIVE'"
                        + ") combined ");

        List<Object> params = new ArrayList<>();
        params.add(memberId);
        params.add(memberId);
        if (cursorId != null) {
            sql.append("where combined.synthetic_id < ? ");
            params.add(cursorId);
        }
        sql.append("order by combined.synthetic_id desc limit ?");
        params.add(limit + 1);

        var rows = jdbc.query(
                sql.toString(),
                (rs, n) -> {
                    String reasonType = rs.getString("reason_type");
                    return new MemberCommunityReportItem(
                            rs.getLong("synthetic_id"),
                            rs.getString("target_type"),
                            rs.getLong("target_id"),
                            rs.getLong("post_id"),
                            rs.getString("title"),
                            reasonType,
                            REPORT_REASONS.getOrDefault(reasonType, "기타"),
                            "RECEIVED",
                            rs.getTimestamp("created_at").toInstant());
                },
                params.toArray());

        boolean hasNext = rows.size() > limit;
        var page = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;
        return new MemberCommunityReportPageResponse(page, hasNext, nextCursorId);
    }

    private static int validateActivityPageLimit(Long cursorId, Integer size) {
        int limit = size == null ? 10 : size;
        if (limit < 1 || limit > 30 || (cursorId != null && cursorId <= 0)) {
            throw invalidRequest();
        }
        return limit;
    }

    private void requirePublicActiveMember(Long targetMemberId) {
        if (targetMemberId == null || targetMemberId <= 0) {
            throw notFound();
        }
        members.findById(targetMemberId)
                .filter(m -> m.getStatus() == Member.Status.ACTIVE)
                .orElseThrow(CommunityService::notFound);
    }

    private void insertUploadedFiles(Long postId, List<CommunityS3Service.UploadResult> uploadedFiles) {
        if (uploadedFiles == null || uploadedFiles.isEmpty()) {
            return;
        }
        for (CommunityS3Service.UploadResult f : uploadedFiles) {
            jdbc.update(
                    "insert into content.community_post_file(post_id, original_name, file_size, file_url, s3_key, content_type, created_at) "
                            + "values (?, ?, ?, ?, ?, ?, now())",
                    postId, f.originalName(), f.size(), f.url(), f.key(), f.contentType());
        }
    }

    private CommunityPostResponse queryActivePost(Long postId, Long viewerId) {
        String sql = "select p.id, p.member_id, m.nickname as member_nickname, m.profile_img_url as member_profile_img_url, m.status as member_status, "
                + "p.category, p.symbol_tag, p.title, p.content, p.like_count, p.comment_count, p.report_count, "
                + "p.shared_position_json, p.created_at, p.updated_at, "
                + (viewerId == null
                ? "false as liked_by_me, false as reported_by_me "
                : "exists(select 1 from content.community_post_like l where l.post_id = p.id and l.member_id = ?) as liked_by_me, "
                  + "exists(select 1 from content.community_post_report r where r.post_id = p.id and r.member_id = ?) as reported_by_me ")
                + "from content.community_post p "
                + "join content.member m on m.id = p.member_id "
                + "where p.id = ? and p.status = 'ACTIVE'";
        var rows = viewerId == null
                ? jdbc.query(sql, (rs, n) -> mapRawPost(rs, null), postId)
                : jdbc.query(sql, (rs, n) -> mapRawPost(rs, viewerId), viewerId, viewerId, postId);
        if (rows.isEmpty()) {
            throw notFound();
        }
        return hydratePostFiles(rows).get(0);
    }

    private CommunityCommentResponse querySingleComment(Long commentId, Long viewerId) {
        String sql = "select c.id, c.post_id, c.member_id, m.nickname as member_nickname, m.profile_img_url as member_profile_img_url, m.status as member_status, "
                + "c.parent_comment_id, c.target_comment_id, c.target_member_id, "
                + "tm.nickname as target_member_nickname, tm.status as target_member_status, "
                + "c.content, c.status as comment_status, c.like_count, c.report_count, c.created_at, c.updated_at, "
                + (viewerId == null
                ? "false as liked_by_me, false as reported_by_me "
                : "exists(select 1 from content.community_comment_like l where l.comment_id = c.id and l.member_id = ?) as liked_by_me, "
                  + "exists(select 1 from content.community_comment_report r where r.comment_id = c.id and r.member_id = ?) as reported_by_me ")
                + "from content.community_comment c "
                + "join content.member m on m.id = c.member_id "
                + "left join content.member tm on tm.id = c.target_member_id "
                + "where c.id = ?";
        var rows = viewerId == null
                ? jdbc.query(sql, (rs, n) -> mapComment(rs, null), commentId)
                : jdbc.query(sql, (rs, n) -> mapComment(rs, viewerId), viewerId, viewerId, commentId);
        if (rows.isEmpty()) {
            throw notFound();
        }
        return rows.get(0);
    }

    private List<CommunityPostResponse> hydratePostFiles(List<CommunityPostResponse> posts) {
        if (posts.isEmpty()) {
            return posts;
        }
        List<Long> postIds = posts.stream().map(CommunityPostResponse::id).toList();
        String placeholders = postIds.stream().map(id -> "?").collect(Collectors.joining(","));
        List<PostFileResponse> allFiles = jdbc.query(
                "select id, post_id, original_name, file_size, file_url, content_type, created_at "
                        + "from content.community_post_file where post_id in (" + placeholders + ") order by id asc",
                (rs, n) -> new PostFileResponse(
                        rs.getLong("id"),
                        rs.getLong("post_id"),
                        rs.getString("original_name"),
                        rs.getLong("file_size"),
                        s3.sanitizePostFileUrl(rs.getString("file_url")),
                        rs.getString("content_type"),
                        rs.getTimestamp("created_at").toInstant()),
                postIds.toArray());

        Map<Long, List<PostFileResponse>> byPostId = new HashMap<>();
        for (PostFileResponse file : allFiles) {
            byPostId.computeIfAbsent(file.postId(), k -> new ArrayList<>()).add(file);
        }

        return posts.stream()
                .map(p -> new CommunityPostResponse(
                        p.id(),
                        p.memberId(),
                        p.authorNickname(),
                        p.authorProfileImgUrl(),
                        p.authorWithdrawn(),
                        p.category(),
                        p.symbolTag(),
                        p.title(),
                        p.content(),
                        p.likeCount(),
                        p.commentCount(),
                        p.reportCount(),
                        p.likedByMe(),
                        p.reportedByMe(),
                        p.mine(),
                        byPostId.getOrDefault(p.id(), List.of()),
                        p.sharedPosition(),
                        p.createdAt(),
                        p.updatedAt()))
                .toList();
    }

    private void requireActiveMember(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw AuthFailure.unauthorized();
        }
        members.lockById(memberId)
                .filter(m -> m.getStatus() == Member.Status.ACTIVE)
                .orElseThrow(() -> new AuthFailure("MEMBER_NOT_ACTIVE", HttpStatus.UNAUTHORIZED));
    }

    private static String normalizeSort(String sort) {
        if (sort == null || sort.isBlank()) {
            return "LATEST";
        }
        String upper = sort.strip().toUpperCase(Locale.ROOT);
        return switch (upper) {
            case "LATEST", "ALL" -> "LATEST";
            case "POPULAR", "BEST" -> "POPULAR";
            default -> throw invalidRequest();
        };
    }

    private static String normalizeReportReason(String reasonType) {
        if (reasonType == null || reasonType.isBlank()) {
            return "SPAM";
        }
        String upper = reasonType.strip().toUpperCase(Locale.ROOT);
        if (!REPORT_REASONS.containsKey(upper)) {
            throw invalidRequest();
        }
        return upper;
    }

    private String serializeSharedPosition(SharedPositionSnapshot snapshot) {
        if (snapshot == null) {
            return null;
        }
        if (snapshot.symbol() == null || snapshot.symbol().isBlank()
                || snapshot.side() == null || snapshot.side().isBlank()
                || snapshot.leverage() < 1 || snapshot.leverage() > 125) {
            throw invalidRequest();
        }
        String normalizedSide = snapshot.side().strip().toUpperCase(Locale.ROOT);
        if (!"LONG".equals(normalizedSide) && !"SHORT".equals(normalizedSide)) {
            throw invalidRequest();
        }
        SharedPositionSnapshot canonical = new SharedPositionSnapshot(
                snapshot.id(),
                snapshot.marketLabel(),
                snapshot.symbol().strip().toUpperCase(Locale.ROOT),
                snapshot.pair(),
                normalizedSide,
                snapshot.leverage(),
                snapshot.entryPrice(),
                snapshot.markPrice(),
                snapshot.liquidationPrice(),
                snapshot.roePct(),
                snapshot.pnlUsdt(),
                snapshot.positive(),
                snapshot.showPnlAmount(),
                snapshot.verified());
        try {
            return json.writeValueAsString(canonical);
        } catch (JsonProcessingException e) {
            throw invalidRequest();
        }
    }

    private SharedPositionSnapshot deserializeSharedPosition(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return null;
        }
        try {
            return json.readValue(rawJson, SharedPositionSnapshot.class);
        } catch (JsonProcessingException e) {
            return null;
        }
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
        if ("ALL".equals(normalized)) {
            return null;
        }
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

    private static boolean isMaskedAuthorStatus(String memberStatus, String nickname) {
        return memberStatus == null || !"ACTIVE".equals(memberStatus) || nickname == null;
    }

    private CommunityPostResponse mapRawPost(ResultSet rs, Long viewerId) throws SQLException {
        long authorId = rs.getLong("member_id");
        String nickname = rs.getString("member_nickname");
        String memberStatus = rs.getString("member_status");
        boolean authorWithdrawn = isMaskedAuthorStatus(memberStatus, nickname);
        String displayNickname = authorWithdrawn ? WITHDRAWN_AUTHOR_NICKNAME : nickname;
        String displayProfileImgUrl = authorWithdrawn ? null : s3.sanitizeProfileImageUrl(rs.getString("member_profile_img_url"));
        return new CommunityPostResponse(
                rs.getLong("id"),
                authorId,
                displayNickname,
                displayProfileImgUrl,
                authorWithdrawn,
                rs.getString("category"),
                rs.getString("symbol_tag"),
                rs.getString("title"),
                rs.getString("content"),
                rs.getInt("like_count"),
                rs.getInt("comment_count"),
                rs.getInt("report_count"),
                rs.getBoolean("liked_by_me"),
                rs.getBoolean("reported_by_me"),
                viewerId != null && viewerId.equals(authorId),
                List.of(),
                deserializeSharedPosition(rs.getString("shared_position_json")),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant()
        );
    }

    private CommunityCommentResponse mapComment(ResultSet rs, Long viewerId) throws SQLException {
        long authorId = rs.getLong("member_id");
        String nickname = rs.getString("member_nickname");
        String memberStatus = rs.getString("member_status");
        boolean authorWithdrawn = isMaskedAuthorStatus(memberStatus, nickname);
        String displayNickname = authorWithdrawn ? WITHDRAWN_AUTHOR_NICKNAME : nickname;
        String displayProfileImgUrl = authorWithdrawn ? null : s3.sanitizeProfileImageUrl(rs.getString("member_profile_img_url"));

        long parentRaw = rs.getLong("parent_comment_id");
        Long parentCommentId = rs.wasNull() ? null : parentRaw;

        long targetCommentRaw = rs.getLong("target_comment_id");
        Long targetCommentId = rs.wasNull() ? null : targetCommentRaw;

        long targetMemberRaw = rs.getLong("target_member_id");
        Long targetMemberId = rs.wasNull() ? null : targetMemberRaw;

        String targetNickname = null;
        if (targetMemberId != null) {
            String rawTargetNick = rs.getString("target_member_nickname");
            String rawTargetStatus = rs.getString("target_member_status");
            boolean targetWithdrawn = isMaskedAuthorStatus(rawTargetStatus, rawTargetNick);
            targetNickname = targetWithdrawn ? WITHDRAWN_AUTHOR_NICKNAME : rawTargetNick;
        }

        String commentStatus = rs.getString("comment_status");
        boolean deleted = !"ACTIVE".equals(commentStatus);
        String content = deleted ? DELETED_COMMENT_MASK : rs.getString("content");

        return new CommunityCommentResponse(
                rs.getLong("id"),
                rs.getLong("post_id"),
                authorId,
                displayNickname,
                displayProfileImgUrl,
                authorWithdrawn,
                parentCommentId,
                targetCommentId,
                targetMemberId,
                targetNickname,
                content,
                rs.getInt("like_count"),
                rs.getInt("report_count"),
                rs.getBoolean("liked_by_me"),
                rs.getBoolean("reported_by_me"),
                viewerId != null && viewerId.equals(authorId),
                deleted,
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant()
        );
    }

    private MemberCommunityCommentItem mapMemberCommentItem(ResultSet rs, Long viewerId) throws SQLException {
        long authorId = rs.getLong("member_id");
        String nickname = rs.getString("member_nickname");
        String memberStatus = rs.getString("member_status");
        boolean authorWithdrawn = isMaskedAuthorStatus(memberStatus, nickname);
        String displayNickname = authorWithdrawn ? WITHDRAWN_AUTHOR_NICKNAME : nickname;
        String displayProfileImgUrl = authorWithdrawn ? null : s3.sanitizeProfileImageUrl(rs.getString("member_profile_img_url"));

        long parentRaw = rs.getLong("parent_comment_id");
        Long parentCommentId = rs.wasNull() ? null : parentRaw;

        long targetCommentRaw = rs.getLong("target_comment_id");
        Long targetCommentId = rs.wasNull() ? null : targetCommentRaw;

        long targetMemberRaw = rs.getLong("target_member_id");
        Long targetMemberId = rs.wasNull() ? null : targetMemberRaw;

        String targetNickname = null;
        if (targetMemberId != null) {
            String rawTargetNick = rs.getString("target_member_nickname");
            String rawTargetStatus = rs.getString("target_member_status");
            boolean targetWithdrawn = isMaskedAuthorStatus(rawTargetStatus, rawTargetNick);
            targetNickname = targetWithdrawn ? WITHDRAWN_AUTHOR_NICKNAME : rawTargetNick;
        }

        return new MemberCommunityCommentItem(
                rs.getLong("id"),
                rs.getLong("post_id"),
                rs.getString("post_title"),
                rs.getString("post_category"),
                rs.getString("post_symbol_tag"),
                authorId,
                displayNickname,
                displayProfileImgUrl,
                authorWithdrawn,
                parentCommentId,
                targetCommentId,
                targetMemberId,
                targetNickname,
                rs.getString("content"),
                rs.getInt("like_count"),
                rs.getInt("report_count"),
                rs.getBoolean("liked_by_me"),
                rs.getBoolean("reported_by_me"),
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
            String sharedPositionJson,
            String status
    ) { }

    private record OwnerStatus(Long memberId, String status) { }

    private record CommentNodeRow(Long id, Long memberId, Long parentCommentId, String status) { }

    private record CommentOwnerStatus(Long postId, Long memberId, String status) { }

    private record CommentOwnerHierarchy(Long postId, Long memberId, Long parentCommentId, String status) { }

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
