package com.yogimangchi.trading.tradingaccount.security;

import java.nio.file.*;
import java.net.URI;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jwt.*;

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name="trading.member-auth.enabled",havingValue="true")
public class MemberJwtConfiguration {
    @Bean
    RSAPublicKey contentPublicKey(@Value("${trading.member-auth.public-key-path}") String path,
            @Value("${trading.member-auth.issuer}") String issuer,org.springframework.core.env.Environment environment) throws java.io.IOException {
        URI uri=URI.create(issuer);
        if(uri.getHost()==null || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null
                || !(uri.getScheme().equals("https") || uri.getScheme().equals("http") && java.util.Set.of("localhost","127.0.0.1").contains(uri.getHost())))
            throw new IllegalArgumentException("A trusted Content issuer is required");
        if(environment.acceptsProfiles(org.springframework.core.env.Profiles.of("prod")) && !uri.getScheme().equals("https"))
            throw new IllegalArgumentException("Production JWT issuer must use HTTPS");
        RSAPublicKey key;
        try(var input=Files.newInputStream(Path.of(path))) { key=RsaKeyConverters.x509().convert(input); }
        if(key==null || key.getModulus().bitLength()<2048) throw new IllegalArgumentException("RSA public key of at least2048 bits required");
        return key;
    }
    @Bean("memberJwtDecoder")
    JwtDecoder memberJwtDecoder(RSAPublicKey key,@Value("${trading.member-auth.issuer}") String issuer) {
        var decoder=NimbusJwtDecoder.withPublicKey(key).build();
        OAuth2TokenValidator<Jwt> contract=jwt -> {
            try {
                long id=Long.parseLong(jwt.getSubject());
                boolean valid=id>0 && jwt.getExpiresAt()!=null && jwt.getIssuedAt()!=null && jwt.getExpiresAt().isAfter(jwt.getIssuedAt())
                        && Duration.between(jwt.getIssuedAt(),jwt.getExpiresAt()).compareTo(Duration.ofMinutes(15))<=0
                        && jwt.getAudience()!=null && jwt.getAudience().contains("trading") && "access".equals(jwt.getClaimAsString("token_use"))
                        && jwt.getClaimAsStringList("roles")!=null && jwt.getClaimAsStringList("roles").stream().anyMatch(role -> role.equals("MEMBER") || role.equals("ADMIN"));
                return valid ? OAuth2TokenValidatorResult.success() : invalid();
            } catch(RuntimeException failure) { return invalid(); }
        };
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(new JwtTimestampValidator(Duration.ZERO),new JwtIssuerValidator(issuer),contract));
        return decoder;
    }
    private static OAuth2TokenValidatorResult invalid() { return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token")); }
}
