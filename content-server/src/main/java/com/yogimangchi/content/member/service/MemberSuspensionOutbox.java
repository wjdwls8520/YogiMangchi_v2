package com.yogimangchi.content.member.service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Transactional outbox store for member suspension/unsuspension propagation to trading-server.
 */
@Service
public class MemberSuspensionOutbox {
    public record DeliveryTask(
            long id,
            long memberId,
            boolean suspended,
            String reason,
            int attemptCount,
            Instant createdAt) { }

    private final JdbcTemplate jdbc;

    public MemberSuspensionOutbox(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public long enqueue(Long memberId, boolean suspended, String reason) {
        String safeReason = sanitizeReason(reason);
        // Supersede any older undelivered row for the same member so the latest authoritative state always wins.
        jdbc.update("""
                UPDATE content.member_suspension_delivery
                SET status = 'COMPLETED',
                    completed_at = NOW(),
                    updated_at = NOW(),
                    last_error = 'SUPERSEDED'
                WHERE member_id = ? AND status = 'PENDING'
                """, memberId);

        Long id = jdbc.queryForObject("""
                INSERT INTO content.member_suspension_delivery (
                    member_id, suspended, reason, status, attempt_count, next_attempt_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'PENDING', 0, NOW(), NOW(), NOW())
                RETURNING id
                """, Long.class, memberId, suspended, safeReason);
        return id != null ? id : 0L;
    }

    @Transactional(readOnly = true, timeout = 3)
    public List<DeliveryTask> pending() {
        return jdbc.query("""
                SELECT id, member_id, suspended, reason, attempt_count, created_at
                FROM content.member_suspension_delivery
                WHERE status = 'PENDING' AND next_attempt_at <= NOW()
                ORDER BY next_attempt_at ASC, id ASC
                LIMIT 20
                """, (rs, n) -> mapRow(rs));
    }

    @Transactional(readOnly = true, timeout = 3)
    public Optional<DeliveryTask> findPendingById(long deliveryId) {
        List<DeliveryTask> rows = jdbc.query("""
                SELECT id, member_id, suspended, reason, attempt_count, created_at
                FROM content.member_suspension_delivery
                WHERE id = ? AND status = 'PENDING'
                """, (rs, n) -> mapRow(rs), deliveryId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    @Transactional(readOnly = true, timeout = 3)
    public List<DeliveryTask> findStuckPending() {
        return jdbc.query("""
                SELECT id, member_id, suspended, reason, attempt_count, created_at
                FROM content.member_suspension_delivery
                WHERE status = 'PENDING'
                  AND (attempt_count >= 3 OR created_at < NOW() - INTERVAL '5 minutes')
                ORDER BY created_at ASC, id ASC
                LIMIT 20
                """, (rs, n) -> mapRow(rs));
    }

    @Transactional(timeout = 3)
    public void markDelivered(long deliveryId) {
        jdbc.update("""
                UPDATE content.member_suspension_delivery
                SET status = 'COMPLETED',
                    completed_at = NOW(),
                    updated_at = NOW(),
                    last_error = NULL
                WHERE id = ? AND status = 'PENDING'
                """, deliveryId);
    }

    @Transactional(timeout = 3)
    public int markFailed(long deliveryId, String errorSummary) {
        String safeError = sanitizeError(errorSummary);
        List<Integer> rows = jdbc.queryForList("""
                UPDATE content.member_suspension_delivery
                SET attempt_count = LEAST(attempt_count + 1, 1000000),
                    next_attempt_at = NOW() + make_interval(secs => LEAST(300, 5 * power(2, LEAST(attempt_count, 6)))::int),
                    last_error = ?,
                    updated_at = NOW()
                WHERE id = ? AND status = 'PENDING'
                RETURNING attempt_count
                """, Integer.class, safeError, deliveryId);
        return rows.isEmpty() ? 0 : rows.get(0);
    }

    private static DeliveryTask mapRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        Timestamp createdTs = rs.getTimestamp("created_at");
        return new DeliveryTask(
                rs.getLong("id"),
                rs.getLong("member_id"),
                rs.getBoolean("suspended"),
                rs.getString("reason"),
                rs.getInt("attempt_count"),
                createdTs != null ? createdTs.toInstant() : Instant.now());
    }

    private static String sanitizeReason(String reason) {
        if (reason == null || reason.isBlank()) {
            return null;
        }
        String cleaned = reason.replace("\0", "").strip();
        return cleaned.length() > 500 ? cleaned.substring(0, 500) : cleaned;
    }

    private static String sanitizeError(String error) {
        if (error == null || error.isBlank()) {
            return "Delivery failed";
        }
        String cleaned = error.replaceAll("[\\p{Cntrl}]", " ").strip();
        return cleaned.length() > 500 ? cleaned.substring(0, 500) : cleaned;
    }
}
