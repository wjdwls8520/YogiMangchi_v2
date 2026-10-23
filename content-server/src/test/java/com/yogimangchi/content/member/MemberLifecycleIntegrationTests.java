package com.yogimangchi.content.member;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.consent.PolicyConsents;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.dto.WithdrawalRequest;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.member.service.*;
import com.yogimangchi.content.support.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="content.oauth.enabled=false") @AutoConfigureMockMvc @Import(TestInfrastructure.class)
class MemberLifecycleIntegrationTests extends TestEnvironment {
    private org.springframework.test.web.servlet.request.RequestPostProcessor realCsrf() {
        return request->{try{
            var session=(org.springframework.mock.web.MockHttpSession)request.getSession(true);
            var response=mvc.perform(get("/api/v1/auth/csrf").session(session)).andExpect(status().isOk()).andReturn().getResponse();
            var token=new com.fasterxml.jackson.databind.ObjectMapper().readTree(response.getContentAsString());
            request.addHeader(token.path("headerName").asText(),token.path("token").asText());return request;
        }catch(Exception e){throw new IllegalStateException(e);}};
    }
    @Autowired org.springframework.security.oauth2.jwt.JwtEncoder encoder;
    @Autowired com.nimbusds.jose.jwk.RSAKey key;
    @Autowired javax.sql.DataSource dataSource;
    @Autowired AuthService auth;
    @Autowired MemberWithdrawals withdrawals;
    @Autowired MemberProvisioning provisioning;
    @Autowired PolicyConsents consents;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired PlatformTransactionManager transactions;
    private static final WithdrawalRequest CONFIRM=new WithdrawalRequest(true,"탈퇴합니다","ym-withdrawal-v1");
    private static SignupRequest signup(){return new SignupRequest(UUID.randomUUID().toString().substring(0,8),true,true,"","ym-terms-v1","ym-privacy-v1");}
    private static VerifiedIdentity proof(Provider p){return new VerifiedIdentity(p,UUID.randomUUID().toString(),"private@example.test",Instant.now().plusSeconds(300));}
    private static MockHttpSession session(VerifiedIdentity p){var s=new MockHttpSession();s.setAttribute(VerifiedIdentity.SESSION_KEY,p);return s;}

    @ParameterizedTest @EnumSource(Provider.class)
    void withdrawalErasesIdentityAndRejoiningCreatesNewIdAndConsents(Provider provider) throws Exception {
        var proof=proof(provider);var old=auth.signup(proof,signup());long id=old.access().memberId();
        withdrawals.request(id,CONFIRM,proof);
        assertThat(auth.flow(proof).status()).isEqualTo("WITHDRAWAL_PENDING");
        assertThat(jdbc.queryForObject("select status from content.member where id=?",String.class,id)).isEqualTo("WITHDRAWING");
        assertThat(jdbc.queryForObject("select count(*) from content.oauth_identity where member_id=?",Long.class,id)).isEqualTo(1);
        withdrawals.delivered(id);withdrawals.delivered(id);
        assertThat(jdbc.queryForObject("select nickname from content.member where id=?",String.class,id)).isNull();
        assertThat(jdbc.queryForObject("select profile_message from content.member where id=?",String.class,id)).isEmpty();
        for(String table:List.of("oauth_identity","refresh_session","member_consent_history"))
            assertThat(jdbc.queryForObject("select count(*) from content."+table+" where member_id=?",Long.class,id)).isZero();
        assertThat(auth.flow(proof).status()).isEqualTo("SIGNUP_REQUIRED");
        assertThatThrownBy(()->auth.refresh(old.refresh())).isInstanceOf(AuthFailure.class);
        var fresh=auth.signup(proof,new SignupRequest(old.access().nickname(),true,true,"","ym-terms-v1","ym-privacy-v1"));assertThat(fresh.access().memberId()).isNotEqualTo(id);
        assertThat(auth.completeLogin(proof).access().memberId()).isEqualTo(fresh.access().memberId());
        assertThat(jdbc.queryForObject("select status from content.member where id=?",String.class,id)).isEqualTo("WITHDRAWN");
        assertThat(consents.current(fresh.access().memberId()).reconsentRequired()).isFalse();
        mvc.perform(get("/api/v1/members/me").header("Authorization","Bearer "+old.access().accessToken())).andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("select status from content.member_trading_provision where member_id=?",String.class,id)).isEqualTo("CANCELED");
    }
    @Test void confirmationRecentSameMemberProofAndCsrfAreAllRequired() throws Exception {
        var proof=proof(Provider.GOOGLE);var own=auth.signup(proof,signup());long id=own.access().memberId();
        String bearer="Bearer "+own.access().accessToken(),url="/api/v1/members/me/withdrawal";
        mvc.perform(post(url).header("Authorization",bearer).with(realCsrf())).andExpect(status().isBadRequest());
        mvc.perform(post(url).header("Authorization",bearer).session(session(proof)).contentType("application/json").content(json.writeValueAsString(CONFIRM))).andExpect(status().isForbidden());
        mvc.perform(post(url).header("Authorization",bearer).with(realCsrf()).contentType("application/json").content(json.writeValueAsString(CONFIRM))).andExpect(status().isUnauthorized());
        for(var bad:List.of(new WithdrawalRequest(false,"탈퇴합니다",CONFIRM.policyVersion()),new WithdrawalRequest(true,"탈퇴",CONFIRM.policyVersion()),new WithdrawalRequest(true,"탈퇴합니다","stale")))
            mvc.perform(post(url).header("Authorization",bearer).session(session(proof)).with(realCsrf()).contentType("application/json").content(json.writeValueAsString(bad))).andExpect(status().isBadRequest());
        assertThatThrownBy(()->withdrawals.request(id,CONFIRM,proof(Provider.KAKAO))).isInstanceOf(AuthFailure.class);
        assertThatThrownBy(()->withdrawals.request(id,CONFIRM,new VerifiedIdentity(proof.provider(),proof.subject(),proof.email(),Instant.now().minusSeconds(1)))).isInstanceOf(AuthFailure.class);
        assertThat(withdrawals.status(id).status()).isEqualTo("NOT_REQUESTED");
        mvc.perform(post(url).header("Authorization",bearer).session(session(proof)).with(realCsrf()).contentType("application/json").content(json.writeValueAsString(CONFIRM))).andExpect(status().isAccepted());
        mvc.perform(get(url).header("Authorization",bearer)).andExpect(jsonPath("$.status").value("PENDING"));
        mvc.perform(get("/api/v1/members/me/consents").header("Authorization",bearer)).andExpect(status().isUnauthorized());
        withdrawals.delivered(id);
    }
    @Test void signupAndVersionedConsentAndProvisionOutboxCommitOrRollbackTogether() {
        var proof=proof(Provider.GOOGLE);var tx=new TransactionTemplate(transactions);
        assertThatThrownBy(()->tx.execute(s->{auth.signup(proof,signup());throw new IllegalStateException("rollback");})).isInstanceOf(IllegalStateException.class);
        assertThat(auth.flow(proof).status()).isEqualTo("SIGNUP_REQUIRED");
        var own=auth.signup(proof,signup());
        assertThat(jdbc.queryForObject("select count(*) from content.member_consent_history where member_id=?",Long.class,own.access().memberId())).isEqualTo(2);
        assertThat(jdbc.queryForObject("select status from content.member_trading_provision where member_id=?",String.class,own.access().memberId())).isEqualTo("PENDING");
        assertThatThrownBy(()->auth.signup(proof,signup())).isInstanceOf(AuthFailure.class);
    }
    @Test void staleAndMissingSignupVersionsDoNotCreateMember() throws Exception {
        var proof=proof(Provider.KAKAO);
        mvc.perform(post("/api/v1/auth/signup").session(session(proof)).with(csrf()).contentType("application/json").content("{\"nickname\":\"새회원\",\"termAgree\":true,\"privateAgree\":true}")).andExpect(status().isBadRequest());
        assertThatThrownBy(()->auth.signup(proof,new SignupRequest("새회원",true,true,"","stale","ym-privacy-v1"))).isInstanceOf(AuthFailure.class);
        assertThat(auth.flow(proof).status()).isEqualTo("SIGNUP_REQUIRED");
    }
    @Test void oldUnversionedConsentIsNotFabricatedAndReconsentIsAppendOnlyAndIdempotent() {
        var own=auth.signup(proof(Provider.GOOGLE),signup());long id=own.access().memberId();
        var tx=new TransactionTemplate(transactions);
        tx.executeWithoutResult(status->{
            jdbc.update("delete from content.member_consent_history where member_id=?",id); // Simulate pre-versioning member.
            assertThat(consents.current(id).reconsentRequired()).isTrue();
            consents.accept(id,new PolicyConsents.Acceptance(true,true,"ym-terms-v1","ym-privacy-v1"));
            var original=jdbc.queryForList("select * from content.member_consent_history where member_id=? order by id",id);
            consents.accept(id,new PolicyConsents.Acceptance(true,true,"ym-terms-v1","ym-privacy-v1"));
            assertThat(jdbc.queryForList("select * from content.member_consent_history where member_id=? order by id",id)).isEqualTo(original);
            jdbc.update("update content.policy_version set current=false where policy_type='TERMS'");
            jdbc.update("insert into content.policy_version select policy_type,'ym-terms-v2',required,true,document_text,document_sha256 from content.policy_version where policy_type='TERMS' and version='ym-terms-v1'");
            assertThat(consents.current(id).reconsentRequired()).isTrue();
            assertThat(consents.current(id).policies()).anyMatch(p->"ym-terms-v1".equals(p.lastAcceptedVersion()));
            consents.accept(id,new PolicyConsents.Acceptance(true,true,"ym-terms-v2","ym-privacy-v1"));
            assertThat(consents.current(id).reconsentRequired()).isFalse();
            assertThat(jdbc.queryForObject("select count(*) from content.member_consent_history where member_id=?",Long.class,id)).isEqualTo(3);
            status.setRollbackOnly();
        });
    }
    @Test void contentFinalizationFailureKeepsPendingAndCanResumeWithoutReactivatingTrading() {
        var proof=proof(Provider.KAKAO);var own=auth.signup(proof,signup());long id=own.access().memberId();
        withdrawals.request(id,CONFIRM,proof);
        var tx=new TransactionTemplate(transactions);
        assertThatThrownBy(()->tx.execute(s->{withdrawals.delivered(id);throw new IllegalStateException("Content commit failure after Trading acknowledgement");})).isInstanceOf(IllegalStateException.class);
        assertThat(withdrawals.status(id).status()).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("select count(*) from content.oauth_identity where member_id=?",Long.class,id)).isEqualTo(1);
        withdrawals.delivered(id);assertThat(withdrawals.status(id).status()).isEqualTo("COMPLETED");
    }
    @Test void refreshAndWithdrawalSerializeWithoutRevivingMembership() throws Exception {
        var proof=proof(Provider.GOOGLE);var own=auth.signup(proof,signup());long id=own.access().memberId();
        var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try {
            var refresh=pool.submit(()->{start.await();try{auth.refresh(own.refresh());}catch(AuthFailure expected){}return null;});
            var withdrawal=pool.submit(()->{start.await();withdrawals.request(id,CONFIRM,proof);return null;});
            start.countDown();refresh.get(10,TimeUnit.SECONDS);withdrawal.get(10,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='ACTIVE'",Long.class,id)).isZero();
            assertThatThrownBy(()->auth.completeLogin(proof)).isInstanceOf(AuthFailure.class);
        }finally{pool.shutdownNow();withdrawals.delivered(id);}
    }
    @Test void v4PreservesLegacyActiveProfilesAndPurgesOnlyConfirmedWithdrawnIdentities() {
        String schema="content_upgrade_"+UUID.randomUUID().toString().replace("-","");
        try {
            org.flywaydb.core.Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("3").load().migrate();
            for(int i=1;i<=3;i++){
                jdbc.update("insert into "+schema+".member(id,nickname,profile_message,status,role,terms_agreed_at,privacy_agreed_at,created_at,withdrawn_at) values (?,?,?,?,'MEMBER',now(),now(),now(),"+(i==1?"NULL":"now()")+")",i,i==1?"LegacyName12":"private"+i,"old private",i==1?"ACTIVE":"WITHDRAWN");
                jdbc.update("insert into "+schema+".oauth_identity(member_id,provider,provider_subject,email) values (?,'GOOGLE',?,?)",i,"provider"+i,"private"+i+"@example.test");
            }
            jdbc.update("insert into "+schema+".member_withdrawal(member_id,status,requested_at,next_attempt_at) values (3,'PENDING',now(),now())");
            org.flywaydb.core.Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("4").load().migrate();
            assertThat(jdbc.queryForObject("select nickname from "+schema+".member where id=1",String.class)).isEqualTo("LegacyName12");
            assertThat(jdbc.queryForObject("select nickname from "+schema+".member where id=2",String.class)).isNull();
            assertThat(jdbc.queryForObject("select status from "+schema+".member where id=3",String.class)).isEqualTo("WITHDRAWING");
            assertThat(jdbc.queryForObject("select count(*) from "+schema+".oauth_identity where member_id=2",Long.class)).isZero();
            assertThat(jdbc.queryForObject("select count(*) from "+schema+".oauth_identity where member_id=3",Long.class)).isEqualTo(1);
            assertThat(jdbc.queryForObject("select count(*) from "+schema+".member_consent_history",Long.class)).isZero();
            assertThat(jdbc.queryForObject("select count(*) from "+schema+".member_trading_provision",Long.class)).isZero();
            assertThatThrownBy(()->jdbc.update("update "+schema+".member set nickname=NULL where id=1")).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        }finally{jdbc.execute("drop schema if exists "+schema+" cascade");}
    }

    @Test void immutableDevelopmentDocumentsHaveMatchingHashesAndPublicVersionContract() throws Exception {
        mvc.perform(get("/api/v1/policies/current")).andExpect(status().isOk()).andExpect(jsonPath("$.policies[0].documentUrl").isString());
        for(String type:List.of("TERMS","PRIVACY")){
            String version=type.equals("TERMS")?"ym-terms-v1":"ym-privacy-v1";
            var doc=consents.document(type,version);
            var digest=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(doc.text().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            assertThat(doc.sha256()).isEqualTo(digest);
            mvc.perform(get("/api/v1/policies/"+type+"/"+version)).andExpect(status().isOk()).andExpect(jsonPath("$.documentStatus").value("DEVELOPMENT_DRAFT"));
            assertThatThrownBy(()->jdbc.update("update content.policy_version set document_text='rewritten' where policy_type=? and version=?",type,version)).isInstanceOf(org.springframework.dao.DataAccessException.class);
        }
    }
    @Test void concurrentSignupCannotCreateOrphanMemberConsentOrProvisioningRows() throws Exception {
        var identity=proof(Provider.KAKAO);long before=jdbc.queryForObject("select count(*) from content.member",Long.class);
        var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try{
            var tasks=new ArrayList<Future<Boolean>>();for(int i=0;i<2;i++)tasks.add(pool.submit(()->{start.await();try{auth.signup(identity,signup());return true;}catch(AuthFailure|org.springframework.dao.DataIntegrityViolationException expected){return false;}}));
            start.countDown();int success=0;for(var task:tasks)if(task.get(12,TimeUnit.SECONDS))success++;
            assertThat(success).isEqualTo(1);assertThat(jdbc.queryForObject("select count(*) from content.member",Long.class)).isEqualTo(before+1);
        }finally{pool.shutdownNow();}
    }
    @Test void failedProvisionDeliveryUsesPersistentRetryAndPurposeScopedCredential() throws Exception {
        var own=auth.signup(proof(Provider.GOOGLE),signup());long id=own.access().memberId();
        // Isolate this disposable fixture's scheduled queue from unrelated test signups.
        jdbc.update("update content.member_trading_provision set next_attempt_at=now()+interval '1 hour' where member_id<>?",id);
        var status=new java.util.concurrent.atomic.AtomicInteger(503);var token=new java.util.concurrent.atomic.AtomicReference<String>();
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/internal/v1/members/"+id+"/trading-account",exchange->{token.set(exchange.getRequestHeaders().getFirst("Authorization"));exchange.sendResponseHeaders(status.get(),-1);exchange.close();});server.start();
        try{
            String base="http://127.0.0.1:"+server.getAddress().getPort();
            new MemberProvisioningDelivery(provisioning,encoder,"https://content.test","content-1",base).deliverPending();
            assertThat(jdbc.queryForObject("select status from content.member_trading_provision where member_id=?",String.class,id)).isEqualTo("PENDING");
            var decoded=org.springframework.security.oauth2.jwt.NimbusJwtDecoder.withPublicKey(key.toRSAPublicKey()).build().decode(token.get().substring(7));
            assertThat(decoded.getClaimAsString("token_use")).isEqualTo("member_provisioning");assertThat(decoded.getAudience()).containsExactly("trading-internal");
            status.set(204);jdbc.update("update content.member_trading_provision set next_attempt_at=now() where member_id=?",id);
            new MemberProvisioningDelivery(provisioning,encoder,"https://content.test","content-1",base).deliverPending();
            assertThat(jdbc.queryForObject("select status from content.member_trading_provision where member_id=?",String.class,id)).isEqualTo("COMPLETED");
        }finally{server.stop(0);}
    }

    @Test void uncommittedIdentityErasureCannotMixOldMembershipWithConcurrentSignup() throws Exception {
        var proof=proof(Provider.GOOGLE);var own=auth.signup(proof,signup());long id=own.access().memberId();
        withdrawals.request(id,CONFIRM,proof);
        var erased=new CountDownLatch(1);var release=new CountDownLatch(1);var pool=Executors.newSingleThreadExecutor();
        try{
            var delivery=pool.submit(()->new TransactionTemplate(transactions).execute(status->{withdrawals.delivered(id);erased.countDown();try{if(!release.await(8,TimeUnit.SECONDS))throw new IllegalStateException("test commit not released");}catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}return null;}));
            assertThat(erased.await(5,TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(()->auth.signup(proof,signup())).isInstanceOf(AuthFailure.class);
            release.countDown();delivery.get(5,TimeUnit.SECONDS);
            var rejoined=auth.signup(proof,new SignupRequest(own.access().nickname(),true,true,"","ym-terms-v1","ym-privacy-v1"));
            assertThat(rejoined.access().memberId()).isNotEqualTo(id);assertThat(auth.completeLogin(proof).access().memberId()).isEqualTo(rejoined.access().memberId());
        }finally{release.countDown();pool.shutdownNow();}
    }

}
