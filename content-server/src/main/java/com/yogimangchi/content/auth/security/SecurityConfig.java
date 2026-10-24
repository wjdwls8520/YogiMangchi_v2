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
            a.requestMatchers(HttpMethod.GET,"/.well-known/jwks.json","/api/v1/auth/csrf","/api/v1/auth/flow","/api/v1/policies/current","/api/v1/policies/{type:TERMS|PRIVACY}/{version}").permitAll();
            a.requestMatchers(HttpMethod.POST,"/api/v1/auth/signup","/api/v1/auth/login/complete","/api/v1/auth/refresh","/api/v1/auth/logout").permitAll();
            a.requestMatchers(HttpMethod.GET,"/api/v1/members/me","/api/v1/members/me/consents","/api/v1/members/me/withdrawal").authenticated();
            a.requestMatchers(HttpMethod.POST,"/api/v1/members/me/consents").authenticated();
            a.requestMatchers(HttpMethod.PATCH,"/api/v1/members/me/profile").authenticated();
            a.requestMatchers(HttpMethod.POST,"/api/v1/members/me/withdrawal").authenticated();
            a.requestMatchers(HttpMethod.PUT,"/api/v1/members/{memberId:[0-9]+}/follows").authenticated();
            a.requestMatchers(HttpMethod.DELETE,"/api/v1/members/{memberId:[0-9]+}/follows").authenticated();
            a.requestMatchers(HttpMethod.GET,"/api/v1/members/{memberId:[0-9]+}/follows","/api/v1/members/{memberId:[0-9]+}/followers","/api/v1/members/{memberId:[0-9]+}/followings").permitAll();
            a.requestMatchers(HttpMethod.GET,"/api/v1/members/{memberId:[0-9]+}","/api/v1/members/nickname/availability").permitAll();
            if(docs) a.requestMatchers("/v3/api-docs","/v3/api-docs/**","/v3/api-docs.yaml","/swagger-ui.html","/swagger-ui/**").permitAll();
            a.anyRequest().denyAll();
        }).cors(c -> c.configurationSource(cors))
                .csrf(c -> c.csrfTokenRepository(new HttpSessionCsrfTokenRepository())
                        .requireCsrfProtectionMatcher(r -> r.getRequestURI().substring(r.getContextPath().length()).matches("/api/v1/auth/.*|/api/v1/members/me/withdrawal")
                                && !Set.of("GET","HEAD","OPTIONS","TRACE").contains(r.getMethod())))
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .securityContext(c -> c.securityContextRepository(new NullSecurityContextRepository()))
                .oauth2ResourceServer(o -> o.bearerTokenResolver(request -> {
                    // Auth endpoints use proof/refresh cookies, never Bearer authentication. Resource
                    // Server's automatic CSRF exemption must not exempt these cookie operations.
                    String path=request.getRequestURI().substring(request.getContextPath().length());
                    return path.startsWith("/api/v1/auth/") ? null : new org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver().resolve(request);
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
        config.setAllowedMethods(List.of("GET","POST","PUT","DELETE","PATCH","OPTIONS")); config.setAllowedHeaders(List.of("Authorization","Content-Type","X-CSRF-TOKEN"));
        config.setExposedHeaders(List.of("Retry-After"));
        config.setMaxAge(600L);
        var source=new UrlBasedCorsConfigurationSource(); source.registerCorsConfiguration("/api/**",config); return source;
    }
}
