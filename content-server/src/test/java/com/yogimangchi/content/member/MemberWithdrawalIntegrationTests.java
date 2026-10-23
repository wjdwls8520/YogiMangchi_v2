package com.yogimangchi.content.member;

import com.nimbusds.jose.jwk.RSAKey;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.member.service.*;
import com.yogimangchi.content.support.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="content.oauth.enabled=false") @AutoConfigureMockMvc @Import(TestInfrastructure.class)
class MemberWithdrawalIntegrationTests extends TestEnvironment {
    private org.springframework.test.web.servlet.request.RequestPostProcessor realCsrf() {
        return request->{try{
            var session=(org.springframework.mock.web.MockHttpSession)request.getSession(true);
            var response=mvc.perform(get("/api/v1/auth/csrf").session(session)).andExpect(status().isOk()).andReturn().getResponse();
            var token=new com.fasterxml.jackson.databind.ObjectMapper().readTree(response.getContentAsString());
            request.addHeader(token.path("headerName").asText(),token.path("token").asText());return request;
        }catch(Exception e){throw new IllegalStateException(e);}};
    }
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired MemberWithdrawals withdrawals;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtEncoder encoder;
    @Autowired RSAKey key;
    @Autowired PlatformTransactionManager transactions;
    AuthService.Issued issued;
    VerifiedIdentity identity;
    @BeforeEach void setup() {
        identity=new VerifiedIdentity(Provider.KAKAO,UUID.randomUUID().toString(),"withdrawal@example.test",Instant.now().plusSeconds(300));
        issued=auth.signup(identity,new SignupRequest(UUID.randomUUID().toString().replace("-","").substring(0,8),true,true,"old profile","ym-terms-v1","ym-privacy-v1"));
    }
    @AfterEach void cleanup() { withdrawals.delivered(issued.access().memberId()); }

    private org.springframework.mock.web.MockHttpSession proof() {var s=new org.springframework.mock.web.MockHttpSession();s.setAttribute(VerifiedIdentity.SESSION_KEY,identity);return s;}
    private static com.yogimangchi.content.member.dto.WithdrawalRequest body() {return new com.yogimangchi.content.member.dto.WithdrawalRequest(true,"탈퇴합니다","ym-withdrawal-v1");}
    @Test void withdrawalSoftDeletesOnlyOwnMemberRevokesAllRefreshAndIsIdempotent() throws Exception {
        var second=auth.completeLogin(identity);
        String url="/api/v1/members/me/withdrawal",bearer="Bearer "+issued.access().accessToken();
        mvc.perform(post(url).with(realCsrf())).andExpect(status().isUnauthorized());
        for(int i=0;i<2;i++) mvc.perform(post(url).header("Authorization",bearer).session(proof()).with(realCsrf()).contentType("application/json").content("{\"acknowledged\":true,\"confirmation\":\"탈퇴합니다\",\"policyVersion\":\"ym-withdrawal-v1\",\"memberId\":999}"))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.containsString("Max-Age=0")));
        Long id=issued.access().memberId();
        assertThat(jdbc.queryForObject("select count(*) from content.member_withdrawal where member_id=?",Long.class,id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status<>'REVOKED'",Long.class,id)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from content.oauth_identity where member_id=?",Long.class,id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select status='WITHDRAWING' and withdrawn_at is null from content.member where id=?",Boolean.class,id)).isTrue();
        mvc.perform(get("/api/v1/members/"+id)).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/members/me").header("Authorization",bearer)).andExpect(status().isUnauthorized());
        assertThatThrownBy(() -> auth.refresh(issued.refresh())).isInstanceOf(com.yogimangchi.content.error.AuthFailure.class);
        assertThatThrownBy(() -> auth.refresh(second.refresh())).isInstanceOf(com.yogimangchi.content.error.AuthFailure.class);
        assertThatThrownBy(() -> auth.completeLogin(identity)).isInstanceOf(com.yogimangchi.content.error.AuthFailure.class);
        withdrawals.delivered(id);
        mvc.perform(get(url).header("Authorization",bearer)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("COMPLETED"));
    }

    @Test void withdrawalMemberRefreshAndOutboxRollBackTogether() {
        Long id=issued.access().memberId();
        var tx=new TransactionTemplate(transactions);
        assertThatThrownBy(() -> tx.execute(s -> { withdrawals.request(id,body(),identity); throw new IllegalStateException("simulated rollback"); })).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("select status from content.member where id=?",String.class,id)).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("select count(*) from content.member_withdrawal where member_id=?",Long.class,id)).isZero();
        assertThat(auth.refresh(issued.refresh()).access().memberId()).isEqualTo(id);
    }

    @Test void failedDeliveryRetainsRequestAndRetryUsesDedicatedShortSignedToken() throws Exception {
        Long id=issued.access().memberId(); withdrawals.request(id,body(),identity);
        var status=new AtomicInteger(503); var token=new AtomicReference<String>();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/internal/v1/members/"+id+"/withdrawal",exchange -> {
            token.set(exchange.getRequestHeaders().getFirst("Authorization"));
            exchange.sendResponseHeaders(status.get(),-1); exchange.close();
        }); server.start();
        try {
            var delivery=new WithdrawalDelivery(withdrawals,encoder,"https://content.test","content-1","http://127.0.0.1:"+server.getAddress().getPort());
            delivery.deliverPending();
            assertThat(jdbc.queryForObject("select status from content.member_withdrawal where member_id=?",String.class,id)).isEqualTo("PENDING");
            assertThat(jdbc.queryForObject("select attempts from content.member_withdrawal where member_id=?",Integer.class,id)).isEqualTo(1);
            assertThat(withdrawals.pending()).doesNotContain(id);
            var decoded=NimbusJwtDecoder.withPublicKey(key.toRSAPublicKey()).build().decode(token.get().substring(7));
            assertThat(decoded.getSubject()).isEqualTo(id.toString());
            assertThat(decoded.getAudience()).containsExactly("trading-internal");
            assertThat(decoded.getClaimAsString("token_use")).isEqualTo("member_withdrawal");
            assertThat(decoded.getExpiresAt()).isEqualTo(decoded.getIssuedAt().plusSeconds(60));
            status.set(204); jdbc.update("update content.member_withdrawal set next_attempt_at=now() where member_id=?",id);
            // A new worker instance uses persisted pending state, as after a process restart.
            new WithdrawalDelivery(withdrawals,encoder,"https://content.test","content-1","http://127.0.0.1:"+server.getAddress().getPort()).deliverPending();
            assertThat(jdbc.queryForObject("select status from content.member_withdrawal where member_id=?",String.class,id)).isEqualTo("COMPLETED");
            assertThat(withdrawals.pending()).doesNotContain(id);
        } finally { server.stop(0); }
    }
}
