package com.yogimangchi.content.ops;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdMdcFilter extends OncePerRequestFilter {
    public static final String HEADER_NAME = "X-Request-Id";
    public static final String MDC_KEY = "reqId";
    public static final String REQUEST_ATTR = RequestIdMdcFilter.class.getName() + ".REQ_ID";
    private static final Pattern SAFE_REQUEST_ID = Pattern.compile("^[A-Za-z0-9._-]{8,64}$");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String sanitized = sanitize(request.getHeader(HEADER_NAME));
        String reqId = sanitized != null ? sanitized : generateId();
        MDC.put(MDC_KEY, reqId);
        request.setAttribute(REQUEST_ATTR, reqId);
        response.setHeader(HEADER_NAME, reqId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }

    public static String sanitize(String candidate) {
        if (candidate == null) {
            return null;
        }
        String trimmed = candidate.strip();
        return SAFE_REQUEST_ID.matcher(trimmed).matches() ? trimmed : null;
    }

    public static String currentOrGenerate() {
        String existing = sanitize(MDC.get(MDC_KEY));
        return existing != null ? existing : generateId();
    }

    public static String generateId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }
}
