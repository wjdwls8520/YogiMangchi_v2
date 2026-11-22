package com.yogimangchi.content.auth;

import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.support.*;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

@SpringBootTest(properties="content.oauth.enabled=false")
@ActiveProfiles("prod")
@AutoConfigureMockMvc
@Import(TestInfrastructure.class)
class ProdSecurityIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired Environment env;
    @Autowired CommunityS3Service s3;
    @Test void productionHidesSwaggerAndSetsHostOnlySecureRefreshCookie() throws Exception {
        mvc.perform(get("/v3/api-docs")).andExpect(status().isUnauthorized());
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isUnauthorized());
        assertThat(env.getProperty("content.s3.enabled", Boolean.class)).isFalse();
        assertThat(env.getProperty("content.s3.public-base-url", "")).doesNotContain("localhost");
        assertThat(env.getProperty("server.forward-headers-strategy", "")).isEqualTo("native");
        assertThat(env.getProperty("server.tomcat.remoteip.internal-proxies", "")).isNotBlank();
        assertThat(env.getProperty("spring.datasource.hikari.maximum-pool-size", Integer.class)).isEqualTo(10);
        assertThat(env.getProperty("spring.datasource.hikari.minimum-idle", Integer.class)).isEqualTo(2);
        assertThat(env.getProperty("spring.datasource.hikari.leak-detection-threshold", Long.class)).isEqualTo(10000L);
        assertThat(s3.isRealS3Configured()).isFalse();
        assertThat(s3.sanitizePostFileUrl("https://example-bucket.s3.ap-northeast-2.amazonaws.com/legacy.png"))
                .doesNotContain("localhost");
        var placeholder = s3.readLocalMedia("placeholder.svg");
        assertThat(placeholder).isNotNull();
        String placeholderSvg = new String(placeholder.bytes(), java.nio.charset.StandardCharsets.UTF_8);
        assertThat(placeholderSvg)
                .contains("첨부 이미지 미리보기")
                .contains("이미지 저장소 준비 중")
                .doesNotContain("로컬 안전 미리보기")
                .doesNotContain("S3")
                .doesNotContain("무과금");
        var id=new VerifiedIdentity(Provider.GOOGLE,UUID.randomUUID().toString(),"prod-test@example.test",Instant.now().plusSeconds(300));
        var login=auth.signup(id,new SignupRequest("prodtest",true,true,"","ym-terms-v3","ym-privacy-v3"));
        mvc.perform(post("/api/v1/auth/refresh").with(csrf()).cookie(new Cookie("CONTENT_REFRESH",login.refresh())))
                .andExpect(status().isOk()).andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.containsString("Secure")))
                .andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("Domain="))));
    }
}
