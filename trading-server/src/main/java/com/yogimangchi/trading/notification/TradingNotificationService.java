package com.yogimangchi.trading.notification;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.fill.entity.Fill;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.repository.TradingAccountRepository;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
public class TradingNotificationService {
    private static final Logger log = LoggerFactory.getLogger(TradingNotificationService.class);

    public static final String CATEGORY_MOCK = "MOCK";
    public static final String CATEGORY_CONTEST = "CONTEST";

    public static final String TYPE_ORDER_COMPLETED = "ORDER_COMPLETED";
    public static final String TYPE_LIQUIDATION_COMPLETED = "LIQUIDATION_COMPLETED";
    public static final String TYPE_CONTEST_APPLICATION_APPROVED = "CONTEST_APPLICATION_APPROVED";
    public static final String TYPE_CONTEST_APPLICATION_REJECTED = "CONTEST_APPLICATION_REJECTED";
    public static final String TYPE_CONTEST_SEASON_SETTLED = "CONTEST_SEASON_SETTLED";
    public static final String TYPE_CONTEST_SEASON_CANCELED = "CONTEST_SEASON_CANCELED";

    private static final Map<String, String> SYMBOL_KOREAN_NAMES = Map.ofEntries(
            Map.entry("BTC", "비트코인"),
            Map.entry("ETH", "이더리움"),
            Map.entry("XRP", "리플"),
            Map.entry("BNB", "바이낸스코인"),
            Map.entry("SOL", "솔라나"),
            Map.entry("ADA", "에이다"),
            Map.entry("LINK", "체인링크"),
            Map.entry("AVAX", "아발란체"),
            Map.entry("SUI", "수이"),
            Map.entry("DOGE", "도지코인"),
            Map.entry("PEPE", "페페"),
            Map.entry("SHIB", "시바이누")
    );

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

    private record OrderSnapshot(
            Long orderId,
            Long accountId,
            Long positionId,
            Long symbolId,
            String side,
            String type,
            String action,
            String status,
            String reason,
            int leverage,
            BigDecimal fillPrice,
            BigDecimal fillQuantity,
            BigDecimal fillFee,
            BigDecimal fillRealizedPnl,
            Instant executedAt
    ) { }

    private record AccountOwnerRow(
            Long memberId,
            boolean guestAccount,
            String status,
            String accountType,
            Long contestSeasonId
    ) { }

    private final TradingAccountRepository accounts;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final TradingNotificationSseService sse;
    private final TransactionTemplate requiresNewTx;

    public TradingNotificationService(
            TradingAccountRepository accounts,
            JdbcTemplate jdbc,
            ObjectMapper json,
            TradingNotificationSseService sse,
            PlatformTransactionManager txManager) {
        this.accounts = accounts;
        this.jdbc = jdbc;
        this.json = json;
        this.sse = sse;
        this.requiresNewTx = new TransactionTemplate(txManager);
        this.requiresNewTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.requiresNewTx.setTimeout(10);
    }

    @Transactional(readOnly = true, timeout = 3)
    public NotificationPageResponse listNotifications(
            Long memberId,
            Long cursorId,
            Integer size,
            String category,
            Boolean read) {
        requireActiveMember(memberId);
        int limit = size == null ? 20 : size;
        if (limit < 1 || limit > 50 || (cursorId != null && cursorId <= 0)) {
            throw new BusinessException(ErrorCode.INVALID_HISTORY_REQUEST);
        }
        String normalizedCategory = category == null || category.isBlank() ? null : category.strip().toUpperCase();

        StringBuilder sql = new StringBuilder(
                "select id, actor_member_id, category, type, payload_json::text as payload_text, is_read, created_at, last_event_at "
                        + "from trading.notification where receiver_member_id = ?");
        List<Object> params = new ArrayList<>();
        params.add(memberId);

        if (cursorId != null) {
            sql.append(" and id < ?");
            params.add(cursorId);
        }
        if (normalizedCategory != null) {
            sql.append(" and category = ?");
            params.add(normalizedCategory);
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

    @Transactional(readOnly = true, timeout = 3)
    public NotificationStatusResponse getStatus(Long memberId) {
        requireActiveMember(memberId);
        return queryStatusInternal(memberId);
    }

    @Transactional(readOnly = true, timeout = 3)
    public SseEmitter subscribe(Long memberId, String lastEventIdHeader) {
        requireActiveMember(memberId);
        NotificationStatusResponse status = queryStatusInternal(memberId);
        List<ReplayEvent> missed = List.of();
        Long lastEventId = parseLastEventId(lastEventIdHeader);
        if (lastEventId != null && lastEventId > 0) {
            List<NotificationItemResponse> rows = jdbc.query(
                    "select id, actor_member_id, category, type, payload_json::text as payload_text, is_read, created_at, last_event_at "
                            + "from trading.notification where receiver_member_id = ? and id > ? order by id asc limit 50",
                    (rs, n) -> mapItem(rs),
                    memberId,
                    lastEventId);
            missed = rows.stream()
                    .map(item -> new ReplayEvent(resolveEventName(item.category(), item.type()), item))
                    .toList();
        }
        return sse.subscribe(memberId, status, missed);
    }

    @Transactional(timeout = 3)
    public void checkNotifications(Long memberId) {
        requireActiveMember(memberId);
        Long latestId = jdbc.queryForObject(
                "select max(id) from trading.notification where receiver_member_id = ?",
                Long.class,
                memberId);
        if (latestId == null) {
            return;
        }
        jdbc.update(
                "insert into trading.notification_state(member_id, last_checked_notification_id, updated_at) "
                        + "values (?, ?, now()) "
                        + "on conflict(member_id) do update set "
                        + "last_checked_notification_id = greatest(trading.notification_state.last_checked_notification_id, excluded.last_checked_notification_id), "
                        + "updated_at = now()",
                memberId, latestId);
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 3)
    public void markAsRead(Long memberId, Long notificationId) {
        requireActiveMember(memberId);
        if (notificationId == null || notificationId <= 0) {
            throw new BusinessException(ErrorCode.ORDER_NOT_FOUND);
        }
        Boolean exists = jdbc.queryForObject(
                "select exists(select 1 from trading.notification where id = ? and receiver_member_id = ?)",
                Boolean.class,
                notificationId, memberId);
        if (!Boolean.TRUE.equals(exists)) {
            throw new BusinessException(ErrorCode.ORDER_NOT_FOUND);
        }
        jdbc.update(
                "update trading.notification set is_read = true, read_at = coalesce(read_at, now()) "
                        + "where id = ? and receiver_member_id = ? and is_read = false",
                notificationId, memberId);
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 3)
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
                "update trading.notification set is_read = true, read_at = coalesce(read_at, now()) "
                        + "where receiver_member_id = ? and is_read = false and id in (" + placeholders + ")",
                params.toArray());
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 3)
    public void markAllAsRead(Long memberId) {
        requireActiveMember(memberId);
        jdbc.update(
                "update trading.notification set is_read = true, read_at = coalesce(read_at, now()) "
                        + "where receiver_member_id = ? and is_read = false",
                memberId);
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 3)
    public void deleteReadNotifications(Long memberId) {
        requireActiveMember(memberId);
        Long lastCheckedId = queryLastCheckedId(memberId);
        if (lastCheckedId == null) {
            jdbc.update(
                    "delete from trading.notification where receiver_member_id = ? and is_read = true",
                    memberId);
        } else {
            jdbc.update(
                    "delete from trading.notification where receiver_member_id = ? and is_read = true and id <= ?",
                    memberId, lastCheckedId);
        }
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 3)
    public void deleteNotification(Long memberId, Long notificationId) {
        requireActiveMember(memberId);
        if (notificationId == null || notificationId <= 0) {
            throw new BusinessException(ErrorCode.ORDER_NOT_FOUND);
        }
        int deleted = jdbc.update(
                "delete from trading.notification where id = ? and receiver_member_id = ?",
                notificationId, memberId);
        if (deleted == 0) {
            throw new BusinessException(ErrorCode.ORDER_NOT_FOUND);
        }
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    @Transactional(timeout = 3)
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
                "delete from trading.notification where receiver_member_id = ? and id in (" + placeholders + ")",
                params.toArray());
        NotificationStatusResponse updatedStatus = queryStatusInternal(memberId);
        afterCommit(() -> sse.sendStatus(memberId, updatedStatus));
    }

    public void notifyOrderEventAfterCommit(TradingOrder order, Fill fill) {
        if (order == null || fill == null || order.getStatus() != TradingOrder.Status.FILLED) {
            return;
        }
        if (order.getAction() == TradingOrder.Action.LIQUIDATE
                && "CONTEST_SETTLEMENT".equals(order.getReason())) {
            // End-of-season contest administrative settlement emits CONTEST_SEASON_SETTLED once per participant.
            return;
        }
        OrderSnapshot snapshot = new OrderSnapshot(
                order.getId(),
                order.getAccountId(),
                order.getPositionId(),
                order.getTradingSymbolId(),
                order.getSide().name(),
                order.getType().name(),
                order.getAction().name(),
                order.getStatus().name(),
                order.getReason(),
                order.getLeverage(),
                fill.getPrice(),
                fill.getQuantity(),
                fill.getFee(),
                fill.getRealizedPnl(),
                fill.getExecutedAt());

        afterCommit(() -> {
            try {
                DispatchOutcome outcome = requiresNewTx.execute(tx -> dispatchOrderSnapshotInNewTx(snapshot));
                if (outcome != null) {
                    sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                }
            } catch (Exception e) {
                log.warn("체결/청산 알림 저장 실패: orderId={}, accountId={}", snapshot.orderId(), snapshot.accountId(), e);
            }
        });
    }

    public void notifyContestApplicationApprovedAfterCommit(
            Long applicantMemberId,
            Long seasonId,
            Long applicationId,
            Instant processedAt) {
        afterCommit(() -> {
            try {
                DispatchOutcome outcome = requiresNewTx.execute(
                        tx -> dispatchContestApprovedInNewTx(applicantMemberId, seasonId, applicationId, processedAt));
                if (outcome != null) {
                    sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                }
            } catch (Exception e) {
                log.warn("대회 승인 알림 저장 실패: seasonId={}, applicationId={}", seasonId, applicationId, e);
            }
        });
    }

    public void notifyContestApplicationRejectedAfterCommit(
            Long applicantMemberId,
            Long seasonId,
            Long applicationId,
            String rejectReason,
            Instant processedAt) {
        afterCommit(() -> {
            try {
                DispatchOutcome outcome = requiresNewTx.execute(
                        tx -> dispatchContestRejectedInNewTx(applicantMemberId, seasonId, applicationId, rejectReason, processedAt));
                if (outcome != null) {
                    sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                }
            } catch (Exception e) {
                log.warn("대회 반려 알림 저장 실패: seasonId={}, applicationId={}", seasonId, applicationId, e);
            }
        });
    }

    public void notifyContestSeasonSettledAfterCommit(Long seasonId, Instant settledAt) {
        afterCommit(() -> {
            try {
                List<DispatchOutcome> outcomes = requiresNewTx.execute(
                        tx -> dispatchContestSeasonSettledInNewTx(seasonId, settledAt));
                if (outcomes != null) {
                    for (DispatchOutcome outcome : outcomes) {
                        sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                    }
                }
            } catch (Exception e) {
                log.warn("대회 종료 정산 알림 저장 실패: seasonId={}", seasonId, e);
            }
        });
    }

    public void notifyContestSeasonCanceledAfterCommit(
            Long seasonId,
            String seasonTitle,
            java.util.Collection<Long> affectedMemberIds,
            Instant canceledAt) {
        if (affectedMemberIds == null || affectedMemberIds.isEmpty()) {
            return;
        }
        List<Long> memberSnapshot = List.copyOf(new java.util.LinkedHashSet<>(affectedMemberIds));
        afterCommit(() -> {
            try {
                List<DispatchOutcome> outcomes = requiresNewTx.execute(
                        tx -> dispatchContestSeasonCanceledInNewTx(seasonId, seasonTitle, memberSnapshot, canceledAt));
                if (outcomes != null) {
                    for (DispatchOutcome outcome : outcomes) {
                        sse.sendNotification(outcome.receiverId(), outcome.eventName(), outcome.notification(), outcome.status());
                    }
                }
            } catch (Exception e) {
                log.warn("대회 취소 알림 저장 실패: seasonId={}", seasonId, e);
            }
        });
    }

    private DispatchOutcome dispatchOrderSnapshotInNewTx(OrderSnapshot snap) {
        List<AccountOwnerRow> ownerRows = jdbc.query(
                "select member_id, guest_account, status, account_type, contest_season_id from trading.trading_account where id = ?",
                (rs, n) -> {
                    long mRaw = rs.getLong("member_id");
                    Long memberId = rs.wasNull() ? null : mRaw;
                    long sRaw = rs.getLong("contest_season_id");
                    Long seasonId = rs.wasNull() ? null : sRaw;
                    return new AccountOwnerRow(
                            memberId,
                            rs.getBoolean("guest_account"),
                            rs.getString("status"),
                            rs.getString("account_type"),
                            seasonId);
                },
                snap.accountId());
        if (ownerRows.isEmpty()) {
            return null;
        }
        AccountOwnerRow owner = ownerRows.get(0);
        if (owner.guestAccount() || owner.memberId() == null || "WITHDRAWN".equals(owner.status())) {
            return null;
        }
        if (accounts.existsByMemberIdAndStatus(owner.memberId(), TradingAccount.Status.WITHDRAWN)) {
            return null;
        }

        var symRows = jdbc.query(
                "select symbol, name from trading.trading_symbol where id = ?",
                (rs, n) -> Map.of("symbol", rs.getString("symbol"), "name", rs.getString("name")),
                snap.symbolId());
        String baseSymbol = symRows.isEmpty() ? "UNKNOWN" : symRows.get(0).get("symbol");
        String symbolPair = baseSymbol.endsWith("USDT") ? baseSymbol : (baseSymbol + "USDT");
        String displayNameKr = SYMBOL_KOREAN_NAMES.getOrDefault(
                baseSymbol,
                symRows.isEmpty() ? baseSymbol : symRows.get(0).get("name"));

        boolean contest = "CONTEST".equals(owner.accountType());
        String category = contest ? CATEGORY_CONTEST : CATEGORY_MOCK;
        String assetType = contest ? "CONTEST" : "MOCK";
        String assetTypeDisplayName = contest ? "(대회)" : "(모의투자)";
        String seasonTitle = null;
        if (contest && owner.contestSeasonId() != null) {
            seasonTitle = jdbc.query(
                    "select title from trading.contest_season where id = ?",
                    (rs, n) -> rs.getString(1),
                    owner.contestSeasonId()).stream().findFirst().orElse(null);
        }

        BigDecimal executedAmount = TradingMath.amount(snap.fillPrice().multiply(snap.fillQuantity()));

        if ("LIQUIDATE".equals(snap.action())) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("orderId", snap.orderId());
            payload.put("positionId", snap.positionId());
            payload.put("assetType", assetType);
            payload.put("assetTypeDisplayName", assetTypeDisplayName);
            if (owner.contestSeasonId() != null) {
                payload.put("seasonId", owner.contestSeasonId());
            }
            if (seasonTitle != null) {
                payload.put("seasonTitle", seasonTitle);
            }
            payload.put("symbol", symbolPair);
            payload.put("baseSymbol", baseSymbol);
            payload.put("displayNameKr", displayNameKr);
            payload.put("positionSide", snap.side());
            payload.put("leverage", snap.leverage());
            payload.put("liquidationPrice", plain(snap.fillPrice()));
            payload.put("closeQuantity", plain(snap.fillQuantity()));
            payload.put("executedAmount", plain(executedAmount));
            payload.put("totalFee", plain(snap.fillFee()));
            payload.put("realizedPnl", plain(snap.fillRealizedPnl()));
            payload.put("executedAt", snap.executedAt().toString());

            NotificationItemResponse saved = insertIdempotentNotification(
                    owner.memberId(),
                    category,
                    TYPE_LIQUIDATION_COMPLETED,
                    payload,
                    "LIQUIDATION:" + snap.orderId());
            if (saved == null) {
                return null;
            }
            return new DispatchOutcome(
                    owner.memberId(),
                    resolveEventName(category, TYPE_LIQUIDATION_COMPLETED),
                    saved,
                    queryStatusInternal(owner.memberId()));
        }

        String effectiveOrderType = "STOP_LOSS".equals(snap.reason()) ? "STOP_MARKET"
                : "TAKE_PROFIT".equals(snap.reason()) ? "TAKE_PROFIT_MARKET"
                : snap.type();
        BigDecimal executedMargin = TradingMath.margin(snap.fillPrice(), snap.fillQuantity(), snap.leverage());
        boolean isClose = "CLOSE".equals(snap.action());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("orderId", snap.orderId());
        payload.put("positionId", snap.positionId());
        payload.put("assetType", assetType);
        payload.put("assetTypeDisplayName", assetTypeDisplayName);
        if (owner.contestSeasonId() != null) {
            payload.put("seasonId", owner.contestSeasonId());
        }
        if (seasonTitle != null) {
            payload.put("seasonTitle", seasonTitle);
        }
        payload.put("symbol", symbolPair);
        payload.put("baseSymbol", baseSymbol);
        payload.put("displayNameKr", displayNameKr);
        payload.put("orderType", effectiveOrderType);
        if (snap.reason() != null) {
            payload.put("reason", snap.reason());
        }
        payload.put("positionSide", snap.side());
        payload.put("positionAction", snap.action());
        payload.put("leverage", snap.leverage());
        payload.put("price", plain(snap.fillPrice()));
        payload.put("quantity", plain(snap.fillQuantity()));
        payload.put("executedAmount", plain(executedAmount));
        payload.put("executedMargin", plain(executedMargin));
        payload.put("totalFee", plain(snap.fillFee()));
        payload.put("realizedPnl", isClose ? plain(snap.fillRealizedPnl()) : null);
        payload.put("executedAt", snap.executedAt().toString());

        NotificationItemResponse saved = insertIdempotentNotification(
                owner.memberId(),
                category,
                TYPE_ORDER_COMPLETED,
                payload,
                "ORDER_FILLED:" + snap.orderId());
        if (saved == null) {
            return null;
        }
        return new DispatchOutcome(
                owner.memberId(),
                resolveEventName(category, TYPE_ORDER_COMPLETED),
                saved,
                queryStatusInternal(owner.memberId()));
    }

    private DispatchOutcome dispatchContestApprovedInNewTx(
            Long applicantMemberId,
            Long seasonId,
            Long applicationId,
            Instant processedAt) {
        if (applicantMemberId == null || applicantMemberId <= 0
                || accounts.existsByMemberIdAndStatus(applicantMemberId, TradingAccount.Status.WITHDRAWN)) {
            return null;
        }
        var seasonRows = jdbc.query(
                "select title, seed_money from trading.contest_season where id = ?",
                (rs, n) -> Map.of(
                        "title", Objects.toString(rs.getString("title"), "대회"),
                        "seedMoney", plain(rs.getBigDecimal("seed_money"))),
                seasonId);
        if (seasonRows.isEmpty()) {
            return null;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("seasonId", seasonId);
        payload.put("seasonTitle", seasonRows.get(0).get("title"));
        payload.put("seedMoney", seasonRows.get(0).get("seedMoney"));
        payload.put("approvedAt", processedAt != null ? processedAt.toString() : Instant.now().toString());

        String dedupeKey = "CONTEST_APPROVED:" + applicationId + ":" + (processedAt != null ? processedAt.toEpochMilli() : 0L);
        NotificationItemResponse saved = insertIdempotentNotification(
                applicantMemberId,
                CATEGORY_CONTEST,
                TYPE_CONTEST_APPLICATION_APPROVED,
                payload,
                dedupeKey);
        if (saved == null) {
            return null;
        }
        return new DispatchOutcome(
                applicantMemberId,
                resolveEventName(CATEGORY_CONTEST, TYPE_CONTEST_APPLICATION_APPROVED),
                saved,
                queryStatusInternal(applicantMemberId));
    }

    private DispatchOutcome dispatchContestRejectedInNewTx(
            Long applicantMemberId,
            Long seasonId,
            Long applicationId,
            String rejectReason,
            Instant processedAt) {
        if (applicantMemberId == null || applicantMemberId <= 0
                || accounts.existsByMemberIdAndStatus(applicantMemberId, TradingAccount.Status.WITHDRAWN)) {
            return null;
        }
        String seasonTitle = jdbc.query(
                "select title from trading.contest_season where id = ?",
                (rs, n) -> rs.getString(1),
                seasonId).stream().findFirst().orElse("대회");

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("seasonId", seasonId);
        payload.put("seasonTitle", seasonTitle);
        payload.put("rejectReason", rejectReason);
        payload.put("rejectedAt", processedAt != null ? processedAt.toString() : Instant.now().toString());

        String dedupeKey = "CONTEST_REJECTED:" + applicationId + ":" + (processedAt != null ? processedAt.toEpochMilli() : 0L);
        NotificationItemResponse saved = insertIdempotentNotification(
                applicantMemberId,
                CATEGORY_CONTEST,
                TYPE_CONTEST_APPLICATION_REJECTED,
                payload,
                dedupeKey);
        if (saved == null) {
            return null;
        }
        return new DispatchOutcome(
                applicantMemberId,
                resolveEventName(CATEGORY_CONTEST, TYPE_CONTEST_APPLICATION_REJECTED),
                saved,
                queryStatusInternal(applicantMemberId));
    }

    private List<DispatchOutcome> dispatchContestSeasonSettledInNewTx(Long seasonId, Instant settledAt) {
        String seasonTitle = jdbc.query(
                "select title from trading.contest_season where id = ?",
                (rs, n) -> rs.getString(1),
                seasonId).stream().findFirst().orElse("대회");

        var rows = jdbc.queryForList("""
                SELECT cp.member_id, cp.seed_money, cp.final_balance, cp.final_realized_pnl, cp.final_roi_pct, cp.final_rank
                FROM trading.contest_participant cp
                JOIN trading.trading_account a ON a.id = cp.account_id
                WHERE cp.contest_season_id = ?
                  AND a.status <> 'WITHDRAWN'
                ORDER BY cp.final_rank ASC NULLS LAST, cp.id ASC
                """, seasonId);
        if (rows.isEmpty()) {
            return List.of();
        }
        int totalParticipants = rows.size();
        List<DispatchOutcome> outcomes = new ArrayList<>(totalParticipants);

        for (var row : rows) {
            long memberId = ((Number) row.get("member_id")).longValue();
            if (accounts.existsByMemberIdAndStatus(memberId, TradingAccount.Status.WITHDRAWN)) {
                continue;
            }
            Integer finalRank = row.get("final_rank") != null ? ((Number) row.get("final_rank")).intValue() : null;
            BigDecimal seedMoney = (BigDecimal) row.get("seed_money");
            BigDecimal finalBalance = (BigDecimal) row.get("final_balance");
            BigDecimal finalPnl = (BigDecimal) row.get("final_realized_pnl");
            BigDecimal finalRoiPct = (BigDecimal) row.get("final_roi_pct");

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("seasonId", seasonId);
            payload.put("seasonTitle", seasonTitle);
            payload.put("finalRank", finalRank);
            payload.put("totalParticipants", totalParticipants);
            payload.put("seedMoney", plain(seedMoney));
            payload.put("finalBalance", plain(finalBalance));
            payload.put("finalRealizedPnl", plain(finalPnl));
            payload.put("finalRoiPct", plain(finalRoiPct));
            payload.put("settledAt", settledAt != null ? settledAt.toString() : Instant.now().toString());

            String dedupeKey = "CONTEST_SETTLED:" + seasonId + ":" + memberId;
            NotificationItemResponse saved = insertIdempotentNotification(
                    memberId,
                    CATEGORY_CONTEST,
                    TYPE_CONTEST_SEASON_SETTLED,
                    payload,
                    dedupeKey);
            if (saved != null) {
                outcomes.add(new DispatchOutcome(
                        memberId,
                        resolveEventName(CATEGORY_CONTEST, TYPE_CONTEST_SEASON_SETTLED),
                        saved,
                        queryStatusInternal(memberId)));
            }
        }
        return outcomes;
    }

    private List<DispatchOutcome> dispatchContestSeasonCanceledInNewTx(
            Long seasonId,
            String seasonTitle,
            List<Long> affectedMemberIds,
            Instant canceledAt) {
        String resolvedTitle = (seasonTitle == null || seasonTitle.isBlank()) ? "대회" : seasonTitle;
        String canceledAtIso = canceledAt != null ? canceledAt.toString() : Instant.now().toString();
        List<DispatchOutcome> outcomes = new ArrayList<>(affectedMemberIds.size());
        for (Long memberId : affectedMemberIds) {
            if (memberId == null || memberId <= 0
                    || accounts.existsByMemberIdAndStatus(memberId, TradingAccount.Status.WITHDRAWN)) {
                continue;
            }
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("seasonId", seasonId);
            payload.put("seasonTitle", resolvedTitle);
            payload.put("canceledAt", canceledAtIso);
            payload.put("reason", "대회 시즌이 취소되어 진행 중인 신청·주문·포지션이 정리되었습니다.");

            String dedupeKey = "CONTEST_CANCELED:" + seasonId + ":" + memberId;
            NotificationItemResponse saved = insertIdempotentNotification(
                    memberId,
                    CATEGORY_CONTEST,
                    TYPE_CONTEST_SEASON_CANCELED,
                    payload,
                    dedupeKey);
            if (saved != null) {
                outcomes.add(new DispatchOutcome(
                        memberId,
                        resolveEventName(CATEGORY_CONTEST, TYPE_CONTEST_SEASON_CANCELED),
                        saved,
                        queryStatusInternal(memberId)));
            }
        }
        return outcomes;
    }

    private NotificationItemResponse insertIdempotentNotification(
            Long receiverId,
            String category,
            String type,
            Object payload,
            String dedupeKey) {
        String payloadJson = writeJson(payload);
        List<Long> ids = jdbc.query(
                "insert into trading.notification("
                        + "receiver_member_id, actor_member_id, category, type, payload_json, is_read, read_at, dedupe_key, created_at, last_event_at"
                        + ") values (?, null, ?, ?, cast(? as jsonb), false, null, ?, now(), now()) "
                        + "on conflict (dedupe_key) do nothing returning id",
                (rs, n) -> rs.getLong(1),
                receiverId, category, type, payloadJson, dedupeKey);
        if (ids.isEmpty()) {
            return null;
        }
        return querySingleNotification(ids.get(0));
    }

    private NotificationItemResponse querySingleNotification(Long id) {
        return jdbc.queryForObject(
                "select id, actor_member_id, category, type, payload_json::text as payload_text, is_read, created_at, last_event_at "
                        + "from trading.notification where id = ?",
                (rs, n) -> mapItem(rs),
                id);
    }

    private NotificationStatusResponse queryStatusInternal(Long memberId) {
        Long lastCheckedId = queryLastCheckedId(memberId);
        Long newCount = lastCheckedId == null
                ? jdbc.queryForObject(
                        "select count(*) from trading.notification where receiver_member_id = ?",
                        Long.class, memberId)
                : jdbc.queryForObject(
                        "select count(*) from trading.notification where receiver_member_id = ? and id > ?",
                        Long.class, memberId, lastCheckedId);
        Long unreadCount = jdbc.queryForObject(
                "select count(*) from trading.notification where receiver_member_id = ? and is_read = false",
                Long.class, memberId);
        return NotificationStatusResponse.of(
                newCount == null ? 0L : newCount,
                unreadCount == null ? 0L : unreadCount);
    }

    private Long queryLastCheckedId(Long memberId) {
        return jdbc.query(
                "select last_checked_notification_id from trading.notification_state where member_id = ?",
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

    private void requireActiveMember(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw new BusinessException(ErrorCode.MEMBER_ACCOUNT_REQUIRED);
        }
        if (accounts.existsByMemberIdAndStatus(memberId, TradingAccount.Status.WITHDRAWN)) {
            throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        }
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

    private static String resolveEventName(String category, String type) {
        boolean contest = CATEGORY_CONTEST.equals(category);
        return switch (type) {
            case TYPE_ORDER_COMPLETED -> contest ? "NOTIFICATION_CONTEST_ORDER_COMPLETED" : "NOTIFICATION_MOCK_ORDER_COMPLETED";
            case TYPE_LIQUIDATION_COMPLETED -> contest ? "NOTIFICATION_CONTEST_LIQUIDATION_COMPLETED" : "NOTIFICATION_MOCK_LIQUIDATION_COMPLETED";
            case TYPE_CONTEST_APPLICATION_APPROVED -> "NOTIFICATION_CONTEST_APPLICATION_APPROVED";
            case TYPE_CONTEST_APPLICATION_REJECTED -> "NOTIFICATION_CONTEST_APPLICATION_REJECTED";
            case TYPE_CONTEST_SEASON_SETTLED -> "NOTIFICATION_CONTEST_SEASON_SETTLED";
            case TYPE_CONTEST_SEASON_CANCELED -> "NOTIFICATION_CONTEST_SEASON_CANCELED";
            default -> "NOTIFICATION_" + type;
        };
    }

    private static String plain(BigDecimal value) {
        if (value == null) {
            return null;
        }
        BigDecimal stripped = value.stripTrailingZeros();
        return stripped.scale() < 0 ? stripped.setScale(0).toPlainString() : stripped.toPlainString();
    }

    private String writeJson(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize trading notification payload", e);
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
}
