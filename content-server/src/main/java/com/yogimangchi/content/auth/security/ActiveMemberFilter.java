package com.yogimangchi.content.auth.security;

import com.yogimangchi.content.error.ApiErrors;
import com.yogimangchi.content.ops.OpsAlertService;
import com.yogimangchi.content.ops.OpsErrorBuffer;
import com.yogimangchi.content.ops.RequestIdMdcFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.filter.OncePerRequestFilter;

public class ActiveMemberFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(ActiveMemberFilter.class);
    public static final String DEGRADED_DB_OUTAGE_ADMIN_ATTR = ActiveMemberFilter.class.getName() + ".DEGRADED_ADMIN";
    public static final String SUSPENDED_DETAIL_MESSAGE =
            "계정이 일시 정지 상태입니다. 1:1 문의(/support)를 통해 이의 제기를 접수하거나 회원 탈퇴만 이용할 수 있습니다.";

    private record MemberState(String status, String role) { }

    private final JdbcTemplate jdbc;
    private final OpsErrorBuffer errorBuffer;
    private final OpsAlertService alerts;

    public ActiveMemberFilter(JdbcTemplate jdbc) {
        this(jdbc, null, null);
    }

    public ActiveMemberFilter(JdbcTemplate jdbc, OpsErrorBuffer errorBuffer, OpsAlertService alerts) {
        this.jdbc = jdbc;
        this.errorBuffer = errorBuffer;
        this.alerts = alerts;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if (auth != null && auth.getPrincipal() instanceof Jwt jwt) {
            Long memberId;
            try {
                memberId = Long.valueOf(jwt.getSubject());
            } catch (NumberFormatException ex) {
                ApiErrors.write(response, 401, "INVALID_ACCESS_TOKEN");
                return;
            }

            List<MemberState> rows;
            try {
                rows = jdbc.query(
                        "select status, role from content.member where id = ?",
                        (rs, n) -> new MemberState(rs.getString("status"), rs.getString("role")),
                        memberId);
            } catch (DataAccessException | CannotCreateTransactionException failure) {
                if (isDbOutageTolerantAdminReadPath(request.getMethod(), path) && isValidDegradedAdminJwt(jwt)) {
                    log.warn("[Auth] DB outage degraded read-only ADMIN auth granted path={} memberId={}", path, memberId);
                    request.setAttribute(DEGRADED_DB_OUTAGE_ADMIN_ATTR, Boolean.TRUE);
                    List<GrantedAuthority> adminAuthorities = List.of(
                            new SimpleGrantedAuthority("ROLE_ADMIN"),
                            new SimpleGrantedAuthority("ROLE_MEMBER"));
                    JwtAuthenticationToken degraded = new JwtAuthenticationToken(jwt, adminAuthorities, jwt.getSubject());
                    degraded.setDetails(auth.getDetails());
                    SecurityContextHolder.getContext().setAuthentication(degraded);
                    chain.doFilter(request, response);
                    return;
                }
                recordAuthUnavailable(request, path, failure);
                ApiErrors.write(response, 503, "SERVICE_TEMPORARILY_UNAVAILABLE");
                return;
            }

            if (rows.isEmpty()) {
                ApiErrors.write(response, 401, "MEMBER_NOT_ACTIVE");
                return;
            }

            MemberState state = rows.get(0);
            String status = state.status();
            if ("BANNED".equals(status)) {
                ApiErrors.write(response, 403, "MEMBER_BANNED", "영구 이용 제한된 계정입니다.");
                return;
            }
            boolean suspendedAllowed = "SUSPENDED".equals(status)
                    && isSuspendedAllowedRequest(request.getMethod(), path);
            if ("SUSPENDED".equals(status) && !suspendedAllowed) {
                ApiErrors.write(response, 403, "MEMBER_SUSPENDED", SUSPENDED_DETAIL_MESSAGE);
                return;
            }

            boolean withdrawalEndpoint = path.equals("/api/v1/members/me/withdrawal");
            if (!"ACTIVE".equals(status) && !withdrawalEndpoint && !suspendedAllowed) {
                ApiErrors.write(response, 401, "MEMBER_NOT_ACTIVE");
                return;
            }

            boolean isAdmin = "ACTIVE".equals(status) && "ADMIN".equals(state.role());
            if (isAdminOnlyPath(path) && !isAdmin) {
                ApiErrors.write(response, 403, "ACCESS_DENIED");
                return;
            }

            List<GrantedAuthority> authorities = isAdmin
                    ? List.of(new SimpleGrantedAuthority("ROLE_ADMIN"), new SimpleGrantedAuthority("ROLE_MEMBER"))
                    : List.of(new SimpleGrantedAuthority("ROLE_MEMBER"));
            JwtAuthenticationToken enriched = new JwtAuthenticationToken(jwt, authorities, jwt.getSubject());
            enriched.setDetails(auth.getDetails());
            SecurityContextHolder.getContext().setAuthentication(enriched);
        }
        chain.doFilter(request, response);
    }

    private void recordAuthUnavailable(HttpServletRequest request, String path, RuntimeException failure) {
        String method = request != null ? request.getMethod() : null;
        String sanitizedUri = OpsErrorBuffer.sanitizeUri(path);
        String reqId = MDC.get(RequestIdMdcFilter.MDC_KEY);
        Throwable root = failure;
        int depth = 0;
        while (root.getCause() != null && root.getCause() != root && depth < 16) {
            root = root.getCause();
            depth++;
        }
        String rootCause = root.getClass().getSimpleName();
        String topFrame = OpsErrorBuffer.extractTopAppFrame(failure);
        log.error("[Auth] Content DB unavailable during member verification method={} uri={} reqId={} rootCause={} topFrame={}",
                method, sanitizedUri, reqId, rootCause, topFrame);
        if (errorBuffer != null) {
            errorBuffer.record(503, "SERVICE_TEMPORARILY_UNAVAILABLE", method, sanitizedUri, reqId, rootCause, topFrame);
        }
        if (alerts != null) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("status", 503);
            if (method != null) details.put("method", method);
            if (sanitizedUri != null) details.put("uri", sanitizedUri);
            if (reqId != null) details.put("requestId", reqId);
            details.put("rootCause", rootCause);
            if (topFrame != null) details.put("topAppFrame", topFrame);
            alerts.alert("content-auth-503:" + (sanitizedUri != null ? sanitizedUri : "unknown"),
                    "CRITICAL", "Content member verification DB/pool unavailable (503)", details);
        }
    }

    private static boolean isValidDegradedAdminJwt(Jwt jwt) {
        if (jwt == null || jwt.getExpiresAt() == null || !jwt.getExpiresAt().isAfter(Instant.now())) {
            return false;
        }
        String accountStatus = jwt.getClaimAsString("account_status");
        if ("SUSPENDED".equalsIgnoreCase(accountStatus) || "BANNED".equalsIgnoreCase(accountStatus)
                || "WITHDRAWN".equalsIgnoreCase(accountStatus)) {
            return false;
        }
        List<String> roles = jwt.getClaimAsStringList("roles");
        if (roles == null || roles.isEmpty()) {
            return false;
        }
        return roles.stream().anyMatch(r -> "ADMIN".equalsIgnoreCase(r) || "ROLE_ADMIN".equalsIgnoreCase(r));
    }

    private static boolean isDbOutageTolerantAdminReadPath(String method, String path) {
        if (!"GET".equalsIgnoreCase(method)) {
            return false;
        }
        return path.equals("/api/v1/admin/ops/summary")
                || path.equals("/actuator/info")
                || path.equals("/actuator/metrics")
                || path.startsWith("/actuator/metrics/");
    }

    static boolean isSuspendedAllowedRequest(String method, String path) {
        if (path == null || method == null) {
            return false;
        }
        if (path.equals("/api/v1/members/me") && "GET".equalsIgnoreCase(method)) {
            return true;
        }
        if (path.equals("/api/v1/members/me/consents")
                && ("GET".equalsIgnoreCase(method) || "POST".equalsIgnoreCase(method))) {
            return true;
        }
        if (path.equals("/api/v1/members/me/withdrawal")
                && ("GET".equalsIgnoreCase(method) || "POST".equalsIgnoreCase(method))) {
            return true;
        }
        if (path.equals("/api/v1/support/inquiries") || path.startsWith("/api/v1/support/inquiries/")) {
            return true;
        }
        if (path.equals("/api/v1/notifications") || path.startsWith("/api/v1/notifications/")) {
            return true;
        }
        if (path.equals("/api/v1/auth/logout")
                || path.equals("/api/v1/auth/logout-all")
                || path.equals("/api/v1/auth/refresh")
                || path.equals("/api/v1/auth/session-probe")
                || path.equals("/api/v1/auth/csrf")) {
            return true;
        }
        return false;
    }

    private static boolean isAdminOnlyPath(String path) {
        return path.equals("/api/v1/admin")
                || path.startsWith("/api/v1/admin/")
                || path.equals("/actuator/info")
                || path.equals("/actuator/metrics")
                || path.startsWith("/actuator/metrics/");
    }
}
