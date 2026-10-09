package com.yogimangchi.trading.tradingaccount.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public class GuestTokenFilter extends OncePerRequestFilter {
    private final GuestCredentialService credentials;
    public GuestTokenFilter(GuestCredentialService credentials) { this.credentials = credentials; }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return !path.startsWith("/api/v1/trading/")
                || "OPTIONS".equals(request.getMethod())
                || ("POST".equals(request.getMethod()) && path.equals("/api/v1/trading/accounts/guest"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null) {
            var principal = java.util.Optional.<GuestPrincipal>empty();
            try {
                if (header.startsWith("Bearer ") && header.length() < 128) principal = credentials.authenticate(header.substring(7));
            } catch (DataAccessException | CannotCreateTransactionException exception) {
                problem(response, 503, "AUTHENTICATION_UNAVAILABLE", "Authentication is temporarily unavailable");
                return;
            }
            if (principal.isEmpty()) {
                problem(response, 401, "INVALID_GUEST_CREDENTIAL", "Guest credential is invalid or expired");
                return;
            }
            SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                    principal.get(), null, List.of(new SimpleGrantedAuthority("ROLE_TRADER"))));
        }
        chain.doFilter(request, response);
    }

    public static void problem(HttpServletResponse response, int status, String code, String detail) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        response.getWriter().write("{\"type\":\"about:blank\",\"status\":" + status + ",\"code\":\"" + code
                + "\",\"detail\":\"" + detail + "\"}");
    }
}
