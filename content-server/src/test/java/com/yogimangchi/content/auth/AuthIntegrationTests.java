package com.yogimangchi.content.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.support.*;
import jakarta.servlet.http.Cookie;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.web.servlet.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

@SpringBootTest(properties="content.oauth.enabled=false")
@AutoConfigureMockMvc
@Import(TestInfrastructure.class)
class AuthIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtDecoder decoder;
    @Autowired JwtEncoder encoder;

    @Test void signupNeedsVerifiedServerProofAndBothConsents() throws Exception {
        mvc.perform(post("/api/v1/auth/signup").with(csrf()).contentType("application/json").content(body(nickname(),true,true)))
                .andExpect(status().isUnauthorized());
        var session=proof(identity(Provider.GOOGLE,"same@example.test"));
        mvc.perform(post("/api/v1/auth/signup").session(session).with(csrf()).contentType("application/json").content(body(nickname(),false,true)))
                .andExpect(status().isBadRequest());
        String chosen=nickname();
        var result=mvc.perform(post("/api/v1/auth/signup").session(session).with(csrf()).contentType("application/json").content(body(chosen,true,true)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value(chosen)).andExpect(jsonPath("$.expiresIn").value(900))
                .andExpect(jsonPath("$.refreshToken").doesNotExist()).andReturn();
        var access=json.readTree(result.getResponse().getContentAsString()).path("accessToken").asText();
        var jwt=decoder.decode(access);
        assertThat(jwt.getClaimAsStringList("roles")).containsExactly("MEMBER");
        assertThat(jwt.getAudience()).containsExactly("content","trading");
        assertThat(Duration.between(jwt.getIssuedAt(),jwt.getExpiresAt())).isEqualTo(Duration.ofMinutes(15));
        assertThat(result.getResponse().getHeader("Set-Cookie")).contains("HttpOnly","SameSite=Lax","Path=/api/v1/auth").doesNotContain("Domain=");
        assertThat(session.getAttribute(VerifiedIdentity.SESSION_KEY)).isNull();
        mvc.perform(get("/api/v1/members/me").header("Authorization","Bearer "+access))
                .andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value(chosen)).andExpect(jsonPath("$.email").doesNotExist());
    }

    @Test void identityIsProviderSubjectAndNeverEmailAutoLinking() {
        var first=identity(Provider.GOOGLE,"equal@example.test");
        var one=signup(first); var two=signup(identity(Provider.KAKAO,"equal@example.test"));
        assertThat(one.access().memberId()).isNotEqualTo(two.access().memberId());
        var login=auth.completeLogin(first);
        assertThat(login.access().memberId()).isEqualTo(one.access().memberId());
        assertThatThrownBy(() -> signup(first)).isInstanceOf(AuthFailure.class);
    }

    @Test void existingMemberLoginConsumesProofAndTheOAuthSessionCannotAuthenticateBusinessApi() throws Exception {
        var identity=identity(Provider.KAKAO,"login@example.test"); var member=signup(identity); var session=proof(identity);
        mvc.perform(get("/api/v1/members/me").session(session)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/auth/flow").session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("LOGIN_READY"));
        mvc.perform(post("/api/v1/auth/login/complete").session(session).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.memberId").value(member.access().memberId()));
        mvc.perform(post("/api/v1/auth/login/complete").session(session).with(csrf())).andExpect(status().isUnauthorized());
    }

    @Test void concurrentSignupOfOneProviderIdentityLeavesOneMemberAndNoOrphanSession() throws Exception {
        var identity=identity(Provider.GOOGLE,"signup-race@example.test");
        long before=jdbc.queryForObject("select count(*) from content.member",Long.class);
        var start=new CountDownLatch(1); var pool=Executors.newFixedThreadPool(2);
        try {
            Callable<Object> attempt=() -> { start.await(); try { return signup(identity); } catch(RuntimeException expected) { return expected; } };
            var first=pool.submit(attempt); var second=pool.submit(attempt); start.countDown();
            var results=List.of(first.get(8,TimeUnit.SECONDS),second.get(8,TimeUnit.SECONDS));
            assertThat(results.stream().filter(AuthService.Issued.class::isInstance)).hasSize(1);
            assertThat(jdbc.queryForObject("select count(*) from content.member",Long.class)).isEqualTo(before+1);
            assertThat(jdbc.queryForObject("select count(*) from content.oauth_identity where provider_subject=?",Long.class,identity.subject())).isEqualTo(1);
            var member=(AuthService.Issued)results.stream().filter(AuthService.Issued.class::isInstance).findFirst().orElseThrow();
            assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=?",Long.class,member.access().memberId())).isEqualTo(1);
        } finally { start.countDown(); pool.shutdownNow(); }
    }

    @Test void refreshRotatesHashOnlyWithFixedExpiryAndReuseRevokesTheEntireFamily() {
        var login=signup(identity(Provider.GOOGLE,"rotate@example.test"));
        var rotated=auth.refresh(login.refresh());
        assertThat(rotated.refresh()).isNotEqualTo(login.refresh());
        assertThat(rotated.refreshExpiresAt()).isEqualTo(login.refreshExpiresAt().truncatedTo(java.time.temporal.ChronoUnit.MICROS));
        assertThat(jdbc.queryForList("select token_hash from content.refresh_session where member_id=?",String.class,login.access().memberId()))
                .hasSize(2).allMatch(hash -> hash.matches("[0-9a-f]{64}") && !hash.equals(login.refresh()) && !hash.equals(rotated.refresh()));
        assertThatThrownBy(() -> auth.refresh(login.refresh())).isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> auth.refresh(rotated.refresh())).isInstanceOf(AuthFailure.class);
        assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='ACTIVE'",Long.class,login.access().memberId())).isZero();
    }

    @Test void simultaneousRefreshCannotIssueTwoActiveSuccessors() throws Exception {
        var login=signup(identity(Provider.GOOGLE,"race@example.test"));
        var ready=new CountDownLatch(2); var start=new CountDownLatch(1); var pool=Executors.newFixedThreadPool(2);
        try {
            Callable<Object> attempt=() -> { ready.countDown(); start.await(); try { return auth.refresh(login.refresh()); } catch(AuthFailure expected) { return expected; } };
            var first=pool.submit(attempt); var second=pool.submit(attempt);
            assertThat(ready.await(3,TimeUnit.SECONDS)).isTrue(); start.countDown();
            var results=List.of(first.get(8,TimeUnit.SECONDS),second.get(8,TimeUnit.SECONDS));
            assertThat(results.stream().filter(AuthService.Issued.class::isInstance)).hasSize(1);
            assertThat(results.stream().filter(AuthFailure.class::isInstance)).hasSize(1);
            var issued=(AuthService.Issued)results.stream().filter(AuthService.Issued.class::isInstance).findFirst().orElseThrow();
            assertThatThrownBy(() -> auth.refresh(issued.refresh())).isInstanceOf(AuthFailure.class);
        } finally { start.countDown(); pool.shutdownNow(); }
    }

    @Test void csrfProtectsRefreshLogoutAndSignupEvenWithValidCookies() throws Exception {
        var login=signup(identity(Provider.GOOGLE,"csrf@example.test"));
        for(String endpoint:List.of("refresh","logout","signup","login/complete"))
            mvc.perform(post("/api/v1/auth/"+endpoint).cookie(new Cookie("CONTENT_REFRESH",login.refresh())))
                    .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/auth/refresh").with(csrf()).cookie(new Cookie("CONTENT_REFRESH",login.refresh())))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"));
    }

    @Test void csrfEndpointReturnsAnActualSessionBoundHeaderForBrowserCalls() throws Exception {
        var csrfResult=mvc.perform(get("/api/v1/auth/csrf")).andExpect(status().isOk()).andReturn();
        var csrfData=json.readTree(csrfResult.getResponse().getContentAsString());
        var session=(MockHttpSession)csrfResult.getRequest().getSession(false);
        assertThat(session).isNotNull();
        mvc.perform(post("/api/v1/auth/logout").session(session).header(csrfData.path("headerName").asText(),csrfData.path("token").asText()))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/logout").header(csrfData.path("headerName").asText(),csrfData.path("token").asText()))
                .andExpect(status().isForbidden());
    }

    @Test void logoutRevokesRefreshButDoesNotPretendToRevokeAnExistingAccessJwt() throws Exception {
        var login=signup(identity(Provider.GOOGLE,"logout@example.test"));
        mvc.perform(post("/api/v1/auth/logout").with(csrf()).cookie(new Cookie("CONTENT_REFRESH",login.refresh())))
                .andExpect(status().isNoContent()).andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.containsString("Max-Age=0")));
        auth.logout(login.refresh());
        assertThatThrownBy(() -> auth.refresh(login.refresh())).isInstanceOf(AuthFailure.class);
        mvc.perform(get("/api/v1/members/me").header("Authorization","Bearer "+login.access().accessToken())).andExpect(status().isOk());
    }

    @Test void expiredRefreshAndWithdrawnMemberCannotMintTokens() {
        var expired=signup(identity(Provider.GOOGLE,"expired@example.test"));
        jdbc.update("update content.refresh_session set expires_at=now()-interval '1 second' where member_id=?",expired.access().memberId());
        assertThatThrownBy(() -> auth.refresh(expired.refresh())).isInstanceOf(AuthFailure.class);
        var identity=identity(Provider.KAKAO,"withdrawn@example.test"); var withdrawn=signup(identity);
        jdbc.update("update content.member set status='WITHDRAWN',withdrawn_at=now(),nickname=NULL,profile_message='' where id=?",withdrawn.access().memberId());
        assertThatThrownBy(() -> auth.refresh(withdrawn.refresh())).isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> auth.completeLogin(identity)).isInstanceOf(AuthFailure.class);
    }

    @Test void invalidExpiredAndWrongContractAccessJwtAreRejected() throws Exception {
        var member=signup(identity(Provider.GOOGLE,"jwt@example.test"));
        String[] parts=member.access().accessToken().split("\\.");
        String tampered=parts[0]+"."+parts[1]+"."+(parts[2].charAt(0)=='A' ? 'B' : 'A')+parts[2].substring(1);
        mvc.perform(get("/api/v1/members/me")).andExpect(status().isUnauthorized());
        for(String value:List.of("invalid",tampered,signed(member.access().memberId(),"wrong-issuer","content","access",Instant.now().plusSeconds(60)),
                signed(member.access().memberId(),"https://content.test","other","access",Instant.now().plusSeconds(60)),
                signed(member.access().memberId(),"https://content.test","content","refresh",Instant.now().plusSeconds(60)),
                signed(member.access().memberId(),"https://content.test","content","access",Instant.now().minusSeconds(1))))
            mvc.perform(get("/api/v1/members/me").header("Authorization","Bearer "+value)).andExpect(status().isUnauthorized());
        var incomplete=JwtClaimsSet.builder().issuer("https://content.test").subject(member.access().memberId().toString()).claim("token_use","access").build();
        String incompleteToken=encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(),incomplete)).getTokenValue();
        mvc.perform(get("/api/v1/members/me").header("Authorization","Bearer "+incompleteToken)).andExpect(status().isUnauthorized());
    }

    @Test void expiredProofAndNicknamesAreRejectedWithoutCreatingOrphanMembers() throws Exception {
        var expired=new VerifiedIdentity(Provider.GOOGLE,"expired-proof","proof@example.test",Instant.now().minusSeconds(1));
        mvc.perform(get("/api/v1/auth/flow").session(proof(expired))).andExpect(status().isUnauthorized());
        var identity=identity(Provider.GOOGLE,"validation@example.test");
        long count=jdbc.queryForObject("select count(*) from content.member",Long.class);
        mvc.perform(post("/api/v1/auth/signup").session(proof(identity)).with(csrf()).contentType("text/plain").content("bad request"))
                .andExpect(status().isUnsupportedMediaType());
        mvc.perform(post("/api/v1/auth/signup").session(proof(identity)).with(csrf()).contentType("application/json").content("{"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/auth/signup").session(proof(identity)).with(csrf()).contentType("application/json").content(body("x space",true,true)))
                .andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("select count(*) from content.member",Long.class)).isEqualTo(count);
        var first=signup(identity); String nick=first.access().nickname();
        assertThatThrownBy(() -> auth.signup(identity(Provider.KAKAO,"duplicate@example.test"),new SignupRequest(nick,true,true,"","ym-terms-v1","ym-privacy-v1")))
                .isInstanceOf(AuthFailure.class);
    }

    @Test void publicKeysAndDocsContainNoPrivateKeyAndUnrelatedRequestsStayBlocked() throws Exception {
        mvc.perform(get("/.well-known/jwks.json")).andExpect(status().isOk()).andExpect(jsonPath("$.keys[0].n").isString())
                .andExpect(jsonPath("$.keys[0].d").doesNotExist()).andExpect(jsonPath("$.keys[0].p").doesNotExist());
        mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andExpect(jsonPath("$.paths['/api/v1/auth/refresh']").exists());
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/members").with(csrf())).andExpect(status().isUnauthorized());
        mvc.perform(get("/oauth2/authorization/github")).andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("select to_regclass('trading.trading_account')::text",String.class)).isNull();
    }
    private String signed(Long id,String issuer,String audience,String use,Instant expiry) {
        var claims=JwtClaimsSet.builder().subject(id.toString()).issuer(issuer).audience(List.of(audience)).issuedAt(Instant.now().minusSeconds(60))
                .expiresAt(expiry).claim("token_use",use).build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(),claims)).getTokenValue();
    }
    private AuthService.Issued signup(VerifiedIdentity identity) { return auth.signup(identity,new SignupRequest(nickname(),true,true,"","ym-terms-v1","ym-privacy-v1")); }
    private static VerifiedIdentity identity(Provider provider,String email) { return new VerifiedIdentity(provider,UUID.randomUUID().toString(),email,Instant.now().plusSeconds(300)); }
    private static MockHttpSession proof(VerifiedIdentity identity) { var session=new MockHttpSession(); session.setAttribute(VerifiedIdentity.SESSION_KEY,identity); return session; }
    private static String nickname() { return UUID.randomUUID().toString().replace("-","").substring(0,8); }
    private static String body(String name,boolean terms,boolean privacy) { return "{\"nickname\":\""+name+"\",\"termAgree\":"+terms+",\"privateAgree\":"+privacy+",\"termsVersion\":\"ym-terms-v1\",\"privacyVersion\":\"ym-privacy-v1\",\"role\":\"ADMIN\",\"memberId\":1}"; }
}
