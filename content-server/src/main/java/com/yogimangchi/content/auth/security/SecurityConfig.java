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
    SecurityFilterChain apiChain(HttpSecurity http,@Value("${springdoc.api-docs.enabled}") boolean docs) throws Exception {
        http.authorizeHttpRequests(a -> {
            a.requestMatchers(HttpMethod.GET,"/.well-known/jwks.json","/api/v1/auth/csrf","/api/v1/auth/flow").permitAll();
            a.requestMatchers(HttpMethod.POST,"/api/v1/auth/signup","/api/v1/auth/login/complete","/api/v1/auth/refresh","/api/v1/auth/logout").permitAll();
            a.requestMatchers(HttpMethod.GET,"/api/v1/members/me").authenticated();
            if(docs) a.requestMatchers("/v3/api-docs","/v3/api-docs/**","/v3/api-docs.yaml","/swagger-ui.html","/swagger-ui/**").permitAll();
            a.anyRequest().denyAll();
        }).cors(c -> { })
                .csrf(c -> c.csrfTokenRepository(new HttpSessionCsrfTokenRepository())
                        .requireCsrfProtectionMatcher(r -> r.getRequestURI().substring(r.getContextPath().length()).startsWith("/api/v1/auth/")
                                && !Set.of("GET","HEAD","OPTIONS","TRACE").contains(r.getMethod())))
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .securityContext(c -> c.securityContextRepository(new NullSecurityContextRepository()))
                .oauth2ResourceServer(o -> o.jwt(j -> { })
                        .authenticationEntryPoint((request,response,e) -> ApiErrors.write(response,401,"INVALID_ACCESS_TOKEN")))
                .formLogin(c -> c.disable()).httpBasic(c -> c.disable()).logout(c -> c.disable()).requestCache(c -> c.disable())
                .exceptionHandling(e -> e.authenticationEntryPoint((request,response,failure) -> ApiErrors.write(response,401,"AUTHENTICATION_REQUIRED"))
                        .accessDeniedHandler((request,response,failure) -> ApiErrors.write(response,403,"ACCESS_DENIED")));
        return http.build();
    }
    @Bean CorsConfigurationSource cors(@Value("${content.auth.allowed-origins}") String value) {
        List<String> origins=Arrays.stream(value.split(",")).map(String::trim).filter(v -> !v.isEmpty()).toList();
        if(origins.isEmpty() || origins.stream().anyMatch(v -> v.contains("*"))) throw new IllegalArgumentException("Explicit Content origins required");
        var config=new CorsConfiguration(); config.setAllowedOrigins(origins); config.setAllowCredentials(true);
        config.setAllowedMethods(List.of("GET","POST","OPTIONS")); config.setAllowedHeaders(List.of("Authorization","Content-Type","X-CSRF-TOKEN"));
        config.setMaxAge(600L);
        var source=new UrlBasedCorsConfigurationSource(); source.registerCorsConfiguration("/api/**",config); return source;
    }
}
