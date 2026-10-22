package com.yogimangchi.content.auth;

import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
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
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
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
    @Test void productionHidesSwaggerAndSetsHostOnlySecureRefreshCookie() throws Exception {
        mvc.perform(get("/v3/api-docs")).andExpect(status().isUnauthorized());
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isUnauthorized());
        var id=new VerifiedIdentity(Provider.GOOGLE,UUID.randomUUID().toString(),"prod-test@example.test",Instant.now().plusSeconds(300));
        var login=auth.signup(id,new SignupRequest("prodtest",true,true,"","ym-terms-v1","ym-privacy-v1"));
        mvc.perform(post("/api/v1/auth/refresh").with(csrf()).cookie(new Cookie("CONTENT_REFRESH",login.refresh())))
                .andExpect(status().isOk()).andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.containsString("Secure")))
                .andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("Domain="))));
    }
}
