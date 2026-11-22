package com.yogimangchi.content.ops;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.error.AuthFailure;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Persistent append-only audit log for content-server administrative mutations. */
@Service
public class AdminAuditLogService {
    private static final Logger log = LoggerFactory.getLogger(AdminAuditLogService.class);

    public record AuditLogItem(
            long id,
            long adminMemberId,
            String adminNickname,
            String action,
            String targetType,
            String targetId,
            String summary,
            JsonNode detail,
            String requestId,
            Instant createdAt) { }

    public record AuditLogPageResponse(
            List<AuditLogItem> items,
            Long nextCursorId,
            boolean hasNext) { }

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AdminAuditLogService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public void record(
            Long adminMemberId,
            String action,
            String targetType,
            String targetId,
            String summary,
            Map<String, Object> detail) {
        long actor = adminMemberId != null && adminMemberId > 0 ? adminMemberId : 0L;
        String safeAction = sanitizeRequired(action, 64, "UNKNOWN_ACTION").toUpperCase(Locale.ROOT);
        String safeTargetType = sanitizeRequired(targetType, 48, "UNKNOWN").toUpperCase(Locale.ROOT);
        String safeTargetId = sanitizeRequired(targetId, 128, "0");
        String safeSummary = sanitizeOptional(summary, 500);
        String requestId = sanitizeOptional(MDC.get(RequestIdMdcFilter.MDC_KEY), 64);
        String adminNickname = resolveAdminNickname(actor);
        String detailJson = serializeDetail(detail);

        jdbc.update("""
                INSERT INTO content.admin_audit_log (
                    admin_member_id, admin_nickname, action, target_type, target_id, summary, detail_json, request_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, NOW())
                """, actor, adminNickname, safeAction, safeTargetType, safeTargetId, safeSummary, detailJson, requestId);

        log.info("[AdminAudit] action={} adminMemberId={} targetType={} targetId={} reqId={}",
                safeAction, actor, safeTargetType, safeTargetId, requestId);
    }

    @Transactional(readOnly = true, timeout = 5)
    public AuditLogPageResponse list(
            Long callerAdminId,
            Long cursorId,
            Integer size,
            String action,
            Long filterAdminMemberId) {
        requireAdmin(callerAdminId);
        int limit = size == null ? 20 : size;
        if (limit < 1 || limit > 100 || (cursorId != null && cursorId <= 0)
                || (filterAdminMemberId != null && filterAdminMemberId <= 0)) {
            throw new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
        }

        StringBuilder sql = new StringBuilder("""
                SELECT id, admin_member_id, admin_nickname, action, target_type, target_id,
                       summary, detail_json::text AS detail_text, request_id, created_at
                FROM content.admin_audit_log
                WHERE 1=1
                """);
        List<Object> params = new ArrayList<>(4);
        if (action != null && !action.isBlank() && !"ALL".equalsIgnoreCase(action.strip())) {
            String normalizedAction = sanitizeOptional(action, 64);
            if (normalizedAction == null || !normalizedAction.toUpperCase(Locale.ROOT).matches("[A-Z0-9_]{2,64}")) {
                throw new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
            }
            sql.append(" AND action = ?");
            params.add(normalizedAction.toUpperCase(Locale.ROOT));
        }
        if (filterAdminMemberId != null) {
            sql.append(" AND admin_member_id = ?");
            params.add(filterAdminMemberId);
        }
        if (cursorId != null) {
            sql.append(" AND id < ?");
            params.add(cursorId);
        }
        sql.append(" ORDER BY created_at DESC, id DESC LIMIT ?");
        params.add(limit + 1);

        List<AuditLogItem> rows = jdbc.query(sql.toString(), (rs, n) -> {
            Timestamp ts = rs.getTimestamp("created_at");
            String detailText = rs.getString("detail_text");
            JsonNode detailNode = null;
            if (detailText != null && !detailText.isBlank()) {
                try {
                    detailNode = json.readTree(detailText);
                } catch (JsonProcessingException ignored) {
                    detailNode = null;
                }
            }
            return new AuditLogItem(
                    rs.getLong("id"),
                    rs.getLong("admin_member_id"),
                    rs.getString("admin_nickname"),
                    rs.getString("action"),
                    rs.getString("target_type"),
                    rs.getString("target_id"),
                    rs.getString("summary"),
                    detailNode,
                    rs.getString("request_id"),
                    ts != null ? ts.toInstant() : null);
        }, params.toArray());

        boolean hasNext = rows.size() > limit;
        List<AuditLogItem> page = hasNext ? rows.subList(0, limit) : rows;
        Long nextCursor = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;
        return new AuditLogPageResponse(List.copyOf(page), nextCursor, hasNext);
    }

    private String resolveAdminNickname(long adminMemberId) {
        if (adminMemberId <= 0) {
            return null;
        }
        try {
            List<String> rows = jdbc.queryForList(
                    "SELECT nickname FROM content.member WHERE id = ?",
                    String.class,
                    adminMemberId);
            if (!rows.isEmpty()) {
                return sanitizeOptional(rows.get(0), 64);
            }
        } catch (RuntimeException ignored) {
            // Best effort only
        }
        return null;
    }

    private String serializeDetail(Map<String, Object> detail) {
        if (detail == null || detail.isEmpty()) {
            return null;
        }
        try {
            return json.writeValueAsString(detail);
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private void requireAdmin(Long adminId) {
        if (adminId == null) {
            throw AuthFailure.unauthorized();
        }
        Boolean isAdmin = jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM content.member WHERE id = ? AND status = 'ACTIVE' AND role = 'ADMIN')",
                Boolean.class,
                adminId);
        if (!Boolean.TRUE.equals(isAdmin)) {
            throw new AuthFailure("ACCESS_DENIED", HttpStatus.FORBIDDEN);
        }
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
