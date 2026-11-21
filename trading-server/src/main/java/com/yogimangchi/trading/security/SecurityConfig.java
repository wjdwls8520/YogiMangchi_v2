package com.yogimangchi.trading.security;

import com.yogimangchi.trading.tradingaccount.security.TradingCredentials;
import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import com.yogimangchi.trading.tradingaccount.security.TradingTokenFilter;
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
    SecurityFilterChain securityFilterChain(HttpSecurity http, TradingCredentials credentials,
            @Value("${springdoc.api-docs.enabled:true}") boolean docs) throws Exception {
        http.authorizeHttpRequests(authorize -> {
            authorize.requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness").permitAll();
            authorize.requestMatchers(HttpMethod.GET, "/actuator/info", "/actuator/metrics", "/actuator/metrics/**").hasRole("ADMIN");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/symbols").permitAll();
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/market/tickers").permitAll();
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/market/overview").permitAll();
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/market/candles").permitAll();
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/status").permitAll();
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/portfolios/members/{memberId:[0-9]+}").permitAll();
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/contest/public/**").permitAll();
            authorize.requestMatchers("/api/v1/trading/contest/**").hasRole("MEMBER");
            authorize.requestMatchers("/api/v1/trading/notifications", "/api/v1/trading/notifications/**").hasRole("MEMBER");
            authorize.requestMatchers("/api/v1/trading/admin/contest/**").hasRole("ADMIN");
            authorize.requestMatchers("/api/v1/trading/admin/ops/**").hasRole("ADMIN");
            authorize.requestMatchers("/api/v1/trading/admin/symbols", "/api/v1/trading/admin/symbols/**").hasRole("ADMIN");
            authorize.requestMatchers(HttpMethod.GET, "/ws/market").permitAll();
            // /ws/trading requires an authenticated first frame before any account data is read/sent.
            authorize.requestMatchers(HttpMethod.GET, "/ws/trading").permitAll();
            authorize.requestMatchers(HttpMethod.POST, "/api/v1/trading/accounts/guest").permitAll();
            authorize.requestMatchers(HttpMethod.POST, "/api/v1/trading/accounts/member").hasRole("MEMBER");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/account/portfolio-visibility").hasRole("MEMBER");
            authorize.requestMatchers(HttpMethod.PUT, "/api/v1/trading/account/portfolio-visibility").hasRole("MEMBER");
            authorize.requestMatchers(HttpMethod.POST,"/api/v1/trading/account/restart").hasRole("MEMBER");
            authorize.requestMatchers(HttpMethod.GET,"/api/v1/trading/account/rounds","/api/v1/trading/account/rounds/current","/api/v1/trading/account/rounds/{roundId:[0-9]+}","/api/v1/trading/account/rounds/{roundId:[0-9]+}/{kind:orders|fills|positions}").hasRole("MEMBER");
            authorize.requestMatchers(HttpMethod.POST, "/api/v1/trading/account/retry").authenticated();
            authorize.requestMatchers(HttpMethod.POST,"/api/v1/trading/account/command-results/query").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET,"/api/v1/trading/account/orders/{orderId:[0-9]+}").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET,"/api/v1/trading/account/positions/{positionId}/stop-loss").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.PUT,"/api/v1/trading/account/positions/{positionId}/stop-loss").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.DELETE,"/api/v1/trading/account/positions/{positionId}/stop-loss").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET,"/api/v1/trading/account/positions/{positionId}/take-profit").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.PUT,"/api/v1/trading/account/positions/{positionId}/take-profit").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.DELETE,"/api/v1/trading/account/positions/{positionId}/take-profit").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.PATCH, "/api/v1/trading/account/orders/{orderId:[0-9]+}").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.POST, "/api/v1/trading/account/orders",
                    "/api/v1/trading/account/orders/quote",
                    "/api/v1/trading/account/orders/cancel-all",
                    "/api/v1/trading/account/orders/{orderId}/amend",
                    "/api/v1/trading/account/orders/{orderId}/cancel",
                    "/api/v1/trading/account/positions/close-all",
                    "/api/v1/trading/account/positions/{positionId}/close",
                    "/api/v1/trading/account/positions/{positionId}/close-orders").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/account/orders", "/api/v1/trading/account/orders/pending").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/account/fills", "/api/v1/trading/account/positions/history").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/account/performance/symbols").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/account/recovery").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/account/events").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/account/symbols/{symbolId}/leverage").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.PUT, "/api/v1/trading/account/symbols/{symbolId}/leverage").hasRole("TRADER");
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/trading/account/wallet",
                    "/api/v1/trading/account/positions", "/api/v1/trading/account/summary").hasRole("TRADER");
            if(docs) authorize.requestMatchers(
                    "/v3/api-docs", "/v3/api-docs/**", "/v3/api-docs.yaml",
                    "/swagger-ui.html", "/swagger-ui/**"
            ).permitAll();
            authorize.anyRequest().denyAll();
        });
        http.cors(cors -> { })
                .csrf(csrf -> csrf.ignoringRequestMatchers("/api/v1/trading/**"))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .addFilterBefore(new TradingTokenFilter(credentials), AnonymousAuthenticationFilter.class)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .exceptionHandling(exceptions -> exceptions.authenticationEntryPoint((request, response, failure) -> {
                    String path = request.getRequestURI().substring(request.getContextPath().length());
                    if (path.startsWith("/api/v1/trading/")) {
                        if ("POST".equals(request.getMethod()) && path.equals("/api/v1/trading/accounts/member")
                                || path.equals("/api/v1/trading/account/portfolio-visibility")
                                || path.startsWith("/api/v1/trading/contest/")
                                || path.startsWith("/api/v1/trading/notifications")
                                || path.startsWith("/api/v1/trading/admin/")) {
                            TradingTokenFilter.problem(request, response, 401, "MEMBER_CREDENTIAL_REQUIRED", "A Content member Access JWT is required");
                            return;
                        }
                        TradingTokenFilter.problem(request, response, 401, "GUEST_CREDENTIAL_REQUIRED", "A guest bearer credential is required");
                    } else new Http403ForbiddenEntryPoint().commence(request, response, failure);
                }).accessDeniedHandler((request, response, failure) -> {
                    String path = request.getRequestURI().substring(request.getContextPath().length());
                    var authentication=org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
                    if(!path.startsWith("/api/v1/trading/admin/")
                            && !path.startsWith("/api/v1/trading/contest/")
                            && !path.startsWith("/api/v1/trading/notifications")
                            && authentication!=null && authentication.getPrincipal() instanceof TradingPrincipal principal
                            && principal.memberId()!=null && principal.accountId()==null) {
                        TradingTokenFilter.problem(request, response,409,"TRADING_ACCOUNT_REQUIRED","Explicitly open your own member trading account first"); return;
                    }
                    TradingTokenFilter.problem(request, response, 403, "ACCESS_DENIED", "Access is denied");
                }));

        return http.build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${trading.http.allowed-origins:http://localhost:3000,http://127.0.0.1:3000}") String origins) {
        List<String> allowed = Arrays.stream(origins.split(",")).map(String::strip).filter(origin -> !origin.isBlank()).toList();
        if (allowed.isEmpty() || allowed.stream().anyMatch(origin -> origin.contains("*"))) {
            throw new IllegalArgumentException("REST CORS requires explicit origins");
        }
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(allowed);
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key", "Last-Event-ID", "X-Request-Id"));
        configuration.setExposedHeaders(List.of("X-Request-Id", "Retry-After"));
        configuration.setAllowCredentials(false);
        configuration.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        return source;
    }
}
