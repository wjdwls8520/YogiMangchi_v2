package com.yogimangchi.trading.security;

import com.yogimangchi.trading.tradingaccount.security.GuestCredentialService;
import com.yogimangchi.trading.tradingaccount.security.GuestTokenFilter;
import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.Http403ForbiddenEntryPoint;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration(proxyBeanMethods = false)
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, GuestCredentialService credentials) throws Exception {
        http.authorizeHttpRequests(authorize -> {
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/symbols").permitAll();
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/status").permitAll();
            authorize.requestMatchers(HttpMethod.GET, "/ws/market").permitAll();
            authorize.requestMatchers(HttpMethod.POST, "/api/v1/trading/accounts/guest").permitAll();
            authorize.requestMatchers(HttpMethod.POST, "/api/v1/trading/account/orders",
                    "/api/v1/trading/account/orders/{orderId}/cancel",
                    "/api/v1/trading/account/positions/{positionId}/close").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/account/orders", "/api/v1/trading/account/orders/pending").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/account/wallet",
                    "/api/v1/trading/account/positions", "/api/v1/trading/account/summary").hasRole("TRADER");
            authorize.requestMatchers(
                    "/v3/api-docs", "/v3/api-docs/**", "/v3/api-docs.yaml",
                    "/swagger-ui.html", "/swagger-ui/**"
            ).permitAll();
            authorize.anyRequest().denyAll();
        });
        http.cors(cors -> { })
                .csrf(csrf -> csrf.ignoringRequestMatchers("/api/v1/trading/**"))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .addFilterBefore(new GuestTokenFilter(credentials), AnonymousAuthenticationFilter.class)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .exceptionHandling(exceptions -> exceptions.authenticationEntryPoint((request, response, failure) -> {
                    if (request.getRequestURI().substring(request.getContextPath().length()).startsWith("/api/v1/trading/")) {
                        GuestTokenFilter.problem(response, 401, "GUEST_CREDENTIAL_REQUIRED", "A guest bearer credential is required");
                    } else new Http403ForbiddenEntryPoint().commence(request, response, failure);
                }).accessDeniedHandler((request, response, failure) -> {
                    GuestTokenFilter.problem(response, 403, "ACCESS_DENIED", "Access is denied");
                }));

        return http.build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${trading.http.allowed-origins:http://localhost:5173,http://127.0.0.1:5173}") String origins) {
        List<String> allowed = Arrays.stream(origins.split(",")).map(String::strip).filter(origin -> !origin.isBlank()).toList();
        if (allowed.isEmpty() || allowed.stream().anyMatch(origin -> origin.contains("*"))) {
            throw new IllegalArgumentException("REST CORS requires explicit origins");
        }
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(allowed);
        configuration.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key"));
        configuration.setAllowCredentials(false);
        configuration.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        return source;
    }
}
