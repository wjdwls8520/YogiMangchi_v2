package com.yogimangchi.content.notification;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class ContentNotificationService {
    private static final Logger log = LoggerFactory.getLogger(ContentNotificationService.class);

    public static final String CATEGORY_COMMUNITY = "COMMUNITY";
    public static final String CATEGORY_REPORT = "REPORT";
    public static final String CATEGORY_SUPPORT = "SUPPORT";
    public static final String TYPE_POST_COMMENT_CREATED = "POST_COMMENT_CREATED";
    public static final String TYPE_REPLY_COMMENT_CREATED = "REPLY_COMMENT_CREATED";
    public static final String TYPE_POST_LIKED = "POST_LIKED";
    public static final String TYPE_REPLY_LIKED = "REPLY_LIKED";
    public static final String TYPE_FOLLOW_CREATED = "FOLLOW_CREATED";
    public static final String TYPE_REPORT_RESOLVED = "REPORT_RESOLVED";
    public static final String TYPE_REPORT_DISMISSED = "REPORT_DISMISSED";
    public static final String TYPE_CONTENT_MODERATED = "CONTENT_MODERATED";
    public static final String TYPE_SUPPORT_INQUIRY_ANSWERED = "SUPPORT_INQUIRY_ANSWERED";

    private static final Pattern MENTION_PATTERN = Pattern.compile("(?:^|\\s)@([^\\s@]{1,32})");
    private static final int MAX_MENTIONS_PER_COMMENT = 5;
    private static final int MAX_ACTORS_PREVIEW = 3;
    private static final int PREVIEW_MAX_LENGTH = 80;

    public record NotificationItemResponse(
            Long notificationId,
            Long actorMemberId,
            String category,
            String type,
            boolean isRead,
            Instant createdAt,
            Instant lastEventAt,
            JsonNode payload
    ) { }

    public record NotificationPageResponse(
            List<NotificationItemResponse> content,
            Long nextCursorId,
            boolean hasNext
    ) { }

    public record NotificationStatusResponse(
            long newCount,
            boolean hasNew,
            long unreadCount,
            boolean hasUnread
    ) {
        public static NotificationStatusResponse of(long newCount, long unreadCount) {
            return new NotificationStatusResponse(newCount, newCount > 0, unreadCount, unreadCount > 0);
        }
    }

    public record NotificationIdsRequest(List<Long> notificationIds) { }

    public record ActorPreviewPayload(
            Long memberId,
            String nickname,
            String profileImageUrl
    ) { }

    public record ReplayEvent(
            String eventName,
            NotificationItemResponse notification
    ) { }

    private record DispatchOutcome(
            Long receiverId,
            String eventName,
            NotificationItemResponse notification,
            NotificationStatusResponse status
    ) { }

    private record ActorSnapshot(
            Long memberId,
            String nickname,
            String profileImageUrl
    ) { }

    private record GroupRow(
            Long id,
            Long notificationId,
            long groupCount
    ) { }

    private final MemberRepository members;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final CommunityS3Service s3;
    private final ContentNotificationSseService sse;
    private final TransactionTemplate requiresNewTx;

    public ContentNotificationService(
            MemberRepository members,
            JdbcTemplate jdbc,
            ObjectMapper json,
            CommunityS3Service s3,
            ContentNotificationSseService sse,
            PlatformTransactionManager txManager) {
        this.members = members;
        this.jdbc = jdbc;
        this.json = json;
        this.s3 = s3;
        this.sse = sse;
        this.requiresNewTx = new TransactionTemplate(txManager);
        this.requiresNewTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.requiresNewTx.setTimeout(5);
    }

    @Transactional(readOnly = true, timeout = 10)
    public NotificationPageResponse listNotifications(
            Long memberId,
            Long cursorId,
            Integer size,
            String category,
            Boolean read) {
        requireActiveMember(memberId);
        int limit = size == null ? 20 : size;
        if (limit < 1 || limit > 50 || (cursorId != null && cursorId <= 0)) {
            throw invalidRequest();
        }
        String normalizedCategory = category == null || category.isBlank() ? null : category.strip().toUpperCase();

        StringBuilder sql = new StringBuilder(
                "select id, actor_member_id, category, type, payload_json::text as payload_text, is_read, created_at, last_event_at "
                        + "from content.notification where receiver_member_id = ?");
        List<Object> params = new ArrayList<>();
        params.add(memberId);

        if (cursorId != null) {
            sql.append(" and id < ?");
            params.add(cursorId);
        }
        if (normalizedCategory != null) {
            if ("FOLLOW".equals(normalizedCategory)) {
                sql.append(" and type = 'FOLLOW_CREATED'");
            } else {
                sql.append(" and category = ?");
                params.add(normalizedCategory);
            }
        }
        if (read != null) {
            sql.append(" and is_read = ?");
            params.add(read);
        }
        sql.append(" order by id desc limit ?");
        params.add(limit + 1);

        List<NotificationItemResponse> rows = jdbc.query(sql.toString(), (rs, n) -> mapItem(rs), params.toArray());
        boolean hasNext = rows.size() > limit;
        List<NotificationItemResponse> page = hasNext ? rows.subList(0, limit) : rows;
        Long nextCursorId = hasNext && !page.isEmpty() ? page.get(page.size() - 1).notificationId() : null;
        return new NotificationPageResponse(page, nextCursorId, hasNext);
    }

    @Transactional(readOnly = true, timeout = 10)
    public NotificationStatusResponse getStatus(Long memberId) {
        requireActiveMember(memberId);
        return queryStatusInternal(memberId);
    }

    @Transactional(readOnly = true, timeout = 10)
    public SseEmitter subscribe(Long memberId, String lastEventIdHeader) {
        return subscribe(memberId, lastEventIdHeader, null);
    }

    @Transactional(readOnly = true, timeout = 10)
    public SseEmitter subscribe(Long memberId, String lastEventIdHeader, Runnable onRelease) {
        requireActiveMember(memberId);
        NotificationStatusResponse status = queryStatusInternal(memberId);
        List<ReplayEvent> missed = List.of();
        Long lastEventId = parseLastEventId(lastEventIdHeader);
        if (lastEventId != null && lastEventId > 0) {
            List<NotificationItemResponse> rows = jdbc.query(
                    "select id, actor_member_id, category, type, payload_json::text as payload_text, is_read, created_at, last_event_at "
                            + "from content.notification where receiver_member_id = ? and id > ? order by id asc limit 50",
                    (rs, n) -> mapItem(rs),
                    memberId,
                    lastEventId);
            missed = rows.stream()
                    .map(item -> new ReplayEvent(defaultEventNameForType(item.type()), item))
                    .toList();
        }
        return sse.subscribe(memberId, status, missed, onRelease);
    }

    @Transactional(timeout = 10)
    public void checkNotifications(Long memberId) {
        requireActiveMember(memberId);
        Long latestId = jdbc.queryForObject(
                "select max(id) from content.notification where receiver_member_id = ?",
                Long.class,
                memberId);
        if (latestId == null) {
            return;
        }
        jdbc.update(
                "insert into content.notification_state(member_id, last_checked_notification_id, updated_at) "
                        + "values (?, ?, now()) "
                        + "on conflict(member_id) do update set "
                        + "last_checked_notification_id = greatest(content.notification_state.last_checked_notification_id, excluded.last_checked_notification_id), "
                        + "updated_at = now()",
                memberId, latestId);
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 10)
    public void markAsRead(Long memberId, Long notificationId) {
        requireActiveMember(memberId);
        if (notificationId == null || notificationId <= 0) {
            throw notFound();
        }
        Boolean exists = jdbc.queryForObject(
                "select exists(select 1 from content.notification where id = ? and receiver_member_id = ?)",
                Boolean.class,
                notificationId, memberId);
        if (!Boolean.TRUE.equals(exists)) {
            throw notFound();
        }
        jdbc.update(
                "update content.notification set is_read = true, read_at = coalesce(read_at, now()) "
                        + "where id = ? and receiver_member_id = ? and is_read = false",
                notificationId, memberId);
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 10)
    public void markSelectedAsRead(Long memberId, NotificationIdsRequest body) {
        requireActiveMember(memberId);
        List<Long> ids = sanitizeIds(body);
        if (ids.isEmpty()) {
            return;
        }
        String placeholders = String.join(",", Collections.nCopies(ids.size(), "?"));
        List<Object> params = new ArrayList<>(ids.size() + 1);
        params.add(memberId);
        params.addAll(ids);
        jdbc.update(
                "update content.notification set is_read = true, read_at = coalesce(read_at, now()) "
                        + "where receiver_member_id = ? and is_read = false and id in (" + placeholders + ")",
                params.toArray());
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 10)
    public void markAllAsRead(Long memberId) {
        requireActiveMember(memberId);
        jdbc.update(
                "update content.notification set is_read = true, read_at = coalesce(read_at, now()) "
                        + "where receiver_member_id = ? and is_read = false",
                memberId);
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 10)
    public int deleteReadNotifications(Long memberId) {
        requireActiveMember(memberId);
        // Delete ALL read notifications for the member regardless of lastCheckedId
        jdbc.update(
                "delete from content.notification_group_state g "
                        + "using content.notification n "
                        + "where g.notification_id = n.id and g.receiver_member_id = ? and n.is_read = true",
                memberId);
        int deleted = jdbc.update(
                "delete from content.notification where receiver_member_id = ? and is_read = true",
                memberId);
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
        return deleted;
    }

    @Transactional(timeout = 10)
    public void deleteNotification(Long memberId, Long notificationId) {
        requireActiveMember(memberId);
        if (notificationId == null || notificationId <= 0) {
            throw notFound();
        }
        jdbc.update(
                "delete from content.notification_group_state where notification_id = ? and receiver_member_id = ?",
                notificationId, memberId);
        int deleted = jdbc.update(
                "delete from content.notification where id = ? and receiver_member_id = ?",
                notificationId, memberId);
        if (deleted == 0) {
            throw notFound();
        }
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 10)
    public void deleteNotifications(Long memberId, NotificationIdsRequest body) {
        requireActiveMember(memberId);
        List<Long> ids = sanitizeIds(body);
        if (ids.isEmpty()) {
            return;
        }
        String placeholders = String.join(",", Collections.nCopies(ids.size(), "?"));
        List<Object> params = new ArrayList<>(ids.size() + 1);
        params.add(memberId);
        params.addAll(ids);
        jdbc.update(
                "delete from content.notification_group_state where receiver_member_id = ? and notification_id in (" + placeholders + ")",
                params.toArray());
        jdbc.update(
                "delete from content.notification where receiver_member_id = ? and id in (" + placeholders + ")",
                params.toArray());
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    public void notifyCommentCreatedAfterCommit(
            Long actorId,
            Long postId,
            Long commentId,
            Long parentCommentId,
            Long targetCommentId,
            Long targetMemberId,
            String content) {
        afterCommit(() -> {
            try {
                List<DispatchOutcome> outcomes = requiresNewTx.execute(
                        tx -> dispatchCommentCreatedInNewTx(actorId, postId, commentId, parentCommentId, targetCommentId, targetMemberId, content));
                if (outcomes != null) {
                    for (DispatchOutcome outcome : outcomes) {
                        sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                    }
                }
            } catch (Exception e) {
                log.warn("커뮤니티 댓글 알림 처리 실패: postId={}, commentId={}", postId, commentId, e);
            }
        });
    }

    public void notifyPostLikedAfterCommit(Long actorId, Long postId) {
        afterCommit(() -> {
            try {
                DispatchOutcome outcome = requiresNewTx.execute(tx -> dispatchPostLikedInNewTx(actorId, postId));
                if (outcome != null) {
                    sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                }
            } catch (Exception e) {
                log.warn("게시글 좋아요 알림 처리 실패: postId={}, actorId={}", postId, actorId, e);
            }
        });
    }

    public void notifyCommentLikedAfterCommit(Long actorId, Long commentId) {
        afterCommit(() -> {
            try {
                DispatchOutcome outcome = requiresNewTx.execute(tx -> dispatchCommentLikedInNewTx(actorId, commentId));
                if (outcome != null) {
                    sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                }
            } catch (Exception e) {
                log.warn("댓글 좋아요 알림 처리 실패: commentId={}, actorId={}", commentId, actorId, e);
            }
        });
    }

    public void notifyFollowCreatedAfterCommit(Long actorId, Long targetId) {
        afterCommit(() -> {
            try {
                DispatchOutcome outcome = requiresNewTx.execute(tx -> dispatchFollowCreatedInNewTx(actorId, targetId));
                if (outcome != null) {
                    sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                }
            } catch (Exception e) {
                log.warn("팔로우 알림 처리 실패: actorId={}, targetId={}", actorId, targetId, e);
            }
        });
    }

    public void notifyReportHandledAfterCommit(
            Long reporterId,
            String status,
            String targetType,
            Long targetId,
            Long postId,
            String title,
            String resolutionNote) {
        afterCommit(() -> {
            try {
                DispatchOutcome outcome = requiresNewTx.execute(
                        tx -> dispatchReportHandledInNewTx(reporterId, status, targetType, targetId, postId, title, resolutionNote));
                if (outcome != null) {
                    sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                }
            } catch (Exception e) {
                log.warn("신고 처리 알림 발송 실패: reporterId={} targetType={} targetId={} cause={}",
                        reporterId, targetType, targetId, e.getClass().getSimpleName());
            }
        });
    }

    public void notifyContentModeratedAfterCommit(
            Long targetAuthorId,
            String targetType,
            Long targetId,
            Long postId,
            String title,
            String resolutionNote) {
        afterCommit(() -> {
            try {
                DispatchOutcome outcome = requiresNewTx.execute(
                        tx -> dispatchContentModeratedInNewTx(targetAuthorId, targetType, targetId, postId, title, resolutionNote));
                if (outcome != null) {
                    sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                }
            } catch (Exception e) {
                log.warn("콘텐츠 제재 알림 발송 실패: targetAuthorId={} targetType={} targetId={} cause={}",
                        targetAuthorId, targetType, targetId, e.getClass().getSimpleName());
            }
        });
    }

    public void notifySupportInquiryAnsweredAfterCommit(
            Long memberId,
            Long inquiryId,
            String inquiryCategory,
            String title,
            String adminReply) {
        afterCommit(() -> {
            try {
                DispatchOutcome outcome = requiresNewTx.execute(
                        tx -> dispatchSupportInquiryAnsweredInNewTx(memberId, inquiryId, inquiryCategory, title, adminReply));
                if (outcome != null) {
                    sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                }
            } catch (Exception e) {
                log.warn("고객문의 답변 알림 발송 실패: memberId={} inquiryId={} cause={}",
                        memberId, inquiryId, e.getClass().getSimpleName());
            }
        });
    }

    private List<DispatchOutcome> dispatchCommentCreatedInNewTx(
            Long actorId,
            Long postId,
            Long commentId,
            Long parentCommentId,
            Long targetCommentId,
            Long targetMemberId,
            String content) {
        ActorSnapshot actor = loadActiveMemberSnapshot(actorId);
        if (actor == null) {
            return List.of();
        }

        var postRows = jdbc.query(
                "select member_id, title, status from content.community_post where id = ?",
                (rs, n) -> Map.of(
                        "memberId", rs.getLong("member_id"),
                        "title", Objects.toString(rs.getString("title"), ""),
                        "status", Objects.toString(rs.getString("status"), "")),
                postId);
        if (postRows.isEmpty() || !"ACTIVE".equals(postRows.get(0).get("status"))) {
            return List.of();
        }
        Long postAuthorId = (Long) postRows.get(0).get("memberId");
        String postTitle = (String) postRows.get(0).get("title");
        String preview = summarizeText(content, PREVIEW_MAX_LENGTH);

        List<DispatchOutcome> outcomes = new ArrayList<>();
        Set<Long> notifiedReceivers = new LinkedHashSet<>();

        if (parentCommentId == null) {
            if (postAuthorId != null && !postAuthorId.equals(actorId) && isMemberActive(postAuthorId)) {
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("postId", postId);
                payload.put("replyId", commentId);
                payload.put("postTitle", postTitle);
                payload.put("actorMemberId", actor.memberId());
                payload.put("actorNickname", actor.nickname());
                payload.put("actorProfileImageUrl", actor.profileImageUrl());
                payload.put("replyContentPreview", preview);

                NotificationItemResponse saved = insertNotification(
                        postAuthorId, actor.memberId(), CATEGORY_COMMUNITY, TYPE_POST_COMMENT_CREATED, payload);
                outcomes.add(new DispatchOutcome(
                        postAuthorId,
                        "NOTIFICATION_COMMUNITY_POST_COMMENT_CREATED",
                        saved,
                        queryStatusInternal(postAuthorId)));
                notifiedReceivers.add(postAuthorId);
            }
        } else {
            Long parentAuthorId = jdbc.query(
                    "select member_id from content.community_comment where id = ?",
                    (rs, n) -> rs.getLong("member_id"),
                    parentCommentId).stream().findFirst().orElse(null);

            Long primaryReceiverId = targetMemberId != null ? targetMemberId : parentAuthorId;
            if (primaryReceiverId != null && !primaryReceiverId.equals(actorId) && isMemberActive(primaryReceiverId)) {
                ActorSnapshot targetSnap = targetMemberId != null ? loadActiveMemberSnapshot(targetMemberId) : null;
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("postId", postId);
                payload.put("replyId", commentId);
                payload.put("parentReplyId", parentCommentId);
                payload.put("targetReplyId", targetCommentId);
                payload.put("postTitle", postTitle);
                payload.put("actorMemberId", actor.memberId());
                payload.put("actorNickname", actor.nickname());
                payload.put("actorProfileImageUrl", actor.profileImageUrl());
                payload.put("replyContentPreview", preview);
                payload.put("mentioned", targetMemberId != null);
                if (targetSnap != null) {
                    payload.put("targetMemberId", targetSnap.memberId());
                    payload.put("targetNickname", targetSnap.nickname());
                }

                NotificationItemResponse saved = insertNotification(
                        primaryReceiverId, actor.memberId(), CATEGORY_COMMUNITY, TYPE_REPLY_COMMENT_CREATED, payload);
                outcomes.add(new DispatchOutcome(
                        primaryReceiverId,
                        "NOTIFICATION_COMMUNITY_REPLY_COMMENT_CREATED",
                        saved,
                        queryStatusInternal(primaryReceiverId)));
                notifiedReceivers.add(primaryReceiverId);
            }

            if (postAuthorId != null
                    && !postAuthorId.equals(actorId)
                    && !notifiedReceivers.contains(postAuthorId)
                    && isMemberActive(postAuthorId)) {
                Map<String, Object> postAuthorPayload = new LinkedHashMap<>();
                postAuthorPayload.put("postId", postId);
                postAuthorPayload.put("replyId", commentId);
                postAuthorPayload.put("parentReplyId", parentCommentId);
                postAuthorPayload.put("targetReplyId", targetCommentId);
                postAuthorPayload.put("postTitle", postTitle);
                postAuthorPayload.put("actorMemberId", actor.memberId());
                postAuthorPayload.put("actorNickname", actor.nickname());
                postAuthorPayload.put("actorProfileImageUrl", actor.profileImageUrl());
                postAuthorPayload.put("replyContentPreview", preview);

                NotificationItemResponse saved = insertNotification(
                        postAuthorId, actor.memberId(), CATEGORY_COMMUNITY, TYPE_POST_COMMENT_CREATED, postAuthorPayload);
                outcomes.add(new DispatchOutcome(
                        postAuthorId,
                        "NOTIFICATION_COMMUNITY_POST_COMMENT_CREATED",
                        saved,
                        queryStatusInternal(postAuthorId)));
                notifiedReceivers.add(postAuthorId);
            }
        }

        // Parse explicit @닉네임 mentions in comment text
        Set<String> mentionedNicknames = extractMentionedNicknames(content);
        for (String mentionedNick : mentionedNicknames) {
            ActorSnapshot mentionedMember = findActiveMemberByNickname(mentionedNick);
            if (mentionedMember == null
                    || mentionedMember.memberId().equals(actorId)
                    || notifiedReceivers.contains(mentionedMember.memberId())) {
                continue;
            }
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("postId", postId);
            payload.put("replyId", commentId);
            payload.put("parentReplyId", parentCommentId);
            payload.put("targetReplyId", targetCommentId);
            payload.put("postTitle", postTitle);
            payload.put("actorMemberId", actor.memberId());
            payload.put("actorNickname", actor.nickname());
            payload.put("actorProfileImageUrl", actor.profileImageUrl());
            payload.put("targetMemberId", mentionedMember.memberId());
            payload.put("targetNickname", mentionedMember.nickname());
            payload.put("mentioned", true);
            payload.put("replyContentPreview", preview);

            NotificationItemResponse saved = insertNotification(
                    mentionedMember.memberId(),
                    actor.memberId(),
                    CATEGORY_COMMUNITY,
                    TYPE_REPLY_COMMENT_CREATED,
                    payload);
            outcomes.add(new DispatchOutcome(
                    mentionedMember.memberId(),
                    "NOTIFICATION_COMMUNITY_REPLY_COMMENT_CREATED",
                    saved,
                    queryStatusInternal(mentionedMember.memberId())));
            notifiedReceivers.add(mentionedMember.memberId());
        }

        return outcomes;
    }

    private DispatchOutcome dispatchPostLikedInNewTx(Long actorId, Long postId) {
        ActorSnapshot actor = loadActiveMemberSnapshot(actorId);
        if (actor == null) {
            return null;
        }
        var postRows = jdbc.query(
                "select member_id, title, status from content.community_post where id = ?",
                (rs, n) -> Map.of(
                        "memberId", rs.getLong("member_id"),
                        "title", Objects.toString(rs.getString("title"), ""),
                        "status", Objects.toString(rs.getString("status"), "")),
                postId);
        if (postRows.isEmpty() || !"ACTIVE".equals(postRows.get(0).get("status"))) {
            return null;
        }
        Long receiverId = (Long) postRows.get(0).get("memberId");
        String postTitle = (String) postRows.get(0).get("title");
        if (receiverId == null || receiverId.equals(actorId) || !isMemberActive(receiverId)) {
            return null;
        }

        return upsertGroupedLikeNotification(
                actor,
                receiverId,
                TYPE_POST_LIKED,
                "POST",
                postId,
                postId,
                null,
                postTitle,
                null,
                "NOTIFICATION_COMMUNITY_POST_LIKED_CREATED",
                "NOTIFICATION_COMMUNITY_POST_LIKED_UPDATED");
    }

    private DispatchOutcome dispatchCommentLikedInNewTx(Long actorId, Long commentId) {
        ActorSnapshot actor = loadActiveMemberSnapshot(actorId);
        if (actor == null) {
            return null;
        }
        var rows = jdbc.query(
                "select c.member_id, c.post_id, c.content, c.status, p.title as post_title, p.status as post_status "
                        + "from content.community_comment c "
                        + "join content.community_post p on p.id = c.post_id "
                        + "where c.id = ?",
                (rs, n) -> Map.of(
                        "memberId", rs.getLong("member_id"),
                        "postId", rs.getLong("post_id"),
                        "content", Objects.toString(rs.getString("content"), ""),
                        "status", Objects.toString(rs.getString("status"), ""),
                        "postTitle", Objects.toString(rs.getString("post_title"), ""),
                        "postStatus", Objects.toString(rs.getString("post_status"), "")),
                commentId);
        if (rows.isEmpty()
                || !"ACTIVE".equals(rows.get(0).get("status"))
                || !"ACTIVE".equals(rows.get(0).get("postStatus"))) {
            return null;
        }
        Long receiverId = (Long) rows.get(0).get("memberId");
        Long postId = (Long) rows.get(0).get("postId");
        String postTitle = (String) rows.get(0).get("postTitle");
        String replyPreview = summarizeText((String) rows.get(0).get("content"), PREVIEW_MAX_LENGTH);
        if (receiverId == null || receiverId.equals(actorId) || !isMemberActive(receiverId)) {
            return null;
        }

        return upsertGroupedLikeNotification(
                actor,
                receiverId,
                TYPE_REPLY_LIKED,
                "COMMENT",
                commentId,
                postId,
                commentId,
                postTitle,
                replyPreview,
                "NOTIFICATION_COMMUNITY_REPLY_LIKED_CREATED",
                "NOTIFICATION_COMMUNITY_REPLY_LIKED_UPDATED");
    }

    private DispatchOutcome upsertGroupedLikeNotification(
            ActorSnapshot actor,
            Long receiverId,
            String notificationType,
            String targetType,
            Long targetId,
            Long postId,
            Long replyId,
            String postTitle,
            String replyContentPreview,
            String createdEventName,
            String updatedEventName) {
        // Lock receiver member row to serialize concurrent likes and check boundaries cleanly
        jdbc.queryForList("select id from content.member where id = ? for update", Long.class, receiverId);

        int insertedDedupe = jdbc.update(
                "insert into content.notification_dedupe_state("
                        + "notification_type, actor_member_id, receiver_member_id, target_type, target_id, first_notified_at, last_notified_at"
                        + ") values (?, ?, ?, ?, ?, now(), now()) "
                        + "on conflict (notification_type, actor_member_id, receiver_member_id, target_type, target_id) do nothing",
                notificationType, actor.memberId(), receiverId, targetType, targetId);
        if (insertedDedupe == 0) {
            return null;
        }

        Long lastCheckedId = queryLastCheckedId(receiverId);
        List<GroupRow> existingGroupRows = jdbc.query(
                "select id, notification_id, group_count from content.notification_group_state "
                        + "where receiver_member_id = ? and notification_type = ? and target_type = ? and target_id = ? for update",
                (rs, n) -> new GroupRow(rs.getLong("id"), rs.getLong("notification_id"), rs.getLong("group_count")),
                receiverId, notificationType, targetType, targetId);

        ActorPreviewPayload currentActorPreview = new ActorPreviewPayload(
                actor.memberId(), actor.nickname(), actor.profileImageUrl());

        if (!existingGroupRows.isEmpty()) {
            GroupRow group = existingGroupRows.get(0);
            boolean uncheckedGroupOpen = lastCheckedId == null || group.notificationId() > lastCheckedId;
            if (uncheckedGroupOpen) {
                List<String> existingPayloadRows = jdbc.query(
                        "select payload_json::text from content.notification where id = ? and receiver_member_id = ? for update",
                        (rs, n) -> rs.getString(1),
                        group.notificationId(), receiverId);
                if (!existingPayloadRows.isEmpty()) {
                    long nextCount = group.groupCount() + 1;
                    List<ActorPreviewPayload> mergedPreview = mergeActorPreviews(currentActorPreview, existingPayloadRows.get(0));
                    Map<String, Object> updatedPayload = buildLikePayload(
                            postId, replyId, postTitle, replyContentPreview, nextCount, mergedPreview, actor);
                    String payloadJson = writeJson(updatedPayload);

                    jdbc.update(
                            "update content.notification "
                                    + "set actor_member_id = ?, payload_json = cast(? as jsonb), is_read = false, read_at = null, last_event_at = now() "
                                    + "where id = ?",
                            actor.memberId(), payloadJson, group.notificationId());
                    jdbc.update(
                            "update content.notification_group_state set group_count = ?, updated_at = now() where id = ?",
                            nextCount, group.id());

                    NotificationItemResponse updatedItem = querySingleNotification(group.notificationId());
                    return new DispatchOutcome(receiverId, updatedEventName, updatedItem, queryStatusInternal(receiverId));
                }
            }
        }

        Map<String, Object> initialPayload = buildLikePayload(
                postId, replyId, postTitle, replyContentPreview, 1L, List.of(currentActorPreview), actor);
        NotificationItemResponse createdItem = insertNotification(
                receiverId, actor.memberId(), CATEGORY_COMMUNITY, notificationType, initialPayload);

        jdbc.update(
                "insert into content.notification_group_state("
                        + "receiver_member_id, notification_type, target_type, target_id, notification_id, group_count, updated_at"
                        + ") values (?, ?, ?, ?, ?, 1, now()) "
                        + "on conflict (receiver_member_id, notification_type, target_type, target_id) "
                        + "do update set notification_id = excluded.notification_id, group_count = 1, updated_at = now()",
                receiverId, notificationType, targetType, targetId, createdItem.notificationId());

        return new DispatchOutcome(receiverId, createdEventName, createdItem, queryStatusInternal(receiverId));
    }

    private DispatchOutcome dispatchFollowCreatedInNewTx(Long actorId, Long targetId) {
        if (actorId == null || targetId == null || actorId.equals(targetId)) {
            return null;
        }
        ActorSnapshot actor = loadActiveMemberSnapshot(actorId);
        if (actor == null || !isMemberActive(targetId)) {
            return null;
        }

        int notified = jdbc.update(
                "insert into content.notification_dedupe_state("
                        + "notification_type, actor_member_id, receiver_member_id, target_type, target_id, first_notified_at, last_notified_at"
                        + ") values (?, ?, ?, 'MEMBER', ?, now(), now()) "
                        + "on conflict (notification_type, actor_member_id, receiver_member_id, target_type, target_id) "
                        + "do update set last_notified_at = excluded.last_notified_at "
                        + "where content.notification_dedupe_state.last_notified_at <= excluded.last_notified_at - interval '1 day'",
                TYPE_FOLLOW_CREATED, actorId, targetId, targetId);
        if (notified == 0) {
            return null;
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("actorMemberId", actor.memberId());
        payload.put("actorNickname", actor.nickname());
        payload.put("actorProfileImageUrl", actor.profileImageUrl());

        NotificationItemResponse created = insertNotification(
                targetId, actor.memberId(), CATEGORY_COMMUNITY, TYPE_FOLLOW_CREATED, payload);
        return new DispatchOutcome(
                targetId,
                "NOTIFICATION_COMMUNITY_FOLLOW_CREATED",
                created,
                queryStatusInternal(targetId));
    }

    private DispatchOutcome dispatchReportHandledInNewTx(
            Long reporterId,
            String status,
            String targetType,
            Long targetId,
            Long postId,
            String title,
            String resolutionNote) {
        if (reporterId == null || !isMemberActive(reporterId)) {
            return null;
        }
        boolean resolved = "RESOLVED".equalsIgnoreCase(status);
        String type = resolved ? TYPE_REPORT_RESOLVED : TYPE_REPORT_DISMISSED;
        String eventName = resolved ? "NOTIFICATION_REPORT_RESOLVED" : "NOTIFICATION_REPORT_DISMISSED";

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("targetType", targetType);
        payload.put("targetId", targetId);
        if (postId != null) {
            payload.put("postId", postId);
        }
        payload.put("title", summarizeText(title, PREVIEW_MAX_LENGTH));
        payload.put("status", resolved ? "RESOLVED" : "DISMISSED");
        if (resolutionNote != null && !resolutionNote.isBlank()) {
            payload.put("resolutionNote", summarizeText(resolutionNote, 200));
        }

        NotificationItemResponse created = insertNotification(reporterId, null, CATEGORY_REPORT, type, payload);
        return new DispatchOutcome(reporterId, eventName, created, queryStatusInternal(reporterId));
    }

    private DispatchOutcome dispatchContentModeratedInNewTx(
            Long targetAuthorId,
            String targetType,
            Long targetId,
            Long postId,
            String title,
            String resolutionNote) {
        if (targetAuthorId == null || !isMemberActive(targetAuthorId)) {
            return null;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("targetType", targetType);
        payload.put("targetId", targetId);
        if (postId != null) {
            payload.put("postId", postId);
        }
        payload.put("title", summarizeText(title, PREVIEW_MAX_LENGTH));
        if (resolutionNote != null && !resolutionNote.isBlank()) {
            payload.put("resolutionNote", summarizeText(resolutionNote, 200));
        }

        NotificationItemResponse created = insertNotification(
                targetAuthorId, null, CATEGORY_REPORT, TYPE_CONTENT_MODERATED, payload);
        return new DispatchOutcome(
                targetAuthorId, "NOTIFICATION_CONTENT_MODERATED", created, queryStatusInternal(targetAuthorId));
    }

    private DispatchOutcome dispatchSupportInquiryAnsweredInNewTx(
            Long memberId,
            Long inquiryId,
            String inquiryCategory,
            String title,
            String adminReply) {
        if (memberId == null || !isMemberActiveOrSuspended(memberId)) {
            return null;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("inquiryId", inquiryId);
        payload.put("inquiryCategory", inquiryCategory);
        payload.put("title", summarizeText(title, PREVIEW_MAX_LENGTH));
        payload.put("replyPreview", summarizeText(adminReply, PREVIEW_MAX_LENGTH));

        NotificationItemResponse created = insertNotification(
                memberId, null, CATEGORY_SUPPORT, TYPE_SUPPORT_INQUIRY_ANSWERED, payload);
        return new DispatchOutcome(
                memberId, "NOTIFICATION_SUPPORT_INQUIRY_ANSWERED", created, queryStatusInternal(memberId));
    }

    private Map<String, Object> buildLikePayload(
            Long postId,
            Long replyId,
            String postTitle,
            String replyContentPreview,
            long groupCount,
            List<ActorPreviewPayload> actorsPreview,
            ActorSnapshot latestActor) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("postId", postId);
        if (replyId != null) {
            payload.put("replyId", replyId);
        }
        payload.put("postTitle", postTitle);
        if (replyContentPreview != null) {
            payload.put("replyContentPreview", replyContentPreview);
        }
        payload.put("actorMemberId", latestActor.memberId());
        payload.put("actorNickname", latestActor.nickname());
        payload.put("actorProfileImageUrl", latestActor.profileImageUrl());
        payload.put("groupCount", groupCount);
        payload.put("actorsPreview", actorsPreview);
        return payload;
    }

    private List<ActorPreviewPayload> mergeActorPreviews(ActorPreviewPayload current, String existingPayloadJson) {
        List<ActorPreviewPayload> merged = new ArrayList<>(MAX_ACTORS_PREVIEW);
        merged.add(current);
        try {
            JsonNode root = json.readTree(existingPayloadJson);
            JsonNode existingArr = root.get("actorsPreview");
            if (existingArr != null && existingArr.isArray()) {
                List<ActorPreviewPayload> parsed = json.convertValue(
                        existingArr, new TypeReference<List<ActorPreviewPayload>>() { });
                for (ActorPreviewPayload item : parsed) {
                    if (merged.size() >= MAX_ACTORS_PREVIEW) {
                        break;
                    }
                    if (item != null && item.memberId() != null && !item.memberId().equals(current.memberId())) {
                        merged.add(item);
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return merged;
    }

    private NotificationItemResponse insertNotification(
            Long receiverId,
            Long actorId,
            String category,
            String type,
            Object payload) {
        String payloadJson = writeJson(payload);
        Long id = jdbc.queryForObject(
                "insert into content.notification("
                        + "receiver_member_id, actor_member_id, category, type, payload_json, is_read, read_at, created_at, last_event_at"
                        + ") values (?, ?, ?, ?, cast(? as jsonb), false, null, now(), now()) returning id",
                Long.class,
                receiverId, actorId, category, type, payloadJson);
        return querySingleNotification(Objects.requireNonNull(id));
    }

    private NotificationItemResponse querySingleNotification(Long id) {
        return jdbc.queryForObject(
                "select id, actor_member_id, category, type, payload_json::text as payload_text, is_read, created_at, last_event_at "
                        + "from content.notification where id = ?",
                (rs, n) -> mapItem(rs),
                id);
    }

    private NotificationStatusResponse queryStatusInternal(Long memberId) {
        Long lastCheckedId = queryLastCheckedId(memberId);
        Long newCount = lastCheckedId == null
                ? jdbc.queryForObject(
                        "select count(*) from content.notification where receiver_member_id = ?",
                        Long.class, memberId)
                : jdbc.queryForObject(
                        "select count(*) from content.notification where receiver_member_id = ? and id > ?",
                        Long.class, memberId, lastCheckedId);
        Long unreadCount = jdbc.queryForObject(
                "select count(*) from content.notification where receiver_member_id = ? and is_read = false",
                Long.class, memberId);
        return NotificationStatusResponse.of(
                newCount == null ? 0L : newCount,
                unreadCount == null ? 0L : unreadCount);
    }

    private Long queryLastCheckedId(Long memberId) {
        return jdbc.query(
                "select last_checked_notification_id from content.notification_state where member_id = ?",
                (rs, n) -> rs.getLong(1),
                memberId).stream().findFirst().orElse(null);
    }

    private NotificationItemResponse mapItem(ResultSet rs) throws SQLException {
        long actorRaw = rs.getLong("actor_member_id");
        Long actorId = rs.wasNull() ? null : actorRaw;
        Timestamp createdTs = rs.getTimestamp("created_at");
        Timestamp lastEventTs = rs.getTimestamp("last_event_at");
        String payloadText = rs.getString("payload_text");
        JsonNode payloadNode;
        try {
            payloadNode = payloadText == null ? json.nullNode() : json.readTree(payloadText);
        } catch (JsonProcessingException e) {
            payloadNode = json.nullNode();
        }
        return new NotificationItemResponse(
                rs.getLong("id"),
                actorId,
                rs.getString("category"),
                rs.getString("type"),
                rs.getBoolean("is_read"),
                createdTs != null ? createdTs.toInstant() : Instant.now(),
                lastEventTs != null ? lastEventTs.toInstant() : Instant.now(),
                payloadNode);
    }

    private ActorSnapshot loadActiveMemberSnapshot(Long memberId) {
        if (memberId == null || memberId <= 0) {
            return null;
        }
        return jdbc.query(
                "select id, nickname, profile_img_url from content.member where id = ? and status = 'ACTIVE'",
                (rs, n) -> new ActorSnapshot(
                        rs.getLong("id"),
                        rs.getString("nickname"),
                        s3 == null ? rs.getString("profile_img_url") : s3.sanitizeProfileImageUrl(rs.getString("profile_img_url"))),
                memberId).stream().findFirst().orElse(null);
    }

    private ActorSnapshot findActiveMemberByNickname(String nickname) {
        if (nickname == null || nickname.isBlank()) {
            return null;
        }
        return jdbc.query(
                "select id, nickname, profile_img_url from content.member where lower(nickname) = lower(?) and status = 'ACTIVE' limit 1",
                (rs, n) -> new ActorSnapshot(
                        rs.getLong("id"),
                        rs.getString("nickname"),
                        s3 == null ? rs.getString("profile_img_url") : s3.sanitizeProfileImageUrl(rs.getString("profile_img_url"))),
                nickname.strip()).stream().findFirst().orElse(null);
    }

    private boolean isMemberActive(Long memberId) {
        if (memberId == null || memberId <= 0) {
            return false;
        }
        Boolean active = jdbc.queryForObject(
                "select exists(select 1 from content.member where id = ? and status = 'ACTIVE')",
                Boolean.class,
                memberId);
        return Boolean.TRUE.equals(active);
    }

    private boolean isMemberActiveOrSuspended(Long memberId) {
        if (memberId == null || memberId <= 0) {
            return false;
        }
        Boolean allowed = jdbc.queryForObject(
                "select exists(select 1 from content.member where id = ? and status in ('ACTIVE', 'SUSPENDED'))",
                Boolean.class,
                memberId);
        return Boolean.TRUE.equals(allowed);
    }

    private void requireActiveMember(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw AuthFailure.unauthorized();
        }
        // Both ACTIVE and SUSPENDED members may read/manage notifications (including admin appeal replies).
        members.findById(memberId)
                .filter(m -> m.getStatus() == Member.Status.ACTIVE || m.getStatus() == Member.Status.SUSPENDED)
                .orElseThrow(AuthFailure::unauthorized);
    }

    private static Set<String> extractMentionedNicknames(String content) {
        if (content == null || content.isBlank()) {
            return Set.of();
        }
        Set<String> extracted = new LinkedHashSet<>();
        Matcher matcher = MENTION_PATTERN.matcher(content);
        while (matcher.find() && extracted.size() < MAX_MENTIONS_PER_COMMENT) {
            String candidate = matcher.group(1);
            if (candidate != null) {
                String cleaned = candidate.replaceAll("[.,!?;:)\"'\\]]+$", "").strip();
                if (!cleaned.isEmpty()) {
                    extracted.add(cleaned);
                }
            }
        }
        return extracted;
    }

    private static String summarizeText(String raw, int maxLen) {
        if (raw == null) {
            return "";
        }
        String collapsed = raw.replaceAll("\\s+", " ").strip();
        if (collapsed.length() <= maxLen) {
            return collapsed;
        }
        return collapsed.substring(0, maxLen) + "...";
    }

    private static List<Long> sanitizeIds(NotificationIdsRequest body) {
        if (body == null || body.notificationIds() == null || body.notificationIds().isEmpty()) {
            return List.of();
        }
        return body.notificationIds().stream()
                .filter(id -> id != null && id > 0)
                .distinct()
                .limit(200)
                .toList();
    }

    private static Long parseLastEventId(String header) {
        if (header == null || header.isBlank()) {
            return null;
        }
        try {
            long parsed = Long.parseLong(header.strip());
            return parsed > 0 ? parsed : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String defaultEventNameForType(String type) {
        if (type == null) {
            return "NOTIFICATION_CREATED";
        }
        return switch (type) {
            case TYPE_POST_COMMENT_CREATED -> "NOTIFICATION_COMMUNITY_POST_COMMENT_CREATED";
            case TYPE_REPLY_COMMENT_CREATED -> "NOTIFICATION_COMMUNITY_REPLY_COMMENT_CREATED";
            case TYPE_POST_LIKED -> "NOTIFICATION_COMMUNITY_POST_LIKED_CREATED";
            case TYPE_REPLY_LIKED -> "NOTIFICATION_COMMUNITY_REPLY_LIKED_CREATED";
            case TYPE_FOLLOW_CREATED -> "NOTIFICATION_COMMUNITY_FOLLOW_CREATED";
            case TYPE_REPORT_RESOLVED -> "NOTIFICATION_REPORT_RESOLVED";
            case TYPE_REPORT_DISMISSED -> "NOTIFICATION_REPORT_DISMISSED";
            case TYPE_CONTENT_MODERATED -> "NOTIFICATION_CONTENT_MODERATED";
            case TYPE_SUPPORT_INQUIRY_ANSWERED -> "NOTIFICATION_SUPPORT_INQUIRY_ANSWERED";
            default -> "NOTIFICATION_" + type;
        };
    }

    private String writeJson(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize notification payload", e);
        }
    }

    private static void afterCommit(Runnable task) {
        if (TransactionSynchronizationManager.isActualTransactionActive()
                && TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
            return;
        }
        task.run();
    }

    private static AuthFailure invalidRequest() {
        return new AuthFailure("INVALID_NOTIFICATION_REQUEST", HttpStatus.BAD_REQUEST);
    }

    private static AuthFailure notFound() {
        return new AuthFailure("NOTIFICATION_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
}
