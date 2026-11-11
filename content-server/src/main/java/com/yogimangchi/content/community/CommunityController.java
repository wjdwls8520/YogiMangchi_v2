package com.yogimangchi.content.community;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class CommunityController {
    private final CommunityService community;
    private final CommunityUxSseService uxSse;
    private final CommunityS3Service s3;

    public CommunityController(CommunityService community, CommunityUxSseService uxSse, CommunityS3Service s3) {
        this.community = community;
        this.uxSse = uxSse;
        this.s3 = s3;
    }

    @GetMapping("/api/v1/community/local-media/{*mediaKey}")
    @Operation(summary = "Serve local media in zero-billing local storage mode", description = "Public read-only local image endpoint when external S3 is disabled.")
    public ResponseEntity<byte[]> readLocalMedia(@PathVariable String mediaKey) {
        CommunityS3Service.LocalMediaPayload payload = s3.readLocalMedia(mediaKey);
        if (payload == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(payload.contentType()))
                .cacheControl(CacheControl.noCache())
                .body(payload.bytes());
    }

    @GetMapping(value = "/api/v1/community/posts", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            summary = "List active community posts",
            description = "Public. Supports sort=LATEST|POPULAR|ALL|BEST. Optional member Bearer sets likedByMe, reportedByMe and mine flags."
    )
    public ResponseEntity<CommunityService.CommunityPostPageResponse> listPosts(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String symbolTag,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listPosts(category, sort, symbolTag, keyword, cursorId, size, viewerId(jwt)));
    }

    @GetMapping(value = "/api/v1/community/posts/latest-check", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            summary = "Check new community posts since a post ID",
            description = "Public lightweight check returning newPostCount, latestPostId and up to 5 latest items."
    )
    public ResponseEntity<CommunityService.LatestPostsCheckResponse> checkLatestPosts(
            @RequestParam(required = false) Long sincePostId,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String symbolTag,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.checkLatestPosts(sincePostId, category, symbolTag, viewerId(jwt)));
    }

    @GetMapping(value = "/api/v1/community/ux/subscribe/feed", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(
            summary = "Subscribe to real-time community new post UX SSE stream",
            description = "Public SSE stream emitting CONNECTED and UX_COMMUNITY_POST_CREATED events after post creation commit."
    )
    public SseEmitter subscribeFeed() {
        return uxSse.subscribeFeed();
    }

    @GetMapping(value = "/api/v1/community/posts/{postId:[0-9]+}", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Read a single active community post", description = "Public. Optional member Bearer sets likedByMe, reportedByMe and mine flags.")
    public ResponseEntity<CommunityService.CommunityPostResponse> getPost(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.getPost(postId, viewerId(jwt)));
    }

    @PostMapping(value = "/api/v1/community/posts", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Create a community post (JSON)", description = "Active member Bearer required.")
    public ResponseEntity<CommunityService.CommunityPostResponse> createPostJson(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) CommunityService.CreatePostRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(community.createPost(Long.valueOf(jwt.getSubject()), body, List.of()));
    }

    @PostMapping(value = "/api/v1/community/posts", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Create a community post with image attachments (Multipart)", description = "Active member Bearer required. Supports up to 10 images (JPG/JPEG/PNG/WEBP <=5MB, GIF <=3MB) and optional sharedPosition JSON.")
    public ResponseEntity<CommunityService.CommunityPostResponse> createPostMultipart(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String symbolTag,
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String content,
            @RequestParam(required = false) String sharedPosition,
            @RequestPart(name = "request", required = false) CommunityService.CreatePostRequest requestPart,
            @RequestPart(name = "files", required = false) List<MultipartFile> files) {
        CommunityService.CreatePostRequest effective = requestPart != null
                ? requestPart
                : new CommunityService.CreatePostRequest(
                        category,
                        symbolTag,
                        title,
                        content,
                        community.parseSharedPositionJson(sharedPosition));
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(community.createPost(Long.valueOf(jwt.getSubject()), effective, files));
    }

    @PatchMapping(value = "/api/v1/community/posts/{postId:[0-9]+}", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @PutMapping(value = "/api/v1/community/posts/{postId:[0-9]+}", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Update own community post (JSON)", description = "Post owner Bearer required.")
    public ResponseEntity<CommunityService.CommunityPostResponse> updatePostJson(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) CommunityService.UpdatePostRequest body) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.updatePost(Long.valueOf(jwt.getSubject()), postId, body, List.of()));
    }

    @PatchMapping(value = "/api/v1/community/posts/{postId:[0-9]+}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @PutMapping(value = "/api/v1/community/posts/{postId:[0-9]+}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Update own community post with image attachments (Multipart)", description = "Post owner Bearer required. Supports deleteFileIds, clearSharedPosition, and new image files.")
    public ResponseEntity<CommunityService.CommunityPostResponse> updatePostMultipart(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String symbolTag,
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String content,
            @RequestParam(required = false) String sharedPosition,
            @RequestParam(required = false) Boolean clearSharedPosition,
            @RequestParam(required = false) List<Long> deleteFileIds,
            @RequestPart(name = "request", required = false) CommunityService.UpdatePostRequest requestPart,
            @RequestPart(name = "files", required = false) List<MultipartFile> files) {
        boolean explicitClear = Boolean.TRUE.equals(clearSharedPosition)
                || (sharedPosition != null && (sharedPosition.isBlank() || "null".equalsIgnoreCase(sharedPosition.strip())));
        CommunityService.UpdatePostRequest effective = requestPart != null
                ? requestPart
                : new CommunityService.UpdatePostRequest(
                        category,
                        symbolTag,
                        title,
                        content,
                        explicitClear ? null : community.parseSharedPositionJson(sharedPosition),
                        deleteFileIds,
                        explicitClear ? Boolean.TRUE : null);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.updatePost(Long.valueOf(jwt.getSubject()), postId, effective, files));
    }

    @DeleteMapping(value = "/api/v1/community/posts/{postId:[0-9]+}", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Soft-delete own community post", description = "Post owner Bearer required. Idempotent.")
    public ResponseEntity<Void> deletePost(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt) {
        community.deletePost(Long.valueOf(jwt.getSubject()), postId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PutMapping(value = "/api/v1/community/posts/{postId:[0-9]+}/likes", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Like an active community post", description = "Active member Bearer required. Idempotent.")
    public ResponseEntity<CommunityService.PostLikeResponse> likePost(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.changeLike(Long.valueOf(jwt.getSubject()), postId, true));
    }

    @DeleteMapping(value = "/api/v1/community/posts/{postId:[0-9]+}/likes", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Unlike an active community post", description = "Active member Bearer required. Idempotent.")
    public ResponseEntity<CommunityService.PostLikeResponse> unlikePost(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.changeLike(Long.valueOf(jwt.getSubject()), postId, false));
    }

    @GetMapping(value = {"/api/v1/community/report-reasons", "/api/v1/report/type/community"}, produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List community report reason codes and descriptions", description = "Public.")
    public ResponseEntity<List<CommunityService.ReportReasonResponse>> listReportReasons() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listReportReasons());
    }

    @PutMapping(value = "/api/v1/community/posts/{postId:[0-9]+}/reports", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Report an active community post", description = "Active member Bearer required. Cannot report own post. Idempotent.")
    public ResponseEntity<CommunityService.ReportResponse> reportPost(
            @PathVariable Long postId,
            @RequestParam(required = false) String reasonType,
            @RequestBody(required = false) CommunityService.ReportRequest body,
            @AuthenticationPrincipal Jwt jwt) {
        String effectiveReason = resolveReasonType(reasonType, body);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.changePostReport(Long.valueOf(jwt.getSubject()), postId, effectiveReason, true));
    }

    @DeleteMapping(value = "/api/v1/community/posts/{postId:[0-9]+}/reports", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Cancel own report on a community post", description = "Active member Bearer required. Idempotent.")
    public ResponseEntity<CommunityService.ReportResponse> unreportPost(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.changePostReport(Long.valueOf(jwt.getSubject()), postId, null, false));
    }

    @GetMapping(value = "/api/v1/community/posts/{postId:[0-9]+}/comments", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(
            summary = "List comments for a community post",
            description = "Public. Cursor-paginated by root comment ID (cursorId, size). Preserves deleted parent comments as masked nodes when active child replies exist."
    )
    public ResponseEntity<CommunityService.CommunityCommentListResponse> listComments(
            @PathVariable Long postId,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listComments(postId, cursorId, size, viewerId(jwt)));
    }

    @GetMapping(value = "/api/v1/members/{memberId:[0-9]+}/community/posts", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List active community posts authored by a member (cursor-paginated)", description = "Public.")
    public ResponseEntity<CommunityService.CommunityPostPageResponse> listMemberPosts(
            @PathVariable Long memberId,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listMemberPosts(memberId, cursorId, size, viewerId(jwt)));
    }

    @GetMapping(value = "/api/v1/members/me/community/posts", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "List own active community posts (cursor-paginated)", description = "Active member Bearer required.")
    public ResponseEntity<CommunityService.CommunityPostPageResponse> listMyPosts(
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        Long me = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listMemberPosts(me, cursorId, size, me));
    }

    @GetMapping(value = "/api/v1/members/{memberId:[0-9]+}/community/comments", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List active community comments authored by a member (cursor-paginated)", description = "Public.")
    public ResponseEntity<CommunityService.MemberCommunityCommentPageResponse> listMemberComments(
            @PathVariable Long memberId,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listMemberComments(memberId, cursorId, size, viewerId(jwt)));
    }

    @GetMapping(value = "/api/v1/members/me/community/comments", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "List own active community comments (cursor-paginated)", description = "Active member Bearer required.")
    public ResponseEntity<CommunityService.MemberCommunityCommentPageResponse> listMyComments(
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        Long me = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listMemberComments(me, cursorId, size, me));
    }

    @GetMapping(value = "/api/v1/members/{memberId:[0-9]+}/community/liked-posts", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List active community posts liked by a member (cursor-paginated)", description = "Public.")
    public ResponseEntity<CommunityService.CommunityPostPageResponse> listMemberLikedPosts(
            @PathVariable Long memberId,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listMemberLikedPosts(memberId, cursorId, size, viewerId(jwt)));
    }

    @GetMapping(value = "/api/v1/members/me/community/liked-posts", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "List own liked active community posts (cursor-paginated)", description = "Active member Bearer required.")
    public ResponseEntity<CommunityService.CommunityPostPageResponse> listMyLikedPosts(
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        Long me = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listMemberLikedPosts(me, cursorId, size, me));
    }

    @GetMapping(value = "/api/v1/members/{memberId:[0-9]+}/community/liked-comments", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List active community comments liked by a member (cursor-paginated)", description = "Public.")
    public ResponseEntity<CommunityService.MemberCommunityCommentPageResponse> listMemberLikedComments(
            @PathVariable Long memberId,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listMemberLikedComments(memberId, cursorId, size, viewerId(jwt)));
    }

    @GetMapping(value = "/api/v1/members/me/community/liked-comments", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "List own liked active community comments (cursor-paginated)", description = "Active member Bearer required.")
    public ResponseEntity<CommunityService.MemberCommunityCommentPageResponse> listMyLikedComments(
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        Long me = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listMemberLikedComments(me, cursorId, size, me));
    }

    @GetMapping(value = "/api/v1/members/me/community/reports", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "List own submitted community post/comment reports (owner-only, cursor-paginated)", description = "Active member Bearer required.")
    public ResponseEntity<CommunityService.MemberCommunityReportPageResponse> listMyReports(
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listMyReports(Long.valueOf(jwt.getSubject()), cursorId, size));
    }

    @PostMapping(value = "/api/v1/community/posts/{postId:[0-9]+}/comments", produces = MediaType.APPLICATION_JSON_VALUE)
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Create a comment or reply on a community post", description = "Active member Bearer required.")
    public ResponseEntity<CommunityService.CommunityCommentResponse> createComment(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) CommunityService.CreateCommentRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(community.createComment(Long.valueOf(jwt.getSubject()), postId, body));
    }

    @PatchMapping(
            value = {"/api/v1/community/comments/{commentId:[0-9]+}", "/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}"},
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Update own active comment", description = "Comment owner Bearer required.")
    public ResponseEntity<CommunityService.CommunityCommentResponse> updateComment(
            @PathVariable Long commentId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) CommunityService.UpdateCommentRequest body) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.updateComment(Long.valueOf(jwt.getSubject()), commentId, body));
    }

    @DeleteMapping(
            value = {"/api/v1/community/comments/{commentId:[0-9]+}", "/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}"},
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Soft-delete own comment", description = "Comment owner Bearer required. Idempotent.")
    public ResponseEntity<Void> deleteComment(
            @PathVariable Long commentId,
            @AuthenticationPrincipal Jwt jwt) {
        community.deleteComment(Long.valueOf(jwt.getSubject()), commentId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PutMapping(
            value = {"/api/v1/community/comments/{commentId:[0-9]+}/likes", "/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}/likes"},
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Like an active comment", description = "Active member Bearer required. Idempotent.")
    public ResponseEntity<CommunityService.CommentLikeResponse> likeComment(
            @PathVariable Long commentId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.changeCommentLike(Long.valueOf(jwt.getSubject()), commentId, true));
    }

    @DeleteMapping(
            value = {"/api/v1/community/comments/{commentId:[0-9]+}/likes", "/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}/likes"},
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Unlike an active comment", description = "Active member Bearer required. Idempotent.")
    public ResponseEntity<CommunityService.CommentLikeResponse> unlikeComment(
            @PathVariable Long commentId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.changeCommentLike(Long.valueOf(jwt.getSubject()), commentId, false));
    }

    @PutMapping(
            value = {"/api/v1/community/comments/{commentId:[0-9]+}/reports", "/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}/reports"},
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Report an active comment", description = "Active member Bearer required. Cannot report own comment. Idempotent.")
    public ResponseEntity<CommunityService.ReportResponse> reportComment(
            @PathVariable Long commentId,
            @RequestParam(required = false) String reasonType,
            @RequestBody(required = false) CommunityService.ReportRequest body,
            @AuthenticationPrincipal Jwt jwt) {
        String effectiveReason = resolveReasonType(reasonType, body);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.changeCommentReport(Long.valueOf(jwt.getSubject()), commentId, effectiveReason, true));
    }

    @DeleteMapping(
            value = {"/api/v1/community/comments/{commentId:[0-9]+}/reports", "/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}/reports"},
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Cancel own report on a comment", description = "Active member Bearer required. Idempotent.")
    public ResponseEntity<CommunityService.ReportResponse> unreportComment(
            @PathVariable Long commentId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.changeCommentReport(Long.valueOf(jwt.getSubject()), commentId, null, false));
    }

    private static String resolveReasonType(String reasonTypeParam, CommunityService.ReportRequest body) {
        if (reasonTypeParam != null && !reasonTypeParam.isBlank()) {
            return reasonTypeParam;
        }
        if (body != null) {
            if (body.reasonType() != null && !body.reasonType().isBlank()) {
                return body.reasonType();
            }
            if (body.reason() != null && !body.reason().isBlank()) {
                return body.reason();
            }
        }
        return "SPAM";
    }

    private static Long viewerId(Jwt jwt) {
        return jwt == null ? null : Long.valueOf(jwt.getSubject());
    }
}
