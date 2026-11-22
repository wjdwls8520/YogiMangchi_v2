package com.yogimangchi.content.notification;

import com.yogimangchi.content.auth.security.ContentEndpointRateLimiter;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/v1/notifications")
@SecurityRequirement(name = "memberBearer")
public class ContentNotificationController {
    private final ContentNotificationService notifications;
    private final ContentEndpointRateLimiter rateLimiter;

    public ContentNotificationController(ContentNotificationService notifications) {
        this(notifications, null);
    }

    @Autowired
    public ContentNotificationController(
            ContentNotificationService notifications,
            @Autowired(required = false) ContentEndpointRateLimiter rateLimiter) {
        this.notifications = notifications;
        this.rateLimiter = rateLimiter;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List member community, follow, moderation, and support notifications", description = "Cursor-paginated member notifications owned by Content Server. Allowed for ACTIVE and SUSPENDED members.")
    public ResponseEntity<ContentNotificationService.NotificationPageResponse> listNotifications(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) Boolean read) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(notifications.listNotifications(Long.valueOf(jwt.getSubject()), cursorId, size, category, read));
    }

    @GetMapping(value = "/status", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Get member notification badge status", description = "Returns newCount (after last check) and unreadCount.")
    public ResponseEntity<ContentNotificationService.NotificationStatusResponse> getStatus(
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(notifications.getStatus(Long.valueOf(jwt.getSubject())));
    }

    @GetMapping(value = "/subscribe", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(summary = "Subscribe to real-time Content notification SSE stream", description = "Emits CONNECTED, STATUS, and real-time notifications. Supports Last-Event-ID replay. Max 5 concurrent SSE connections per IP.")
    public SseEmitter subscribe(
            @AuthenticationPrincipal Jwt jwt,
            @RequestHeader(value = "Last-Event-ID", required = false) String lastEventId,
            HttpServletRequest request) {
        Runnable release = rateLimiter != null
                ? rateLimiter.acquireSseSlot(request != null ? request.getRemoteAddr() : "unknown")
                : null;
        try {
            SseEmitter emitter = notifications.subscribe(Long.valueOf(jwt.getSubject()), lastEventId);
            if (rateLimiter != null && release != null) {
                rateLimiter.bindSseRelease(emitter, release);
            }
            return emitter;
        } catch (RuntimeException ex) {
            if (release != null) {
                release.run();
            }
            throw ex;
        }
    }

    @PutMapping("/check")
    @Operation(summary = "Mark notifications as checked (resets bell newCount)", description = "Advances last_checked_notification_id and closes open like grouping windows.")
    public ResponseEntity<Void> checkNotifications(@AuthenticationPrincipal Jwt jwt) {
        notifications.checkNotifications(Long.valueOf(jwt.getSubject()));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PutMapping("/{notificationId:[0-9]+}/read")
    @Operation(summary = "Mark a single notification as read")
    public ResponseEntity<Void> markAsRead(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long notificationId) {
        notifications.markAsRead(Long.valueOf(jwt.getSubject()), notificationId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PutMapping(value = "/read", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Mark selected notifications as read")
    public ResponseEntity<Void> markSelectedAsRead(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) ContentNotificationService.NotificationIdsRequest body) {
        notifications.markSelectedAsRead(Long.valueOf(jwt.getSubject()), body);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PutMapping("/read-all")
    @Operation(summary = "Mark all notifications as read")
    public ResponseEntity<Void> markAllAsRead(@AuthenticationPrincipal Jwt jwt) {
        notifications.markAllAsRead(Long.valueOf(jwt.getSubject()));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @DeleteMapping("/read")
    @Operation(summary = "Delete ALL read notifications for the authenticated member regardless of lastCheckedId")
    public ResponseEntity<Void> deleteReadNotifications(@AuthenticationPrincipal Jwt jwt) {
        notifications.deleteReadNotifications(Long.valueOf(jwt.getSubject()));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @DeleteMapping("/{notificationId:[0-9]+}")
    @Operation(summary = "Delete a single notification")
    public ResponseEntity<Void> deleteNotification(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long notificationId) {
        notifications.deleteNotification(Long.valueOf(jwt.getSubject()), notificationId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @DeleteMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Delete selected notifications")
    public ResponseEntity<Void> deleteSelectedNotifications(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) ContentNotificationService.NotificationIdsRequest body) {
        notifications.deleteNotifications(Long.valueOf(jwt.getSubject()), body);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
