package com.yogimangchi.content.admin;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/admin/community", produces = "application/json")
@SecurityRequirement(name = "memberBearer")
public class AdminCommunityController {

    private final AdminCommunityService adminCommunityService;

    public AdminCommunityController(AdminCommunityService adminCommunityService) {
        this.adminCommunityService = adminCommunityService;
    }

    @GetMapping("/posts")
    @Operation(summary = "List all community posts (active and soft-deleted) for admin management")
    public ResponseEntity<AdminCommunityService.AdminPostCursorResponse> listAllPosts(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false, defaultValue = "ALL") String authorStatus,
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String content,
            @RequestParam(required = false) String authorNickname,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "10") Integer size) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminCommunityService.listPosts(adminId, authorStatus, title, content, authorNickname, cursorId, size));
    }

    @GetMapping("/posts/active-author")
    @Operation(summary = "List community posts authored by active members for admin management")
    public ResponseEntity<AdminCommunityService.AdminPostCursorResponse> listActiveAuthorPosts(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String content,
            @RequestParam(required = false) String authorNickname,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "10") Integer size) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminCommunityService.listPosts(adminId, "ACTIVE", title, content, authorNickname, cursorId, size));
    }

    @GetMapping("/posts/withdrawn-author")
    @Operation(summary = "List community posts authored by withdrawn members for admin management")
    public ResponseEntity<AdminCommunityService.AdminPostCursorResponse> listWithdrawnAuthorPosts(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String content,
            @RequestParam(required = false) String authorNickname,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "10") Integer size) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminCommunityService.listPosts(adminId, "WITHDRAWN", title, content, authorNickname, cursorId, size));
    }

    @DeleteMapping("/posts/{postId:[0-9]+}")
    @Operation(summary = "Soft-delete a community post by admin")
    public ResponseEntity<Void> deletePost(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long postId) {
        Long adminId = Long.valueOf(jwt.getSubject());
        adminCommunityService.deletePost(adminId, postId);
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
    }

    @GetMapping("/replies")
    @Operation(summary = "List all community replies/comments (active and soft-deleted) for admin management")
    public ResponseEntity<AdminCommunityService.AdminReplyCursorResponse> listAllReplies(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false, defaultValue = "ALL") String authorStatus,
            @RequestParam(required = false) String postTitle,
            @RequestParam(required = false) String postContent,
            @RequestParam(required = false) String replyContent,
            @RequestParam(required = false) String authorNickname,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "10") Integer size) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminCommunityService.listReplies(
                        adminId, authorStatus, postTitle, postContent, replyContent, authorNickname, cursorId, size));
    }

    @GetMapping("/replies/active-author")
    @Operation(summary = "List community replies/comments authored by active members for admin management")
    public ResponseEntity<AdminCommunityService.AdminReplyCursorResponse> listActiveAuthorReplies(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String postTitle,
            @RequestParam(required = false) String postContent,
            @RequestParam(required = false) String replyContent,
            @RequestParam(required = false) String authorNickname,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "10") Integer size) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminCommunityService.listReplies(
                        adminId, "ACTIVE", postTitle, postContent, replyContent, authorNickname, cursorId, size));
    }

    @GetMapping("/replies/withdrawn-author")
    @Operation(summary = "List community replies/comments authored by withdrawn members for admin management")
    public ResponseEntity<AdminCommunityService.AdminReplyCursorResponse> listWithdrawnAuthorReplies(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String postTitle,
            @RequestParam(required = false) String postContent,
            @RequestParam(required = false) String replyContent,
            @RequestParam(required = false) String authorNickname,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false, defaultValue = "10") Integer size) {
        Long adminId = Long.valueOf(jwt.getSubject());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminCommunityService.listReplies(
                        adminId, "WITHDRAWN", postTitle, postContent, replyContent, authorNickname, cursorId, size));
    }

    @DeleteMapping("/replies/{replyId:[0-9]+}")
    @Operation(summary = "Soft-delete a community reply/comment by admin")
    public ResponseEntity<Void> deleteReply(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long replyId) {
        Long adminId = Long.valueOf(jwt.getSubject());
        adminCommunityService.deleteReply(adminId, replyId);
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
    }
}
