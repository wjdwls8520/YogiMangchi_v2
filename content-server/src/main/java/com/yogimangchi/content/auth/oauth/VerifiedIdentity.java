package com.yogimangchi.content.auth.oauth;

import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.error.AuthFailure;
import java.io.Serializable;
import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

/** Server-created, short-lived OAuth proof. Never accepted from an API request body. */
public record VerifiedIdentity(Provider provider,String subject,String email,Instant expiresAt) implements Serializable {
    public static final String SESSION_KEY=VerifiedIdentity.class.getName();
    public static VerifiedIdentity from(OAuth2AuthenticationToken token) {
        String subject,email;
        Provider provider;
        if(token.getAuthorizedClientRegistrationId().equals("google") && token.getPrincipal() instanceof OidcUser user) {
            provider=Provider.GOOGLE; subject=user.getSubject(); email=user.getEmail();
            if(!Boolean.TRUE.equals(user.getEmailVerified())) throw emailRequired();
        } else if(token.getAuthorizedClientRegistrationId().equals("kakao")) {
            provider=Provider.KAKAO;
            Object id=token.getPrincipal().getAttribute("id");
            // Kakao's id contract is an integer (Long), not an arbitrary floating-point number/string.
            subject=(id instanceof Long || id instanceof Integer) && ((Number)id).longValue()>0 ? id.toString() : null;
            Object value=token.getPrincipal().getAttribute("kakao_account");
            if(!(value instanceof Map<?,?> account) || !Boolean.TRUE.equals(account.get("is_email_valid")) || !Boolean.TRUE.equals(account.get("is_email_verified"))) throw emailRequired();
            email=account.get("email") instanceof String address ? address : null;
        } else throw AuthFailure.unauthorized();
        if(subject==null || subject.isBlank() || subject.length()>255) throw new AuthFailure("OAUTH_IDENTITY_INVALID",HttpStatus.BAD_REQUEST);
        if(email==null || email.isBlank() || email.length()>320) throw emailRequired();
        return new VerifiedIdentity(provider,subject,email,Instant.now().plusSeconds(300));
    }
    public void requireFresh() { if(expiresAt==null || !expiresAt.isAfter(Instant.now())) throw new AuthFailure("LOGIN_PROOF_EXPIRED",HttpStatus.UNAUTHORIZED); }
    private static AuthFailure emailRequired() { return new AuthFailure("VERIFIED_EMAIL_REQUIRED",HttpStatus.BAD_REQUEST); }
}
