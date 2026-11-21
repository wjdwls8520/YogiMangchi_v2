package com.yogimangchi.trading.tradingaccount.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.yogimangchi.trading.ops.RequestIdMdcFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.MDC;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.json.ProblemDetailJacksonMixin;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public class TradingTokenFilter extends OncePerRequestFilter {
    private static final ObjectMapper PROBLEM_MAPPER = JsonMapper.builder()
            .addMixIn(ProblemDetail.class, ProblemDetailJacksonMixin.class)
            .build();

    private final TradingCredentials credentials;
    public TradingTokenFilter(TradingCredentials credentials) { this.credentials = credentials; }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if ("OPTIONS".equals(request.getMethod())) {
            return true;
        }
        boolean actuatorProtected = path.equals("/actuator/info")
                || path.equals("/actuator/metrics")
                || path.startsWith("/actuator/metrics/");
        if (actuatorProtected) {
            return false;
        }
        return !path.startsWith("/api/v1/trading/")
                || ("POST".equals(request.getMethod()) && path.equals("/api/v1/trading/accounts/guest"))
                || ("GET".equals(request.getMethod()) && path.startsWith("/api/v1/trading/contest/public/"));
    }

    private static boolean isOptionalAuthPath(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return "GET".equals(request.getMethod()) && path.startsWith("/api/v1/trading/portfolios/members/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        boolean optional = isOptionalAuthPath(request);
        if (header != null) {
            if (java.util.Collections.list(request.getHeaders("Authorization")).size() != 1) {
                if (optional) {
                    chain.doFilter(request, response);
                    return;
                }
                problem(request, response, 401, "INVALID_ACCESS_TOKEN", "Exactly one bearer credential is required");
                return;
            }
            var principal = java.util.Optional.<TradingPrincipal>empty();
            try {
                if (header.startsWith("Bearer ") && header.length() <= 8199) {
                    principal = credentials.authenticate(header.substring(7));
                }
            } catch (DataAccessException | CannotCreateTransactionException exception) {
                if (optional) {
                    chain.doFilter(request, response);
                    return;
                }
                problem(request, response, 503, "AUTHENTICATION_UNAVAILABLE", "Authentication is temporarily unavailable");
                return;
            }
            if (principal.isEmpty()) {
                if (optional) {
                    chain.doFilter(request, response);
                    return;
                }
                problem(request, response, 401, header.contains(".") ? "INVALID_ACCESS_TOKEN" : "INVALID_GUEST_CREDENTIAL",
                        "Trading credential is invalid or expired");
                return;
            }
            var authorities = new java.util.ArrayList<SimpleGrantedAuthority>();
            if (principal.get().accountId() != null) authorities.add(new SimpleGrantedAuthority("ROLE_TRADER"));
            if (principal.get().memberId() != null) authorities.add(new SimpleGrantedAuthority("ROLE_MEMBER"));
            if (principal.get().isAdmin()) authorities.add(new SimpleGrantedAuthority("ROLE_ADMIN"));
            SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(principal.get(), null, authorities));
        }
        chain.doFilter(request, response);
    }

    public static void problem(HttpServletResponse response, int status, String code, String detail) throws IOException {
        problem(null, response, status, code, detail);
    }

    public static void problem(HttpServletRequest request, HttpServletResponse response, int status, String code, String detail)
            throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(status), detail);
        problem.setProperty("code", code);
        String requestId = resolveRequestId(request, response);
        if (requestId != null && !requestId.isBlank()) {
            problem.setProperty("requestId", requestId);
        }
        response.getWriter().write(PROBLEM_MAPPER.writeValueAsString(problem));
    }

    private static String resolveRequestId(HttpServletRequest request, HttpServletResponse response) {
        String mdc = MDC.get(RequestIdMdcFilter.MDC_KEY);
        if (mdc != null && !mdc.isBlank()) {
            return mdc;
        }
        if (request != null) {
            if (request.getAttribute(RequestIdMdcFilter.REQUEST_ATTR) instanceof String attr && !attr.isBlank()) {
                return attr;
            }
            String header = RequestIdMdcFilter.sanitize(request.getHeader(RequestIdMdcFilter.HEADER_NAME));
            if (header != null) {
                return header;
            }
        }
        if (response != null) {
            String responseHeader = RequestIdMdcFilter.sanitize(response.getHeader(RequestIdMdcFilter.HEADER_NAME));
            if (responseHeader != null) {
                return responseHeader;
            }
        }
        return null;
    }
}
