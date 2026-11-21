package com.yogimangchi.trading.tradingaccount.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.ops.OpsAlertService;
import com.yogimangchi.trading.ops.OpsErrorBuffer;
import com.yogimangchi.trading.ops.RequestIdMdcFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.json.ProblemDetailJacksonMixin;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.filter.OncePerRequestFilter;

public class TradingTokenFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(TradingTokenFilter.class);
    private static final ObjectMapper PROBLEM_MAPPER = JsonMapper.builder()
            .addMixIn(ProblemDetail.class, ProblemDetailJacksonMixin.class)
            .build();

    private final TradingCredentials credentials;
    private final OpsErrorBuffer errorBuffer;
    private final OpsAlertService alerts;

    public TradingTokenFilter(TradingCredentials credentials) {
        this(credentials, null, null);
    }

    public TradingTokenFilter(TradingCredentials credentials, OpsErrorBuffer errorBuffer, OpsAlertService alerts) {
        this.credentials = credentials;
        this.errorBuffer = errorBuffer;
        this.alerts = alerts;
    }

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

    private static boolean isDbOutageTolerantAdminReadPath(HttpServletRequest request) {
        if (!"GET".equals(request.getMethod())) {
            return false;
        }
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return path.equals("/api/v1/trading/admin/ops/summary")
                || path.equals("/actuator/info")
                || path.equals("/actuator/metrics")
                || path.startsWith("/actuator/metrics/");
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
            String rawToken = header.startsWith("Bearer ") && header.length() <= 8199 ? header.substring(7) : null;
            try {
                if (rawToken != null) {
                    principal = credentials.authenticate(rawToken);
                }
            } catch (MemberSuspendedException suspended) {
                if (optional) {
                    chain.doFilter(request, response);
                    return;
                }
                problem(request, response, ErrorCode.MEMBER_SUSPENDED.status().value(),
                        ErrorCode.MEMBER_SUSPENDED.name(), ErrorCode.MEMBER_SUSPENDED.message());
                return;
            } catch (DataAccessException | CannotCreateTransactionException exception) {
                if (optional) {
                    chain.doFilter(request, response);
                    return;
                }
                if (rawToken != null && isDbOutageTolerantAdminReadPath(request)) {
                    var degradedAdmin = credentials.authenticateDegradedAdmin(rawToken);
                    if (degradedAdmin.isPresent()) {
                        log.warn("[Auth] DB outage degraded read-only ADMIN auth granted path={} memberId={}",
                                request.getRequestURI(), degradedAdmin.get().memberId());
                        setSecurityContext(degradedAdmin.get());
                        chain.doFilter(request, response);
                        return;
                    }
                }
                recordAuthUnavailable(request, response, exception);
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
            setSecurityContext(principal.get());
        }
        chain.doFilter(request, response);
    }

    private void setSecurityContext(TradingPrincipal principal) {
        var authorities = new java.util.ArrayList<SimpleGrantedAuthority>();
        if (principal.accountId() != null) authorities.add(new SimpleGrantedAuthority("ROLE_TRADER"));
        if (principal.memberId() != null) authorities.add(new SimpleGrantedAuthority("ROLE_MEMBER"));
        if (principal.isAdmin()) authorities.add(new SimpleGrantedAuthority("ROLE_ADMIN"));
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, authorities));
    }

    private void recordAuthUnavailable(HttpServletRequest request, HttpServletResponse response, RuntimeException exception) {
        String method = request != null ? request.getMethod() : null;
        String uri = request != null ? request.getRequestURI() : null;
        String sanitizedUri = OpsErrorBuffer.sanitizeUri(uri);
        String reqId = resolveRequestId(request, response);
        String rootCause = rootCauseName(exception);
        String topFrame = OpsErrorBuffer.extractTopAppFrame(exception);
        log.error("[Auth] authentication unavailable method={} uri={} reqId={} rootCause={} topFrame={}",
                method, sanitizedUri, reqId, rootCause, topFrame, exception);
        if (errorBuffer != null) {
            errorBuffer.record(503, "AUTHENTICATION_UNAVAILABLE", method, sanitizedUri, reqId, rootCause, topFrame);
        }
        if (alerts != null) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("status", 503);
            details.put("code", "AUTHENTICATION_UNAVAILABLE");
            if (method != null) details.put("method", method);
            if (sanitizedUri != null) details.put("uri", sanitizedUri);
            if (reqId != null) details.put("requestId", reqId);
            details.put("rootCause", rootCause);
            if (topFrame != null) details.put("topAppFrame", topFrame);
            alerts.alert("trading-auth-503:" + (sanitizedUri != null ? sanitizedUri : "unknown"),
                    "CRITICAL", "Trading authentication unavailable (DB/pool outage)", details);
        }
    }

    private static String rootCauseName(Throwable throwable) {
        Throwable cursor = throwable;
        int depth = 0;
        while (cursor.getCause() != null && cursor.getCause() != cursor && depth < 16) {
            cursor = cursor.getCause();
            depth++;
        }
        return cursor.getClass().getSimpleName();
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
