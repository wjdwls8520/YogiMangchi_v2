package com.yogimangchi.trading.notification;

import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
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
@RequestMapping("/api/v1/trading/notifications")
@Tag(name = "Trading Notifications", description = "Member mock trading & contest notifications and SSE stream")
public class TradingNotificationController {
    private final TradingNotificationService notifications;

    public TradingNotificationController(TradingNotificationService notifications) {
        this.notifications = notifications;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "List member mock trading & contest notifications")
    public ResponseEntity<TradingNotificationService.NotificationPageResponse> listNotifications(
            @AuthenticationPrincipal TradingPrincipal principal,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) Boolean read) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(notifications.listNotifications(principal.memberId(), cursorId, size, category, read));
    }

    @GetMapping(value = "/status", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Get member trading & contest notification badge status")
    public ResponseEntity<TradingNotificationService.NotificationStatusResponse> getStatus(
            @AuthenticationPrincipal TradingPrincipal principal) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(notifications.getStatus(principal.memberId()));
    }

    @GetMapping(value = "/subscribe", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(summary = "Subscribe to real-time Trading & Contest notification SSE stream")
    public SseEmitter subscribe(
            @AuthenticationPrincipal TradingPrincipal principal,
            @RequestHeader(value = "Last-Event-ID", required = false) String lastEventId) {
        return notifications.subscribe(principal.memberId(), lastEventId);
    }

    @PutMapping("/check")
    @Operation(summary = "Mark trading & contest notifications as checked")
    public ResponseEntity<Void> checkNotifications(@AuthenticationPrincipal TradingPrincipal principal) {
        notifications.checkNotifications(principal.memberId());
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PutMapping("/{notificationId:[0-9]+}/read")
    @Operation(summary = "Mark a single trading/contest notification as read")
    public ResponseEntity<Void> markAsRead(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long notificationId) {
        notifications.markAsRead(principal.memberId(), notificationId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PutMapping(value = "/read", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Mark selected trading/contest notifications as read")
    public ResponseEntity<Void> markSelectedAsRead(
            @AuthenticationPrincipal TradingPrincipal principal,
            @RequestBody(required = false) TradingNotificationService.NotificationIdsRequest body) {
        notifications.markSelectedAsRead(principal.memberId(), body);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PutMapping("/read-all")
    @Operation(summary = "Mark all trading/contest notifications as read")
    public ResponseEntity<Void> markAllAsRead(@AuthenticationPrincipal TradingPrincipal principal) {
        notifications.markAllAsRead(principal.memberId());
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @DeleteMapping("/read")
    @Operation(summary = "Delete read & checked trading/contest notifications")
    public ResponseEntity<Void> deleteReadNotifications(@AuthenticationPrincipal TradingPrincipal principal) {
        notifications.deleteReadNotifications(principal.memberId());
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @DeleteMapping("/{notificationId:[0-9]+}")
    @Operation(summary = "Delete a single trading/contest notification")
    public ResponseEntity<Void> deleteNotification(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long notificationId) {
        notifications.deleteNotification(principal.memberId(), notificationId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @DeleteMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Delete selected trading/contest notifications")
    public ResponseEntity<Void> deleteSelectedNotifications(
            @AuthenticationPrincipal TradingPrincipal principal,
            @RequestBody(required = false) TradingNotificationService.NotificationIdsRequest body) {
        notifications.deleteNotifications(principal.memberId(), body);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
