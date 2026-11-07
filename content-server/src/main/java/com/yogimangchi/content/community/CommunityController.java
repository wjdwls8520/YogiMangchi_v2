package com.yogimangchi.content.community;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/community", produces = "application/json")
public class CommunityController {
    private final CommunityService community;

    public CommunityController(CommunityService community) {
        this.community = community;
    }

    @GetMapping("/posts")
    @Operation(
            summary = "List active community posts",
            description = "Public. Optional member Bearer sets likedByMe and mine flags. Withdrawn authors display as 탈퇴한회원 with authorWithdrawn=true."
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

    @GetMapping("/posts/{postId:[0-9]+}")
    @Operation(summary = "Read a single active community post", description = "Public. Optional member Bearer sets likedByMe and mine flags.")
    public ResponseEntity<CommunityService.CommunityPostResponse> getPost(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.getPost(postId, viewerId(jwt)));
    }

    @PostMapping("/posts")
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Create a community post", description = "Active member Bearer required.")
    public ResponseEntity<CommunityService.CommunityPostResponse> createPost(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) CommunityService.CreatePostRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(community.createPost(Long.valueOf(jwt.getSubject()), body));
    }

    @PatchMapping("/posts/{postId:[0-9]+}")
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Update own community post", description = "Post owner Bearer required.")
    public ResponseEntity<CommunityService.CommunityPostResponse> updatePost(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) CommunityService.UpdatePostRequest body) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.updatePost(Long.valueOf(jwt.getSubject()), postId, body));
    }

    @DeleteMapping("/posts/{postId:[0-9]+}")
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Soft-delete own community post", description = "Post owner Bearer required. Idempotent.")
    public ResponseEntity<Void> deletePost(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt) {
        community.deletePost(Long.valueOf(jwt.getSubject()), postId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PutMapping("/posts/{postId:[0-9]+}/likes")
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Like an active community post", description = "Active member Bearer required. Idempotent.")
    public ResponseEntity<CommunityService.PostLikeResponse> likePost(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.changeLike(Long.valueOf(jwt.getSubject()), postId, true));
    }

    @DeleteMapping("/posts/{postId:[0-9]+}/likes")
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Unlike an active community post", description = "Active member Bearer required. Idempotent.")
    public ResponseEntity<CommunityService.PostLikeResponse> unlikePost(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.changeLike(Long.valueOf(jwt.getSubject()), postId, false));
    }

    @GetMapping("/posts/{postId:[0-9]+}/comments")
    @Operation(
            summary = "List active comments for a community post",
            description = "Public. Optional member Bearer sets mine flag. Withdrawn authors display as 탈퇴한회원 with authorWithdrawn=true."
    )
    public ResponseEntity<CommunityService.CommunityCommentListResponse> listComments(
            @PathVariable Long postId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(community.listComments(postId, viewerId(jwt)));
    }

    @PostMapping("/posts/{postId:[0-9]+}/comments")
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

    @DeleteMapping("/comments/{commentId:[0-9]+}")
    @SecurityRequirement(name = "memberBearer")
    @Operation(summary = "Soft-delete own comment", description = "Comment owner Bearer required. Idempotent.")
    public ResponseEntity<Void> deleteComment(
            @PathVariable Long commentId,
            @AuthenticationPrincipal Jwt jwt) {
        community.deleteComment(Long.valueOf(jwt.getSubject()), commentId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    private static Long viewerId(Jwt jwt) {
        return jwt == null ? null : Long.valueOf(jwt.getSubject());
    }
}
