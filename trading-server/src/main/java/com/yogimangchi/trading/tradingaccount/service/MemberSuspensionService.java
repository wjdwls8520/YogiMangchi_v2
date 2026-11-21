package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.notification.TradingNotificationSseService;
import com.yogimangchi.trading.tradingevent.websocket.TradingEventWebSocketHandler;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Persists Content-propagated member suspension state and immediately severs active real-time streams. */
@Service
public class MemberSuspensionService {
    private static final Logger log = LoggerFactory.getLogger(MemberSuspensionService.class);

    private final JdbcTemplate jdbc;
    private final ObjectProvider<TradingEventWebSocketHandler> wsHandlers;
    private final ObjectProvider<TradingNotificationSseService> notificationSse;

    public MemberSuspensionService(
            JdbcTemplate jdbc,
            ObjectProvider<TradingEventWebSocketHandler> wsHandlers,
            ObjectProvider<TradingNotificationSseService> notificationSse) {
        this.jdbc = jdbc;
        this.wsHandlers = wsHandlers;
        this.notificationSse = notificationSse;
    }

    @Transactional(timeout = 5)
    public void updateSuspension(Long memberId, boolean suspended, String reason) {
        if (memberId == null || memberId <= 0) {
            throw new IllegalArgumentException("Positive member ID required");
        }
        String safeReason = sanitizeReason(reason);
        OffsetDateTime now = Instant.now().truncatedTo(ChronoUnit.MICROS).atOffset(ZoneOffset.UTC);
        jdbc.update("""
                INSERT INTO trading.member_suspension (member_id, suspended, reason, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (member_id)
                DO UPDATE SET suspended = EXCLUDED.suspended,
                              reason = EXCLUDED.reason,
                              updated_at = EXCLUDED.updated_at
                """, memberId, suspended, safeReason, now);
        log.info("[MemberSuspension] updated memberId={} suspended={}", memberId, suspended);

        if (suspended) {
            disconnectRealtimeStreams(memberId);
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        disconnectRealtimeStreams(memberId);
                    }
                });
            }
        }
    }

    @Transactional(readOnly = true, timeout = 3)
    public boolean isSuspended(Long memberId) {
        if (memberId == null || memberId <= 0) {
            return false;
        }
        List<Boolean> rows = jdbc.query(
                "SELECT suspended FROM trading.member_suspension WHERE member_id = ?",
                (rs, n) -> rs.getBoolean(1),
                memberId);
        return !rows.isEmpty() && Boolean.TRUE.equals(rows.get(0));
    }

    private void disconnectRealtimeStreams(Long memberId) {
        TradingEventWebSocketHandler ws = wsHandlers != null ? wsHandlers.getIfAvailable() : null;
        if (ws != null) {
            ws.disconnectMember(memberId, "Member suspended");
        }
        TradingNotificationSseService sse = notificationSse != null ? notificationSse.getIfAvailable() : null;
        if (sse != null) {
            sse.disconnectMember(memberId);
        }
    }

    private static String sanitizeReason(String reason) {
        if (reason == null || reason.isBlank()) {
            return null;
        }
        String cleaned = reason.replaceAll("[\\p{Cntrl}]", " ").strip();
        return cleaned.length() > 500 ? cleaned.substring(0, 500) : cleaned;
    }
}
