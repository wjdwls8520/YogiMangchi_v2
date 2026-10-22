package com.yogimangchi.trading.tradingaccount.security;

import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.web.SecurityFilterChain;

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name="trading.member-auth.enabled",havingValue="true")
public class WithdrawalSecurity {
    @Bean @Order(0)
    SecurityFilterChain withdrawalChain(HttpSecurity http,RSAPublicKey key,@Value("${trading.member-auth.issuer}") String issuer) throws Exception {
        var decoder=NimbusJwtDecoder.withPublicKey(key).build();
        OAuth2TokenValidator<Jwt> contract=jwt -> {
            try {
                boolean valid=jwt.getSubject().matches("[1-9][0-9]{0,18}") && Long.parseLong(jwt.getSubject())>0
                        && jwt.getIssuedAt()!=null && !jwt.getIssuedAt().isAfter(java.time.Instant.now()) && jwt.getExpiresAt()!=null && jwt.getExpiresAt().isAfter(jwt.getIssuedAt())
                        && Duration.between(jwt.getIssuedAt(),jwt.getExpiresAt()).compareTo(Duration.ofSeconds(60))<=0
                        && List.of("trading-internal").equals(jwt.getAudience()) && "member_withdrawal".equals(jwt.getClaimAsString("token_use"));
                return valid ? OAuth2TokenValidatorResult.success() : invalid();
            } catch(RuntimeException failure) { return invalid(); }
        };
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(new JwtTimestampValidator(Duration.ZERO),new JwtIssuerValidator(issuer),contract));
        http.securityMatcher("/internal/**")
                .authorizeHttpRequests(a -> a.requestMatchers(HttpMethod.POST,"/internal/v1/members/{memberId:[0-9]+}/withdrawal").authenticated().anyRequest().denyAll())
                .oauth2ResourceServer(o -> o.jwt(j -> j.decoder(decoder))
                        .authenticationEntryPoint((request,response,error) -> TradingTokenFilter.problem(response,401,"INVALID_WITHDRAWAL_CREDENTIAL","A dedicated Content withdrawal credential is required")))
                .exceptionHandling(e -> e.authenticationEntryPoint((request,response,error) -> TradingTokenFilter.problem(response,401,"INVALID_WITHDRAWAL_CREDENTIAL","A dedicated Content withdrawal credential is required"))
                        .accessDeniedHandler((request,response,error) -> TradingTokenFilter.problem(response,403,"ACCESS_DENIED","Access is denied")))
                .csrf(c -> c.disable()).cors(c -> c.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(c -> c.disable()).formLogin(c -> c.disable()).httpBasic(c -> c.disable()).logout(c -> c.disable());
        return http.build();
    }
    private static OAuth2TokenValidatorResult invalid() { return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token")); }
}
