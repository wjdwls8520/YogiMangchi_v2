package com.yogimangchi.content.auth.security;

import com.yogimangchi.content.error.ApiErrors;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.filter.OncePerRequestFilter;

public class ActiveMemberFilter extends OncePerRequestFilter {
    private final JdbcTemplate jdbc;
    public ActiveMemberFilter(JdbcTemplate jdbc) {this.jdbc=jdbc;}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        var auth=SecurityContextHolder.getContext().getAuthentication();
        String path=request.getRequestURI().substring(request.getContextPath().length());
        if(auth!=null && auth.getPrincipal() instanceof Jwt jwt && !path.equals("/api/v1/members/me/withdrawal")) {
            if(!Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from content.member where id=? and status='ACTIVE')",Boolean.class,Long.valueOf(jwt.getSubject())))) {
                ApiErrors.write(response,401,"MEMBER_NOT_ACTIVE");return;
            }
        }
        chain.doFilter(request,response);
    }
}
