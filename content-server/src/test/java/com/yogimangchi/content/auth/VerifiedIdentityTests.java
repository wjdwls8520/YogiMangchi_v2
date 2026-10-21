package com.yogimangchi.content.auth;

import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import static org.assertj.core.api.Assertions.*;

class VerifiedIdentityTests {
    @Test void googleUsesOidcSubjectRatherThanEmail() {
        var proof=VerifiedIdentity.from(google(true,"stable-google-sub"));
        assertThat(proof.provider()).isEqualTo(Provider.GOOGLE);
        assertThat(proof.subject()).isEqualTo("stable-google-sub");
        assertThat(proof.email()).isEqualTo("same@example.test");
    }
    @Test void kakaoUsesProviderIdAndRequiresVerifiedEmail() {
        var user=new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of("id",12345L,"kakao_account",Map.of("email","same@example.test","is_email_valid",true,"is_email_verified",true)),"id");
        var proof=VerifiedIdentity.from(new OAuth2AuthenticationToken(user,user.getAuthorities(),"kakao"));
        assertThat(proof.provider()).isEqualTo(Provider.KAKAO); assertThat(proof.subject()).isEqualTo("12345");
    }
    @Test void otherProvidersAndUnverifiedEmailAreRejected() {
        assertThatThrownBy(() -> VerifiedIdentity.from(google(false,"not-verified"))).isInstanceOf(AuthFailure.class);
        var user=new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),Map.of("id",1L),"id");
        assertThatThrownBy(() -> VerifiedIdentity.from(new OAuth2AuthenticationToken(user,user.getAuthorities(),"github"))).isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> VerifiedIdentity.from(new OAuth2AuthenticationToken(user,user.getAuthorities(),"google"))).isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> VerifiedIdentity.from(new OAuth2AuthenticationToken(user,user.getAuthorities(),"kakao"))).isInstanceOf(AuthFailure.class);
    }
    private OAuth2AuthenticationToken google(boolean verified,String subject) {
        var idToken=OidcIdToken.withTokenValue("test-only-id-token").subject(subject).issuer("https://accounts.google.com")
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).claim("email","same@example.test").claim("email_verified",verified).build();
        var user=new DefaultOidcUser(List.of(new SimpleGrantedAuthority("ROLE_USER")),idToken);
        return new OAuth2AuthenticationToken(user,user.getAuthorities(),"google");
    }
}
