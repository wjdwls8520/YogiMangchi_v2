package com.yogimangchi.content.member;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.member.service.*;
import com.yogimangchi.content.support.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="content.oauth.enabled=false") @AutoConfigureMockMvc @Import(TestInfrastructure.class)
class MemberFollowIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired MemberFollows follows;
    @Autowired MemberWithdrawals withdrawals;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    AuthService.Issued a,b,c;
    @BeforeEach void setup() { a=member(); b=member(); c=member(); }
    @AfterEach void cleanup() { for(var member:List.of(a,b,c)) withdrawals.delivered(member.access().memberId()); }

    @Test void authenticatedOwnFollowAndUnfollowAreIdempotentAndHistoryIsRetained() throws Exception {
        String url=url(b),bearer="Bearer "+a.access().accessToken();
        mvc.perform(put(url)).andExpect(status().isUnauthorized());
        mvc.perform(delete(url)).andExpect(status().isUnauthorized());
        for(int i=0;i<2;i++) mvc.perform(put(url).header("Authorization",bearer).contentType("application/json").content("{\"memberId\":999,\"followerCount\":999}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.targetMemberId").value(b.access().memberId()))
                .andExpect(jsonPath("$.followerCount").value(1)).andExpect(jsonPath("$.followed").value(true));
        for(int i=0;i<2;i++) mvc.perform(delete(url).header("Authorization",bearer)).andExpect(status().isOk()).andExpect(jsonPath("$.followerCount").value(0));
        assertThat(rows(true)).isZero(); assertThat(rows(false)).isEqualTo(1);
        follows.change(a.access().memberId(),b.access().memberId(),true);
        assertThat(rows(true)).isEqualTo(1); assertThat(rows(false)).isEqualTo(1);
        assertThat(follows.summary(c.access().memberId(),null).followingCount()).isZero();
    }
    @Test void selfMissingTargetAndInvalidPagingAreRejectedWithoutMutatingRelations() throws Exception {
        mvc.perform(put(url(a)).header("Authorization","Bearer "+a.access().accessToken())).andExpect(status().isBadRequest());
        mvc.perform(put("/api/v1/members/0/follows").header("Authorization","Bearer "+a.access().accessToken())).andExpect(status().isBadRequest());
        mvc.perform(put("/api/v1/members/9223372036854775807/follows").header("Authorization","Bearer "+a.access().accessToken())).andExpect(status().isNotFound());
        for(String query:List.of("?size=0","?size=11","?cursorId=-1","?keyword=abcdefghijklmn"))
            mvc.perform(get("/api/v1/members/"+a.access().memberId()+"/followers"+query)).andExpect(status().isBadRequest());
        assertThat(rows(true)).isZero();
    }
    @Test void publicListsUseBoundedDescendingRelationCursorAndLiteralNicknameSearch() throws Exception {
        follows.change(a.access().memberId(),b.access().memberId(),true);
        follows.change(a.access().memberId(),c.access().memberId(),true);
        String url="/api/v1/members/"+a.access().memberId()+"/followings";
        var first=json.readTree(mvc.perform(get(url).param("size","1")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(first.path("content").get(0).path("memberId").longValue()).isEqualTo(c.access().memberId());
        assertThat(first.path("hasNext").booleanValue()).isTrue();
        var last=json.readTree(mvc.perform(get(url).param("size","1").param("cursorId",first.path("nextCursorId").asText())).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(last.path("content").get(0).path("memberId").longValue()).isEqualTo(b.access().memberId());
        assertThat(last.path("hasNext").booleanValue()).isFalse(); assertThat(last.path("nextCursorId").isNull()).isTrue();
        assertThat(first.toString()).doesNotContain("email","role","provider","profileImgUrl");
        mvc.perform(get(url).param("keyword","%")).andExpect(jsonPath("$.content.length()").value(0));
        mvc.perform(get(url).param("keyword",b.access().nickname().toUpperCase(Locale.ROOT))).andExpect(jsonPath("$.content.length()").value(1));
        mvc.perform(get("/api/v1/members/"+b.access().memberId()+"/followers")).andExpect(jsonPath("$.content[0].memberId").value(a.access().memberId()));
    }
    @Test void countsAndRelationshipAreDerivedFromActiveRelationsAndVerifiedViewer() throws Exception {
        follows.change(a.access().memberId(),b.access().memberId(),true);
        follows.change(b.access().memberId(),a.access().memberId(),true);
        mvc.perform(get(url(b))).andExpect(status().isOk()).andExpect(jsonPath("$.followerCount").value(1))
                .andExpect(jsonPath("$.followingCount").value(1)).andExpect(jsonPath("$.followed").value(false)).andExpect(jsonPath("$.mine").value(false));
        mvc.perform(get(url(b)).header("Authorization","Bearer "+a.access().accessToken())).andExpect(status().isOk())
                .andExpect(jsonPath("$.followed").value(true)).andExpect(jsonPath("$.follower").value(true));
        mvc.perform(get(url(a)).header("Authorization","Bearer "+a.access().accessToken())).andExpect(jsonPath("$.mine").value(true));
    }
    @Test void withdrawalDeactivatesBothDirectionsAndRemovesCountsAndPublicVisibility() throws Exception {
        follows.change(a.access().memberId(),b.access().memberId(),true);
        follows.change(b.access().memberId(),a.access().memberId(),true);
        withdraw(a.access().memberId());
        assertThat(rows(true)).isZero(); assertThat(rows(false)).isEqualTo(1);
        assertThat(follows.summary(b.access().memberId(),null).followerCount()).isZero();
        assertThat(follows.summary(b.access().memberId(),null).followingCount()).isZero();
        assertThat(follows.list(b.access().memberId(),true,null,null,null).content()).isEmpty();
        mvc.perform(get("/api/v1/members/"+a.access().memberId()+"/followers")).andExpect(status().isNotFound());
        mvc.perform(put(url(b)).header("Authorization","Bearer "+a.access().accessToken())).andExpect(status().isUnauthorized());
        mvc.perform(put(url(a)).header("Authorization","Bearer "+b.access().accessToken())).andExpect(status().isNotFound());
    }
    @Test void concurrentDuplicateFollowsCreateOneActiveRelation() throws Exception {
        var start=new CountDownLatch(1); var pool=Executors.newFixedThreadPool(4);
        try {
            var tasks=new ArrayList<Future<?>>();
            for(int i=0;i<4;i++) tasks.add(pool.submit(() -> { start.await(); follows.change(a.access().memberId(),b.access().memberId(),true); return null; }));
            start.countDown(); for(var task:tasks) task.get(10,TimeUnit.SECONDS);
            assertThat(rows(true)).isEqualTo(1); assertThat(follows.summary(b.access().memberId(),null).followerCount()).isEqualTo(1);
        } finally { start.countDown(); pool.shutdownNow(); }
    }
    @Test void concurrentFollowAndWithdrawalCannotLeaveAnActiveRelation() throws Exception {
        var start=new CountDownLatch(1); var pool=Executors.newFixedThreadPool(2);
        try {
            var follow=pool.submit(() -> { start.await(); try { follows.change(a.access().memberId(),b.access().memberId(),true); } catch(AuthFailure expected) { assertThat(expected.code()).isEqualTo("MEMBER_NOT_FOUND"); } return null; });
            var withdrawal=pool.submit(() -> { start.await(); withdraw(b.access().memberId()); return null; });
            start.countDown(); follow.get(10,TimeUnit.SECONDS); withdrawal.get(10,TimeUnit.SECONDS);
            assertThat(rows(true)).isZero();
        } finally { start.countDown(); pool.shutdownNow(); }
    }
    @Test void docsAndCorsKeepPublicListsAndAuthenticatedMutationsSeparate() throws Exception {
        var api=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var path=api.path("paths").path("/api/v1/members/{memberId}/follows");
        assertThat(path.path("get").path("security").isEmpty()).isTrue();
        assertThat(path.path("put").path("security").toString()).contains("memberBearer");
        assertThat(path.path("delete").path("security").toString()).contains("memberBearer");
        for(String method:List.of("PUT","DELETE")) mvc.perform(options(url(b)).header("Origin","https://app.test").header("Access-Control-Request-Method",method).header("Access-Control-Request-Headers","Authorization"))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin","https://app.test"));
    }
    private void withdraw(Long id) {
        var subject=jdbc.queryForObject("select provider_subject from content.oauth_identity where member_id=?",String.class,id);
        withdrawals.request(id,new com.yogimangchi.content.member.dto.WithdrawalRequest(true,"탈퇴합니다","ym-withdrawal-v1"),new VerifiedIdentity(Provider.GOOGLE,subject,"follow@example.test",Instant.now().plusSeconds(300)));
    }
    private long rows(boolean active) { return jdbc.queryForObject("select count(*) from content.member_follow where follower_id=? and following_id=? and active=?",Long.class,a.access().memberId(),b.access().memberId(),active); }
    private static String url(AuthService.Issued member) { return "/api/v1/members/"+member.access().memberId()+"/follows"; }
    private AuthService.Issued member() {
        return auth.signup(new VerifiedIdentity(Provider.GOOGLE,UUID.randomUUID().toString(),"follow@example.test",Instant.now().plusSeconds(300)),new SignupRequest(UUID.randomUUID().toString().replace("-","").substring(0,8),true,true,"follow profile","ym-terms-v1","ym-privacy-v1"));
    }
}
