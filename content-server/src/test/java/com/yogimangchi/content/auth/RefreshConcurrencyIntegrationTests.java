package com.yogimangchi.content.auth;

import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.dto.WithdrawalRequest;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.member.service.MemberWithdrawals;
import com.yogimangchi.content.support.*;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.*;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="content.oauth.enabled=false")
@AutoConfigureMockMvc
@Import(TestInfrastructure.class)
class RefreshConcurrencyIntegrationTests extends TestEnvironment {
    @Autowired AuthService auth;
    @Autowired MemberWithdrawals withdrawals;
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;

    @ParameterizedTest @NullSource
    @ValueSource(strings={"invalid", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
    void rejectedRefreshCannotEraseAnotherSuccessfulResponseCookie(String invalid) throws Exception {
        var login=signup(identity());
        var success=refresh(login.refresh());
        assertThat(success.getResponse().getStatus()).isEqualTo(200);
        String successor=success.getResponse().getCookie("CONTENT_REFRESH").getValue();
        assertThat(successor).isNotEqualTo(login.refresh());

        var late=refresh(invalid);
        assertThat(late.getResponse().getStatus()).isEqualTo(401);
        assertThat(late.getResponse().getHeaders(HttpHeaders.SET_COOKIE)).isEmpty();
        assertThat(late.getResponse().getHeader(HttpHeaders.CACHE_CONTROL)).isEqualTo("no-store");
        assertThat(auth.refresh(successor).access().memberId()).isEqualTo(login.access().memberId());
    }

    @Test void oldFamilyReplayCannotClearTheCookieOrRevokeANewerLoginFamily() throws Exception {
        var proof=identity();
        var first=signup(proof);
        var oldSuccessor=auth.refresh(first.refresh());
        var newLogin=auth.completeLogin(proof);
        var late=refresh(first.refresh());
        assertThat(late.getResponse().getStatus()).isEqualTo(401);
        assertThat(late.getResponse().getHeaders(HttpHeaders.SET_COOKIE)).isEmpty();
        assertThatThrownBy(()->auth.refresh(oldSuccessor.refresh())).isInstanceOf(AuthFailure.class);
        assertThat(auth.refresh(newLogin.refresh()).access().memberId()).isEqualTo(first.access().memberId());
    }

    @Test void simultaneousSameCookieStillRevokesItsFamilyAndFailureDoesNotMutateCookies() throws Exception {
        var login=signup(identity());
        var pool=Executors.newFixedThreadPool(2);
        var start=new CountDownLatch(1);
        try {
            Callable<MvcResult> attempt=()->{start.await();return refresh(login.refresh());};
            var one=pool.submit(attempt);var two=pool.submit(attempt);start.countDown();
            var results=List.of(one.get(10,TimeUnit.SECONDS),two.get(10,TimeUnit.SECONDS));
            assertThat(results.stream().map(r->r.getResponse().getStatus())).containsExactlyInAnyOrder(200,401);
            var denied=results.stream().filter(r->r.getResponse().getStatus()==401).findFirst().orElseThrow();
            assertThat(denied.getResponse().getHeaders(HttpHeaders.SET_COOKIE)).isEmpty();
            String successor=results.stream().filter(r->r.getResponse().getStatus()==200).findFirst().orElseThrow()
                    .getResponse().getCookie("CONTENT_REFRESH").getValue();
            assertThatThrownBy(()->auth.refresh(successor)).isInstanceOf(AuthFailure.class);
            assertNoActiveSessions(login.access().memberId());
        } finally {start.countDown();pool.shutdownNow();}
    }

    @Test void retryAfterLostRotationResponseRequiresLoginRatherThanAcceptingAnOldToken() throws Exception {
        var login=signup(identity());
        // The server committed successfully, but the browser never received the successor cookie.
        var lost=auth.refresh(login.refresh());
        var retry=refresh(login.refresh());
        assertThat(retry.getResponse().getStatus()).isEqualTo(401);
        assertThat(retry.getResponse().getHeaders(HttpHeaders.SET_COOKIE)).isEmpty();
        assertThatThrownBy(()->auth.refresh(lost.refresh())).isInstanceOf(AuthFailure.class);
        assertNoActiveSessions(login.access().memberId());
    }

    @Test void independentDeviceFamiliesCanRotateConcurrentlyAndLogoutIsFamilyScoped() throws Exception {
        var proof=identity();var one=signup(proof);var two=auth.completeLogin(proof);
        var pool=Executors.newFixedThreadPool(2);var start=new CountDownLatch(1);
        try {
            var first=pool.submit(()->{start.await();return auth.refresh(one.refresh());});
            var second=pool.submit(()->{start.await();return auth.refresh(two.refresh());});start.countDown();
            var a=first.get(10,TimeUnit.SECONDS);var b=second.get(10,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='ACTIVE'",Long.class,one.access().memberId())).isEqualTo(2);
            auth.logout(one.refresh());
            assertThatThrownBy(()->auth.refresh(a.refresh())).isInstanceOf(AuthFailure.class);
            assertThat(auth.refresh(b.refresh()).access().memberId()).isEqualTo(one.access().memberId());
        } finally {start.countDown();pool.shutdownNow();}
    }

    @Test void logoutWaitsForTheMemberLockBeforeTakingAnyRefreshFamilyLock() throws Exception {
        var login=signup(identity());
        var pool=Executors.newSingleThreadExecutor();
        var started=new CountDownLatch(1);
        var logout=new java.util.concurrent.atomic.AtomicReference<Future<?>>();
        try {
            new TransactionTemplate(transactions).executeWithoutResult(status->{
                jdbc.queryForObject("select id from content.member where id=? for update",Long.class,login.access().memberId());
                int blocker=jdbc.queryForObject("select pg_backend_pid()",Integer.class);
                logout.set(pool.submit(()->{started.countDown();auth.logout(login.refresh());}));
                try {
                    assertThat(started.await(2,TimeUnit.SECONDS)).isTrue();
                    long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
                    boolean blocked=false;
                    while(System.nanoTime()<deadline && !logout.get().isDone()) {
                        blocked=Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from pg_stat_activity where ?=any(pg_blocking_pids(pid)))",Boolean.class,blocker));
                        if(blocked)break;
                        Thread.sleep(10);
                    }
                    assertThat(blocked).as("Logout must use the same Member -> Refresh lock order as refresh/withdrawal").isTrue();
                } catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}
            });
            logout.get().get(8,TimeUnit.SECONDS);
            assertNoActiveSessions(login.access().memberId());
        } finally {pool.shutdownNow();}
    }

    @Test void logoutOfARotatedAncestorAndRefreshOfItsSuccessorFinishWithoutDeadlock() throws Exception {
        var login=signup(identity());var successor=auth.refresh(login.refresh());
        var pool=Executors.newFixedThreadPool(2);var start=new CountDownLatch(1);
        try {
            var refresh=pool.submit(()->{start.await();try{return auth.refresh(successor.refresh());}catch(AuthFailure expected){return null;}});
            var logout=pool.submit(()->{start.await();auth.logout(login.refresh());return null;});start.countDown();
            refresh.get(10,TimeUnit.SECONDS);logout.get(10,TimeUnit.SECONDS);
            assertNoActiveSessions(login.access().memberId());
        } finally {start.countDown();pool.shutdownNow();}
    }

    @Test void refreshLogoutAndWithdrawalCannotLeaveAnActiveFamilyOrReviveTheMember() throws Exception {
        var proof=identity();var login=signup(proof);var device=auth.completeLogin(proof);
        var pool=Executors.newFixedThreadPool(3);var start=new CountDownLatch(1);
        try {
            var refresh=pool.submit(()->{start.await();try{auth.refresh(login.refresh());}catch(AuthFailure expected){}return null;});
            var logout=pool.submit(()->{start.await();auth.logout(login.refresh());return null;});
            var withdrawal=pool.submit(()->{start.await();return withdrawals.request(login.access().memberId(),new WithdrawalRequest(true,"탈퇴합니다","ym-withdrawal-v1"),proof);});
            start.countDown();refresh.get(10,TimeUnit.SECONDS);logout.get(10,TimeUnit.SECONDS);withdrawal.get(10,TimeUnit.SECONDS);
            assertNoActiveSessions(login.access().memberId());
            assertThatThrownBy(()->auth.refresh(device.refresh())).isInstanceOf(AuthFailure.class);
            assertThatThrownBy(()->auth.completeLogin(proof)).isInstanceOf(AuthFailure.class);
            mvc.perform(get("/api/v1/members/me").header("Authorization","Bearer "+login.access().accessToken())).andExpect(status().isUnauthorized());
            withdrawals.delivered(login.access().memberId());
            assertThat(refresh(device.refresh()).getResponse().getStatus()).isEqualTo(401);
            assertThat(jdbc.queryForObject("select status from content.member where id=?",String.class,login.access().memberId())).isEqualTo("WITHDRAWN");
        } finally {start.countDown();pool.shutdownNow();}
    }

    private MvcResult refresh(String token) throws Exception {
        var request=post("/api/v1/auth/refresh").with(csrf());
        if(token!=null)request.cookie(new Cookie("CONTENT_REFRESH",token));
        return mvc.perform(request).andReturn();
    }
    private AuthService.Issued signup(VerifiedIdentity proof) {
        return auth.signup(proof,new SignupRequest(UUID.randomUUID().toString().substring(0,8),true,true,"","ym-terms-v1","ym-privacy-v1"));
    }
    private static VerifiedIdentity identity() {
        return new VerifiedIdentity(Provider.GOOGLE,UUID.randomUUID().toString(),"refresh-test@example.test",Instant.now().plusSeconds(300));
    }
    private void assertNoActiveSessions(Long memberId) {
        assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='ACTIVE'",Long.class,memberId)).isZero();
    }
}
