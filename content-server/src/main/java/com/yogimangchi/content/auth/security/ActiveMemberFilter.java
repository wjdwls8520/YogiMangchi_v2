package com.yogimangchi.content.auth.security;

import com.yogimangchi.content.error.ApiErrors;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

public class ActiveMemberFilter extends OncePerRequestFilter {
    private record MemberState(String status, String role) { }

    private final JdbcTemplate jdbc;

    public ActiveMemberFilter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
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
            } catch (org.springframework.dao.DataAccessResourceFailureException failure) {
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
                ApiErrors.write(response, 403, "MEMBER_BANNED");
                return;
            }
            boolean suspendedAllowed = "SUSPENDED".equals(status)
                    && isSuspendedAllowedRequest(request.getMethod(), path);
            if ("SUSPENDED".equals(status) && !suspendedAllowed) {
                ApiErrors.write(response, 403, "MEMBER_SUSPENDED");
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

    private static boolean isSuspendedAllowedRequest(String method, String path) {
        if ("GET".equalsIgnoreCase(method)) {
            return path.equals("/api/v1/members/me")
                    || path.equals("/api/v1/support/inquiries/me");
        }
        if ("POST".equalsIgnoreCase(method)) {
            return path.equals("/api/v1/support/inquiries")
                    || path.equals("/api/v1/auth/logout")
                    || path.equals("/api/v1/auth/logout-all");
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
