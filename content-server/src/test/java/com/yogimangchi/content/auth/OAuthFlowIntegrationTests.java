package com.yogimangchi.content.auth;

import com.yogimangchi.content.support.*;
import java.net.URI;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.endpoint.*;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.userinfo.*;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.core.endpoint.OAuth2AccessTokenResponse;
import org.springframework.security.oauth2.core.user.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.util.UriComponentsBuilder;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"content.oauth.enabled=true","GOOGLE_CLIENT_ID=test-only-google","GOOGLE_CLIENT_SECRET=test-only-google-secret",
        "KAKAO_CLIENT_ID=test-only-kakao","KAKAO_CLIENT_SECRET=test-only-kakao-secret"})
@AutoConfigureMockMvc
@Import(TestInfrastructure.class)
class OAuthFlowIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired ClientRegistrationRepository registrations;
    @MockitoBean OAuth2AccessTokenResponseClient<OAuth2AuthorizationCodeGrantRequest> tokens;
    @MockitoBean OAuth2UserService<OAuth2UserRequest,OAuth2User> users;
    @BeforeEach void providerStubs() {
        when(tokens.getTokenResponse(any())).thenReturn(OAuth2AccessTokenResponse.withToken("test-only-provider-token").tokenType(OAuth2AccessToken.TokenType.BEARER).expiresIn(300).build());
        when(users.loadUser(any())).thenReturn(new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of("id",12345L,"kakao_account",Map.of("email","test@example.test","is_email_valid",true,"is_email_verified",true)),"id"));
    }
    @Test void onlyGoogleAndKakaoAreRegisteredAndGoogleRequestsOidcNonce() throws Exception {
        assertThat(registrations.findByRegistrationId("google")).isNotNull();
        assertThat(registrations.findByRegistrationId("kakao")).isNotNull();
        assertThat(registrations.findByRegistrationId("github")).isNull();
        var response=mvc.perform(get("/oauth2/authorization/google")).andExpect(status().is3xxRedirection()).andReturn().getResponse();
        var query=UriComponentsBuilder.fromUriString(response.getRedirectedUrl()).build().getQueryParams();
        assertThat(query.getFirst("nonce")).isNotBlank(); assertThat(query.getFirst("state")).isNotBlank();
        assertThat(query.getFirst("scope")).contains("openid");
    }
    @Test void kakaoCallbackRequiresMatchingStateAndRedirectsWithoutAnyTokenInUrl() throws Exception {
        var start=mvc.perform(get("/oauth2/authorization/kakao")).andExpect(status().is3xxRedirection()).andReturn();
        var session=(MockHttpSession)start.getRequest().getSession(false);
        String state=java.net.URLDecoder.decode(UriComponentsBuilder.fromUriString(start.getResponse().getRedirectedUrl()).build().getQueryParams().getFirst("state"),java.nio.charset.StandardCharsets.UTF_8);
        var result=mvc.perform(get("/login/oauth2/code/kakao").session(session).param("code","test-code").param("state",state))
                .andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("https://app.test/auth/callback")).andReturn();
        assertThat(result.getResponse().getRedirectedUrl()).doesNotContain("token","code=","state=");
        mvc.perform(get("/api/v1/auth/flow").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SIGNUP_REQUIRED")).andExpect(jsonPath("$.provider").value("KAKAO"));
        assertThat(session.getAttribute("SPRING_SECURITY_CONTEXT")).isNull();
        verify(tokens).getTokenResponse(any()); verify(users).loadUser(any());
    }
    @Test void mismatchedStateCannotCreateVerifiedProofOrCallProvider() throws Exception {
        var start=mvc.perform(get("/oauth2/authorization/kakao")).andExpect(status().is3xxRedirection()).andReturn();
        mvc.perform(get("/login/oauth2/code/kakao").session((MockHttpSession)start.getRequest().getSession(false)).param("code","forged-code").param("state","wrong-state"))
                .andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("https://app.test/auth/callback?error=oauth_session_expired"));
        verifyNoInteractions(tokens,users);
    }
    @Test void providerCancellationAndTemporaryFailureUseOnlyFixedSafeCodes() throws Exception {
        for(var entry:Map.of("access_denied","oauth_cancelled","temporarily_unavailable","oauth_temporarily_unavailable","untrusted_provider_error","oauth_failed").entrySet()) {
            var start=mvc.perform(get("/oauth2/authorization/kakao")).andReturn();
            var session=(MockHttpSession)start.getRequest().getSession(false);
            String state=java.net.URLDecoder.decode(UriComponentsBuilder.fromUriString(start.getResponse().getRedirectedUrl()).build().getQueryParams().getFirst("state"),java.nio.charset.StandardCharsets.UTF_8);
            mvc.perform(get("/login/oauth2/code/kakao").session(session).param("state",state).param("error",entry.getKey())
                    .param("error_description","private@example.test provider secret"))
                    .andExpect(status().is3xxRedirection()).andExpect(header().string("Cache-Control","no-store"))
                    .andExpect(redirectedUrl("https://app.test/auth/callback?error="+entry.getValue()));
            assertThat(session.isInvalid()).isTrue();
        }
        verifyNoInteractions(tokens,users);
    }
    @Test void unverifiedKakaoEmailGetsSpecificErrorWithoutIdentityInRedirect() throws Exception {
        when(users.loadUser(any())).thenReturn(new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of("id",123L,"kakao_account",Map.of("email","private@example.test","is_email_valid",true,"is_email_verified",false)),"id"));
        var start=mvc.perform(get("/oauth2/authorization/kakao")).andReturn();
        String state=java.net.URLDecoder.decode(UriComponentsBuilder.fromUriString(start.getResponse().getRedirectedUrl()).build().getQueryParams().getFirst("state"),java.nio.charset.StandardCharsets.UTF_8);
        mvc.perform(get("/login/oauth2/code/kakao").session((MockHttpSession)start.getRequest().getSession(false)).param("state",state).param("code","test-code"))
                .andExpect(redirectedUrl("https://app.test/auth/callback?error=verified_email_required"));
    }
}
