package com.yogimangchi.content.auth.security;

import com.yogimangchi.content.error.ApiErrors;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.NullSecurityContextRepository;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.web.cors.*;

@Configuration(proxyBeanMethods=false)
public class SecurityConfig {
    @Bean @Order(2)
    SecurityFilterChain apiChain(HttpSecurity http,CorsConfigurationSource cors,@Value("${springdoc.api-docs.enabled}") boolean docs,org.springframework.jdbc.core.JdbcTemplate jdbc,
            @Value("${content.auth.nickname-lookups-per-minute:300}") int nicknameLookups) throws Exception {
        http.authorizeHttpRequests(a -> {
            a.requestMatchers(HttpMethod.GET,"/actuator/health","/actuator/health/liveness","/actuator/health/readiness").permitAll();
            a.requestMatchers(HttpMethod.GET,"/actuator/info","/actuator/metrics","/actuator/metrics/**").hasRole("ADMIN");
            a.requestMatchers(HttpMethod.GET,"/.well-known/jwks.json","/api/v1/auth/csrf","/api/v1/auth/flow","/api/v1/policies/current","/api/v1/policies/{type:TERMS|PRIVACY}/{version}").permitAll();
            a.requestMatchers(HttpMethod.POST,"/api/v1/auth/signup","/api/v1/auth/login/complete","/api/v1/auth/refresh","/api/v1/auth/logout","/api/v1/news/{newsId:[0-9]+}/reactions","/api/v1/news/{newsId:[0-9]+}/views").permitAll();
            a.requestMatchers(HttpMethod.POST,"/api/v1/auth/logout-all").authenticated();
            a.requestMatchers(HttpMethod.GET,"/api/v1/members/me","/api/v1/members/me/consents","/api/v1/members/me/withdrawal","/api/v1/members/me/community/posts","/api/v1/members/me/community/comments","/api/v1/members/me/community/liked-posts","/api/v1/members/me/community/liked-comments","/api/v1/members/me/community/reports").authenticated();
            a.requestMatchers(HttpMethod.POST,"/api/v1/members/me/consents","/api/v1/members/me/profile").authenticated();
            a.requestMatchers(HttpMethod.PATCH,"/api/v1/members/me/profile").authenticated();
            a.requestMatchers(HttpMethod.POST,"/api/v1/members/me/withdrawal").authenticated();
            a.requestMatchers(HttpMethod.PUT,"/api/v1/members/{memberId:[0-9]+}/follows").authenticated();
            a.requestMatchers(HttpMethod.DELETE,"/api/v1/members/{memberId:[0-9]+}/follows").authenticated();
            a.requestMatchers(HttpMethod.GET,"/api/v1/members/{memberId:[0-9]+}/follows","/api/v1/members/{memberId:[0-9]+}/followers","/api/v1/members/{memberId:[0-9]+}/followings","/api/v1/members/{memberId:[0-9]+}/community/posts","/api/v1/members/{memberId:[0-9]+}/community/comments","/api/v1/members/{memberId:[0-9]+}/community/liked-posts","/api/v1/members/{memberId:[0-9]+}/community/liked-comments").permitAll();
            a.requestMatchers(HttpMethod.GET,"/api/v1/members/{memberId:[0-9]+}","/api/v1/members/nickname/availability").permitAll();
            a.requestMatchers(HttpMethod.GET,"/api/v1/news","/api/v1/news/highlights","/api/v1/news/stream","/api/v1/news/{newsId:[0-9]+}","/api/v1/community/posts","/api/v1/community/posts/latest-check","/api/v1/community/posts/{postId:[0-9]+}","/api/v1/community/posts/{postId:[0-9]+}/comments","/api/v1/community/ux/subscribe/feed","/api/v1/community/local-media/**","/api/v1/community/report-reasons","/api/v1/report/type/community").permitAll();
            a.requestMatchers(HttpMethod.POST,"/api/v1/community/posts","/api/v1/community/posts/{postId:[0-9]+}/comments").authenticated();
            a.requestMatchers(HttpMethod.PATCH,"/api/v1/community/posts/{postId:[0-9]+}","/api/v1/community/comments/{commentId:[0-9]+}","/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}").authenticated();
            a.requestMatchers(HttpMethod.PUT,"/api/v1/community/posts/{postId:[0-9]+}","/api/v1/community/posts/{postId:[0-9]+}/likes","/api/v1/community/posts/{postId:[0-9]+}/reports","/api/v1/community/comments/{commentId:[0-9]+}/likes","/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}/likes","/api/v1/community/comments/{commentId:[0-9]+}/reports","/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}/reports").authenticated();
            a.requestMatchers(HttpMethod.DELETE,"/api/v1/community/posts/{postId:[0-9]+}","/api/v1/community/posts/{postId:[0-9]+}/likes","/api/v1/community/posts/{postId:[0-9]+}/reports","/api/v1/community/comments/{commentId:[0-9]+}","/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}","/api/v1/community/comments/{commentId:[0-9]+}/likes","/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}/likes","/api/v1/community/comments/{commentId:[0-9]+}/reports","/api/v1/community/posts/{postId:[0-9]+}/comments/{commentId:[0-9]+}/reports").authenticated();
            a.requestMatchers(HttpMethod.POST,"/api/v1/support/inquiries").hasRole("MEMBER");
            a.requestMatchers(HttpMethod.GET,"/api/v1/support/inquiries/me").hasRole("MEMBER");
            a.requestMatchers(HttpMethod.GET,"/api/v1/admin/members","/api/v1/admin/community/posts","/api/v1/admin/community/posts/active-author","/api/v1/admin/community/posts/withdrawn-author","/api/v1/admin/community/replies","/api/v1/admin/community/replies/active-author","/api/v1/admin/community/replies/withdrawn-author","/api/v1/admin/community/reports").hasRole("ADMIN");
            a.requestMatchers(HttpMethod.DELETE,"/api/v1/admin/members/{memberId:[0-9]+}","/api/v1/admin/community/posts/{postId:[0-9]+}","/api/v1/admin/community/replies/{replyId:[0-9]+}","/api/v1/admin/community/reports/{targetType}/{targetId:[0-9]+}/reporters/{reporterId:[0-9]+}").hasRole("ADMIN");
            a.requestMatchers(HttpMethod.POST,"/api/v1/admin/members/{memberId:[0-9]+}/suspend","/api/v1/admin/members/{memberId:[0-9]+}/unsuspend","/api/v1/admin/community/posts/{postId:[0-9]+}/restore","/api/v1/admin/community/reports/{targetType}/{targetId:[0-9]+}/moderate").hasRole("ADMIN");
            a.requestMatchers(HttpMethod.GET,"/api/v1/admin/support/**","/api/v1/admin/ops/**").hasRole("ADMIN");
            a.requestMatchers(HttpMethod.POST,"/api/v1/admin/support/**","/api/v1/admin/ops/**").hasRole("ADMIN");
            a.requestMatchers(HttpMethod.GET,"/api/v1/notifications","/api/v1/notifications/status","/api/v1/notifications/subscribe").authenticated();
            a.requestMatchers(HttpMethod.PUT,"/api/v1/notifications/check","/api/v1/notifications/read","/api/v1/notifications/read-all","/api/v1/notifications/{notificationId:[0-9]+}/read").authenticated();
            a.requestMatchers(HttpMethod.DELETE,"/api/v1/notifications","/api/v1/notifications/read","/api/v1/notifications/{notificationId:[0-9]+}").authenticated();
            if(docs) a.requestMatchers("/v3/api-docs","/v3/api-docs/**","/v3/api-docs.yaml","/swagger-ui.html","/swagger-ui/**").permitAll();
            a.anyRequest().denyAll();
        }).cors(c -> c.configurationSource(cors))
                .csrf(c -> c.csrfTokenRepository(new HttpSessionCsrfTokenRepository())
                        .requireCsrfProtectionMatcher(r -> {
                            String path = r.getRequestURI().substring(r.getContextPath().length());
                            boolean cookieAuthPath = (path.startsWith("/api/v1/auth/") && !path.equals("/api/v1/auth/logout-all"))
                                    || path.equals("/api/v1/members/me/withdrawal");
                            return cookieAuthPath && !Set.of("GET","HEAD","OPTIONS","TRACE").contains(r.getMethod());
                        }))
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .securityContext(c -> c.securityContextRepository(new NullSecurityContextRepository()))
                .oauth2ResourceServer(o -> o.bearerTokenResolver(request -> {
                    // Cookie-authenticated auth endpoints never use Bearer auth; logout-all requires Bearer auth.
                    String path=request.getRequestURI().substring(request.getContextPath().length());
                    return (path.startsWith("/api/v1/auth/") && !path.equals("/api/v1/auth/logout-all"))
                            ? null
                            : new org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver().resolve(request);
                }).jwt(j -> { })
                        .authenticationEntryPoint((request,response,e) -> ApiErrors.write(response,401,"INVALID_ACCESS_TOKEN")))
                .formLogin(c -> c.disable()).httpBasic(c -> c.disable()).logout(c -> c.disable()).requestCache(c -> c.disable())
                .exceptionHandling(e -> e.authenticationEntryPoint((request,response,failure) -> ApiErrors.write(response,401,"AUTHENTICATION_REQUIRED"))
                        .accessDeniedHandler((request,response,failure) -> ApiErrors.write(response,403,
                                failure instanceof org.springframework.security.web.csrf.CsrfException ? "CSRF_INVALID" : "ACCESS_DENIED")));
        // Keep the existing auth CSRF protection. Add protection for the OAuth-cookie/Bearer
        // withdrawal flow, because Resource Server's default Bearer exemption would skip it.
        http.addFilterBefore(new WithdrawalCsrfFilter(),org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter.class);
        http.addFilterAfter(new ActiveMemberFilter(jdbc),org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter.class);
        http.addFilterAfter(new NicknameLookupLimit(nicknameLookups),org.springframework.security.web.authentication.logout.LogoutFilter.class);
        return http.build();
    }
    @Bean CorsConfigurationSource cors(@Value("${content.auth.allowed-origins}") String value) {
        List<String> origins=Arrays.stream(value.split(",")).map(String::trim).filter(v -> !v.isEmpty()).toList();
        if(origins.isEmpty() || origins.stream().anyMatch(v -> v.contains("*"))) throw new IllegalArgumentException("Explicit Content origins required");
        var config=new CorsConfiguration(); config.setAllowedOrigins(origins); config.setAllowCredentials(true);
        config.setAllowedMethods(List.of("GET","POST","PUT","DELETE","PATCH","OPTIONS")); config.setAllowedHeaders(List.of("Authorization","Content-Type","X-CSRF-TOKEN","X-Anon-Viewer-Id","Last-Event-ID","X-Request-Id"));
        config.setExposedHeaders(List.of("Retry-After","X-Request-Id"));
        config.setMaxAge(600L);
        var source=new UrlBasedCorsConfigurationSource(); source.registerCorsConfiguration("/api/**",config); return source;
    }
}
