package com.yogimangchi.content.auth;

import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.support.*;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.*;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** Pool pressure must fail before the Frontend's10-second timeout, without a hidden rotation. */
@SpringBootTest(properties={"content.oauth.enabled=false","spring.datasource.hikari.maximum-pool-size=1","spring.datasource.hikari.minimum-idle=1"})
@AutoConfigureMockMvc @Import(TestInfrastructure.class)
class SessionAvailabilityIntegrationTests extends TestEnvironment {
    @Autowired DataSource dataSource;
    @Autowired AuthService auth;
    @Autowired MockMvc mvc;

    @Test void poolExhaustionReturns503BeforeClientTimeoutWithoutConsumingRefresh() throws Exception {
        var proof=new VerifiedIdentity(Provider.GOOGLE,UUID.randomUUID().toString(),"pool-test@example.test",Instant.now().plusSeconds(300));
        var own=auth.signup(proof,new SignupRequest(UUID.randomUUID().toString().substring(0,8),true,true,"","ym-terms-v1","ym-privacy-v1"));
        var pool=Executors.newSingleThreadExecutor();
        try {
            // Occupy the only connection without changing any member or token state.
            try(var occupied=dataSource.getConnection()) {
                var request=pool.submit(()->mvc.perform(post("/api/v1/auth/refresh").with(csrf())
                        .cookie(new Cookie("CONTENT_REFRESH",own.refresh()))).andReturn().getResponse());
                var response=request.get(6,TimeUnit.SECONDS);
                assertThat(response.getStatus()).isEqualTo(503);
                assertThat(response.getContentAsString()).contains("SERVICE_TEMPORARILY_UNAVAILABLE");
                assertThat(response.getHeaders("Set-Cookie")).isEmpty();
                assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
            }
            // A failed acquisition cannot rotate/revoke a token behind a timed-out browser.
            assertThat(auth.refresh(own.refresh()).access().memberId()).isEqualTo(own.access().memberId());
        } finally {
            pool.shutdown();assertThat(pool.awaitTermination(8,TimeUnit.SECONDS)).isTrue();
        }
    }
}
