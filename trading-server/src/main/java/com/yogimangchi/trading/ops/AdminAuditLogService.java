package com.yogimangchi.trading.ops;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Persistent append-only audit log for trading-server administrative mutations. */
@Service
public class AdminAuditLogService {
    private static final Logger log = LoggerFactory.getLogger(AdminAuditLogService.class);

    public record AuditLogItem(
            long id,
            long adminMemberId,
            String action,
            String targetType,
            String targetId,
            String detail,
            String requestId,
            Instant createdAt) { }

    public record AuditLogPageResponse(
            List<AuditLogItem> items,
            Long nextCursorId,
            boolean hasNext) { }

    private final JdbcTemplate jdbc;

    public AdminAuditLogService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void record(Long adminMemberId, String action, String targetType, String targetId, String detail) {
        long actor = adminMemberId != null && adminMemberId > 0 ? adminMemberId : 0L;
        String safeAction = sanitizeRequired(action, 64, "UNKNOWN_ACTION");
        String safeTargetType = sanitizeRequired(targetType, 48, "UNKNOWN");
        String safeTargetId = sanitizeRequired(targetId, 128, "0");
        String safeDetail = sanitizeOptional(detail, 2000);
        String requestId = sanitizeOptional(MDC.get(RequestIdMdcFilter.MDC_KEY), 64);
        jdbc.update("""
                INSERT INTO trading.admin_audit_log (
                    admin_member_id, action, target_type, target_id, detail, request_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, NOW())
                """, actor, safeAction, safeTargetType, safeTargetId, safeDetail, requestId);
        log.info("[AdminAudit] action={} adminMemberId={} targetType={} targetId={} reqId={}",
                safeAction, actor, safeTargetType, safeTargetId, requestId);
    }

    @Transactional(readOnly = true, timeout = 5)
    public AuditLogPageResponse list(Long cursorId, int size) {
        if (size < 1 || size > 100 || (cursorId != null && cursorId <= 0)) {
            throw new BusinessException(ErrorCode.INVALID_HISTORY_REQUEST);
        }
        StringBuilder sql = new StringBuilder("""
                SELECT id, admin_member_id, action, target_type, target_id, detail, request_id, created_at
                FROM trading.admin_audit_log
                """);
        List<Object> params = new ArrayList<>(2);
        if (cursorId != null) {
            sql.append(" WHERE id < ?");
            params.add(cursorId);
        }
        sql.append(" ORDER BY id DESC LIMIT ?");
        params.add(size + 1);

        List<AuditLogItem> rows = jdbc.query(sql.toString(), (rs, n) -> {
            Timestamp ts = rs.getTimestamp("created_at");
            return new AuditLogItem(
                    rs.getLong("id"),
                    rs.getLong("admin_member_id"),
                    rs.getString("action"),
                    rs.getString("target_type"),
                    rs.getString("target_id"),
                    rs.getString("detail"),
                    rs.getString("request_id"),
                    ts != null ? ts.toInstant() : null);
        }, params.toArray());

        boolean hasNext = rows.size() > size;
        List<AuditLogItem> page = hasNext ? rows.subList(0, size) : rows;
        Long nextCursor = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;
        return new AuditLogPageResponse(List.copyOf(page), nextCursor, hasNext);
    }

    private static String sanitizeRequired(String value, int maxLen, String fallback) {
        String cleaned = sanitizeOptional(value, maxLen);
        return cleaned != null ? cleaned : fallback;
    }

    private static String sanitizeOptional(String value, int maxLen) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String cleaned = value.replaceAll("[\\p{Cntrl}]", " ").strip();
        return cleaned.length() > maxLen ? cleaned.substring(0, maxLen) : cleaned;
    }
}
