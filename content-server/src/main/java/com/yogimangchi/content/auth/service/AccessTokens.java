package com.yogimangchi.content.auth.service;

import com.yogimangchi.content.auth.dto.AccessResponse;
import com.yogimangchi.content.member.entity.Member;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Service;

@Service
public class AccessTokens {
    private final JwtEncoder encoder;
    private final String issuer;
    private final String keyId;
    public AccessTokens(JwtEncoder encoder,@Value("${content.auth.issuer}") String issuer,@Value("${content.auth.key-id}") String keyId) {
        this.encoder=encoder; this.issuer=issuer; this.keyId=keyId;
    }
    public AccessResponse issue(Member member,Instant now) {
        Instant expires=now.plus(Duration.ofMinutes(15));
        var claims=JwtClaimsSet.builder().issuer(issuer).subject(member.getId().toString()).issuedAt(now).expiresAt(expires)
                .audience(List.of("content","trading")).id(UUID.randomUUID().toString())
                .claim("token_use","access").claim("roles",List.of(member.getRole().name())).build();
        String token=encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).keyId(keyId).build(),claims)).getTokenValue();
        return new AccessResponse(member.getId(),member.getNickname(),token,"Bearer",900,expires);
    }
}
