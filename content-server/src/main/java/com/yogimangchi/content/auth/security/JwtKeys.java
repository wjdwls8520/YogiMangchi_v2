package com.yogimangchi.content.auth.security;

import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import java.io.IOException;
import java.net.URI;
import java.nio.file.*;
import java.security.*;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.RSAPublicKeySpec;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.web.bind.annotation.*;

@Configuration(proxyBeanMethods=false)
public class JwtKeys {
    @Bean
    RSAKey signingKey(@Value("${content.auth.private-key-path}") String path,@Value("${content.auth.key-id}") String keyId,
            @Value("${content.auth.issuer}") String issuer,@Value("${content.auth.secure-cookies}") boolean secure) throws IOException,GeneralSecurityException {
        URI uri=URI.create(issuer);
        if(uri.getHost()==null || uri.getQuery()!=null || uri.getFragment()!=null || uri.getUserInfo()!=null
                || !(uri.getScheme().equals("https") || !secure && uri.getScheme().equals("http"))
                || !keyId.matches("[A-Za-z0-9_-]{1,64}")) throw new IllegalArgumentException("Invalid JWT issuer/key configuration");
        RSAPrivateKey privateKey;
        try(var input=Files.newInputStream(Path.of(path))) { privateKey=RsaKeyConverters.pkcs8().convert(input); }
        if(!(privateKey instanceof RSAPrivateCrtKey crt) || crt.getModulus().bitLength()<2048) throw new IllegalArgumentException("PKCS8 RSA key of at least 2048 bits is required");
        var publicKey=(RSAPublicKey)KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(crt.getModulus(),crt.getPublicExponent()));
        return new RSAKey.Builder(publicKey).privateKey(privateKey).keyID(keyId).build();
    }
    @Bean JwtEncoder jwtEncoder(RSAKey key) { return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key))); }
    @Bean JwtDecoder jwtDecoder(RSAKey key,@Value("${content.auth.issuer}") String issuer) throws java.text.ParseException,com.nimbusds.jose.JOSEException {
        var decoder=NimbusJwtDecoder.withPublicKey(key.toRSAPublicKey()).build();
        OAuth2TokenValidator<Jwt> contract=jwt -> jwt.getExpiresAt()!=null && jwt.getIssuedAt()!=null
                && jwt.getAudience()!=null && jwt.getAudience().contains("content") && "access".equals(jwt.getClaimAsString("token_use"))
                && validSubject(jwt.getSubject())
                ? OAuth2TokenValidatorResult.success() : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(new JwtTimestampValidator(java.time.Duration.ZERO),new JwtIssuerValidator(issuer),contract));
        return decoder;
    }
    private static boolean validSubject(String value) {
        if(value==null || !value.matches("[1-9][0-9]{0,18}")) return false;
        try { return Long.parseLong(value)>0; } catch(NumberFormatException failure) { return false; }
    }

    @RestController
    public static class PublicKeys {
        private final RSAKey key;
        public PublicKeys(RSAKey key) { this.key=key; }
        @GetMapping(value="/.well-known/jwks.json",produces="application/json")
        public Map<String,Object> jwks() { return new JWKSet(key.toPublicJWK()).toJSONObject(); }
    }
}
