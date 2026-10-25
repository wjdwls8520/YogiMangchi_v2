package com.yogimangchi.content.auth;

import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.support.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="content.oauth.enabled=false") @AutoConfigureMockMvc @Import(TestInfrastructure.class)
class AuthContractIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired JdbcTemplate jdbc;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    private VerifiedIdentity identity() {return new VerifiedIdentity(Provider.GOOGLE,UUID.randomUUID().toString(),"private@example.test",Instant.now().plusSeconds(300));}
    private MockHttpSession session(VerifiedIdentity proof) {var session=new MockHttpSession();session.setAttribute(VerifiedIdentity.SESSION_KEY,proof);return session;}
    private String body(String nick,String terms,String privacy,boolean agree) {
        return "{\"nickname\":\""+nick+"\",\"termAgree\":"+agree+",\"privateAgree\":true,\"termsVersion\":\""+terms+"\",\"privacyVersion\":\""+privacy+"\"}";
    }
    private ResultActions signup(MockHttpSession session,String body) throws Exception {
        return mvc.perform(post("/api/v1/auth/signup").session(session).with(csrf()).contentType("application/json").content(body));
    }
    @Test void validationCodesDistinguishNicknameConsentAndPolicyWithProofRetainedOnFailure() throws Exception {
        var session=session(identity());
        signup(session,body("bad name","ym-terms-v1","ym-privacy-v1",true)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_NICKNAME"));
        signup(session,body("회원가입","ym-terms-v1","ym-privacy-v1",false)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("REQUIRED_CONSENT_MISSING"));
        signup(session,body("회원가입","","ym-privacy-v1",true)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("POLICY_VERSION_REQUIRED"));
        signup(session,body("회원가입","stale","ym-privacy-v1",true)).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("POLICY_VERSION_CHANGED"));
        mvc.perform(get("/api/v1/auth/flow").session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("SIGNUP_REQUIRED"));
    }
    @Test void nicknameAndIdentityConflictsHaveDifferentSafeCodes() throws Exception {
        var proof=identity();String nickname=UUID.randomUUID().toString().substring(0,8);
        auth.signup(proof,new SignupRequest(nickname,true,true,"","ym-terms-v1","ym-privacy-v1"));
        signup(session(identity()),body(nickname,"ym-terms-v1","ym-privacy-v1",true)).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NICKNAME_UNAVAILABLE"));
        signup(session(proof),body("새가입","ym-terms-v1","ym-privacy-v1",true)).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("MEMBER_ALREADY_EXISTS"));
    }
    @Test void proofExpiryAndConsumptionAreExplicitAndConcurrentCompletionIssuesOnlyOnce() throws Exception {
        var proof=identity();var own=auth.signup(proof,new SignupRequest(UUID.randomUUID().toString().substring(0,8),true,true,"","ym-terms-v1","ym-privacy-v1"));
        mvc.perform(get("/api/v1/auth/flow").session(session(new VerifiedIdentity(proof.provider(),proof.subject(),proof.email(),Instant.now().minusSeconds(1)))))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("LOGIN_PROOF_EXPIRED"));
        var session=session(proof);var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try {
            Callable<MvcResult> task=()->{start.await();return mvc.perform(post("/api/v1/auth/login/complete").session(session).with(csrf())).andReturn();};
            var a=pool.submit(task);var b=pool.submit(task);start.countDown();var results=List.of(a.get(10,TimeUnit.SECONDS),b.get(10,TimeUnit.SECONDS));
            assertThat(results.stream().map(r->r.getResponse().getStatus())).containsExactlyInAnyOrder(200,401);
            var failure=results.stream().filter(r->r.getResponse().getStatus()==401).findFirst().orElseThrow().getResponse();
            assertThat(failure.getContentAsString()).contains("LOGIN_PROOF_REQUIRED");assertThat(failure.getHeaders("Set-Cookie")).isEmpty();
            assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=?",Long.class,own.access().memberId())).isEqualTo(2);
        }finally{start.countDown();pool.shutdownNow();}
    }
    @Test void lostSignupResponseCanRecoverThroughFreshOAuthProofWithoutRepeatingProvisioning() throws Exception {
        var proof=identity();var session=session(proof);String nickname=UUID.randomUUID().toString().substring(0,8);
        signup(session,body(nickname,"ym-terms-v1","ym-privacy-v1",true)).andExpect(status().isOk()); // Discard response.
        signup(session,body(nickname,"ym-terms-v1","ym-privacy-v1",true)).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("LOGIN_PROOF_REQUIRED"));
        mvc.perform(get("/api/v1/auth/flow").session(session(proof))).andExpect(jsonPath("$.status").value("LOGIN_READY"));
        var issued=auth.completeLogin(proof);Long id=issued.access().memberId();
        assertThat(jdbc.queryForObject("select count(*) from content.member_trading_provision where member_id=?",Long.class,id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from content.member_consent_history where member_id=?",Long.class,id)).isEqualTo(2);
    }
    @Test void configuredCorsAllowsCredentialsAndRejectsUnlistedOriginWithoutWeakeningCsrf() throws Exception {
        mvc.perform(options("/api/v1/auth/refresh").header("Origin","https://app.test").header("Access-Control-Request-Method","POST").header("Access-Control-Request-Headers","X-CSRF-TOKEN"))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin","https://app.test")).andExpect(header().string("Access-Control-Allow-Credentials","true"));
        mvc.perform(options("/api/v1/auth/refresh").header("Origin","https://evil.test").header("Access-Control-Request-Method","POST"))
                .andExpect(status().isForbidden()).andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        mvc.perform(post("/api/v1/auth/refresh").header("Origin","https://app.test"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("CSRF_INVALID"));
    }
    @Test void addingBearerCannotExemptCookieAuthOperationsFromCsrf() throws Exception {
        var own=auth.signup(identity(),new SignupRequest(UUID.randomUUID().toString().substring(0,8),true,true,"","ym-terms-v1","ym-privacy-v1"));
        for(String path:List.of("signup","login/complete","refresh","logout")) {
            mvc.perform(post("/api/v1/auth/"+path).header("Authorization","Bearer "+own.access().accessToken())
                    .cookie(new jakarta.servlet.http.Cookie("CONTENT_REFRESH",own.refresh())))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("CSRF_INVALID"));
        }
    }
    @Test void concurrentSignupOfSameNicknameReturnsStableConflictWithoutOrphanRows() throws Exception {
        String nickname=UUID.randomUUID().toString().substring(0,8);var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try {
            Callable<MvcResult> task=()->{var proof=session(identity());start.await();return signup(proof,body(nickname,"ym-terms-v1","ym-privacy-v1",true)).andReturn();};
            var a=pool.submit(task);var b=pool.submit(task);start.countDown();var results=List.of(a.get(10,TimeUnit.SECONDS),b.get(10,TimeUnit.SECONDS));
            assertThat(results.stream().map(r->r.getResponse().getStatus())).containsExactlyInAnyOrder(200,409);
            assertThat(results.stream().filter(r->r.getResponse().getStatus()==409).findFirst().orElseThrow().getResponse().getContentAsString()).contains("NICKNAME_UNAVAILABLE");
            assertThat(jdbc.queryForObject("select count(*) from content.member where nickname=?",Long.class,nickname)).isEqualTo(1);
        }finally{start.countDown();pool.shutdownNow();}
    }
    @Test void openApiDocumentsProblemCodesAndRateLimitHeader() throws Exception {
        mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
                .andExpect(jsonPath("$.components.schemas.ContentProblem.properties.code").exists())
                .andExpect(jsonPath("$.paths['/api/v1/auth/signup'].post.responses['400'].description").value(org.hamcrest.Matchers.containsString("REQUIRED_CONSENT_MISSING")))
                .andExpect(jsonPath("$.paths['/api/v1/auth/refresh'].post.responses['503']").exists())
                .andExpect(jsonPath("$.paths['/api/v1/members/nickname/availability'].get.responses['429'].headers['Retry-After']").exists());
    }
    @Test void consentOpenApiRequiresBearerAndMatchesActualValidationStatuses() throws Exception {
        String path="/api/v1/members/me/consents";
        mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
                .andExpect(jsonPath("$.paths['"+path+"'].get.security[0].memberBearer").isArray())
                .andExpect(jsonPath("$.paths['"+path+"'].post.security[0].memberBearer").isArray())
                .andExpect(jsonPath("$.paths['"+path+"'].post.description").value(org.hamcrest.Matchers.containsString("Missing consent400")));
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        var own=auth.signup(identity(),new SignupRequest(UUID.randomUUID().toString().substring(0,8),true,true,"","ym-terms-v1","ym-privacy-v1"));
        for(var entry:Map.of(body("unused","ym-terms-v1","ym-privacy-v1",false),"REQUIRED_CONSENT_MISSING",
                body("unused","","ym-privacy-v1",true),"POLICY_VERSION_REQUIRED").entrySet()) {
            mvc.perform(post(path).header("Authorization","Bearer "+own.access().accessToken()).contentType("application/json").content(entry.getKey()))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(entry.getValue()));
        }
        mvc.perform(post(path).header("Authorization","Bearer "+own.access().accessToken()).contentType("application/json").content(body("unused","stale","ym-privacy-v1",true)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("POLICY_VERSION_CHANGED"));
    }

    @Test void authenticatedMemberReconsentAndProvisioningWaitAreSeparateStates() throws Exception {
        var proof=identity();var own=auth.signup(proof,new SignupRequest(UUID.randomUUID().toString().substring(0,8),true,true,"","ym-terms-v1","ym-privacy-v1"));
        Long id=own.access().memberId();
        // Use a dedicated database transaction to model an existing member with unversioned consent.
        new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(tx->{
            jdbc.update("delete from content.member_consent_history where member_id=?",id);
            try {
                mvc.perform(get("/api/v1/members/me").header("Authorization","Bearer "+own.access().accessToken())).andExpect(status().isOk());
                mvc.perform(get("/api/v1/members/me/consents").header("Authorization","Bearer "+own.access().accessToken()))
                        .andExpect(status().isOk()).andExpect(jsonPath("$.reconsentRequired").value(true));
                assertThat(jdbc.queryForObject("select status from content.member_trading_provision where member_id=?",String.class,id)).isEqualTo("PENDING");
            }catch(Exception failure){throw new IllegalStateException(failure);}finally{tx.setRollbackOnly();}
        });
        // The original history is intact; re-login does not enqueue another provisioning request.
        mvc.perform(post("/api/v1/auth/login/complete").session(session(proof)).with(csrf())).andExpect(status().isOk());
        assertThat(jdbc.queryForObject("select count(*) from content.member_trading_provision where member_id=?",Long.class,id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from content.member_consent_history where member_id=?",Long.class,id)).isEqualTo(2);
    }
}
