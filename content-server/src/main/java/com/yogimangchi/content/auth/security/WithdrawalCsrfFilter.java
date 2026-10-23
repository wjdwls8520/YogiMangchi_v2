package com.yogimangchi.content.auth.security;

import com.yogimangchi.content.error.ApiErrors;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.security.web.csrf.*;
import org.springframework.web.filter.OncePerRequestFilter;

/** Additional protection only: Resource Server's Bearer exemption must not exempt an OAuth proof cookie. */
public class WithdrawalCsrfFilter extends OncePerRequestFilter {
    private final HttpSessionCsrfTokenRepository repository=new HttpSessionCsrfTokenRepository();
    private final XorCsrfTokenRequestAttributeHandler handler=new XorCsrfTokenRequestAttributeHandler();
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getMethod().equals("POST") || !request.getRequestURI().substring(request.getContextPath().length()).equals("/api/v1/members/me/withdrawal");
    }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        CsrfToken expected=repository.loadToken(request);
        String actual=expected==null?null:handler.resolveCsrfTokenValue(request,expected);
        if(actual==null || !MessageDigest.isEqual(expected.getToken().getBytes(StandardCharsets.UTF_8),actual.getBytes(StandardCharsets.UTF_8))) {
            ApiErrors.write(response,403,"ACCESS_DENIED");return;
        }
        chain.doFilter(request,response);
    }
}
