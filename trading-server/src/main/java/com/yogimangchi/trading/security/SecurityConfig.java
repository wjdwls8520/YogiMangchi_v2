package com.yogimangchi.trading.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.Http403ForbiddenEntryPoint;

@Configuration(proxyBeanMethods = false)
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, Environment environment) throws Exception {
        boolean localDocsEnabled = environment.acceptsProfiles(Profiles.of("local & !prod"))
                && environment.getProperty("springdoc.api-docs.enabled", Boolean.class, false);

        http.authorizeHttpRequests(authorize -> {
            authorize.requestMatchers(HttpMethod.GET, "/api/v1/symbols").permitAll();
            if (localDocsEnabled) {
                authorize.requestMatchers(
                        "/v3/api-docs", "/v3/api-docs/**", "/v3/api-docs.yaml",
                        "/swagger-ui.html", "/swagger-ui/**"
                ).permitAll();
            }
            authorize.anyRequest().denyAll();
        });
        http.formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .exceptionHandling(exceptions ->
                        exceptions.authenticationEntryPoint(new Http403ForbiddenEntryPoint()));

        return http.build();
    }
}
