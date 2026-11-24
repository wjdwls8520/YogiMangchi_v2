package com.yogimangchi.content.auth.oauth;

import com.yogimangchi.content.error.AuthFailure;
import jakarta.servlet.http.*;
import java.net.URI;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.client.*;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.client.endpoint.*;
import org.springframework.security.oauth2.client.registration.*;
import org.springframework.security.oauth2.client.userinfo.*;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.NullSecurityContextRepository;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.http.converter.FormHttpMessageConverter;
import org.springframework.security.oauth2.core.http.converter.OAuth2AccessTokenResponseHttpMessageConverter;
import org.springframework.security.oauth2.client.http.OAuth2ErrorResponseErrorHandler;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name="content.oauth.enabled",havingValue="true")
public class OAuthConfiguration {
    private static final Logger log=LoggerFactory.getLogger(OAuthConfiguration.class);
    @Bean
    ClientRegistrationRepository clients(@Value("${GOOGLE_CLIENT_ID}") String googleId,@Value("${GOOGLE_CLIENT_SECRET}") String googleSecret,
            @Value("${KAKAO_CLIENT_ID}") String kakaoId,@Value("${KAKAO_CLIENT_SECRET}") String kakaoSecret) {
        // Explicit registrations: adding another provider is not possible through arbitrary property binding.
        var google=org.springframework.security.config.oauth2.client.CommonOAuth2Provider.GOOGLE.getBuilder("google")
                .clientId(googleId).clientSecret(googleSecret).scope("openid","profile","email").build();
        var kakao=ClientRegistration.withRegistrationId("kakao").clientId(kakaoId).clientSecret(kakaoSecret)
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST).authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}").scope("account_email")
                .authorizationUri("https://kauth.kakao.com/oauth/authorize").tokenUri("https://kauth.kakao.com/oauth/token")
                .userInfoUri("https://kapi.kakao.com/v2/user/me").userNameAttributeName("id").clientName("Kakao").build();
        return new InMemoryClientRegistrationRepository(List.of(google,kakao));
    }
    private SimpleClientHttpRequestFactory requestFactory() {
        var factory=new SimpleClientHttpRequestFactory(); factory.setConnectTimeout(3000); factory.setReadTimeout(5000); return factory;
    }
    @Bean OAuth2UserService<OAuth2UserRequest,OAuth2User> oauthUsers() {
        var rest=new RestTemplate(requestFactory()); rest.setErrorHandler(new OAuth2ErrorResponseErrorHandler());
        var service=new DefaultOAuth2UserService(); service.setRestOperations(rest); return service;
    }
    @Bean OAuth2AccessTokenResponseClient<OAuth2AuthorizationCodeGrantRequest> oauthTokens() {
        var client=new RestClientAuthorizationCodeTokenResponseClient();
        client.setRestClient(RestClient.builder().requestFactory(requestFactory()).messageConverters(converters -> {
            converters.clear(); converters.add(new FormHttpMessageConverter()); converters.add(new OAuth2AccessTokenResponseHttpMessageConverter());
        }).defaultStatusHandler(new OAuth2ErrorResponseErrorHandler()).build());
        return client;
    }
    @Bean
    @Order(1)
    SecurityFilterChain oauthChain(HttpSecurity http,ClientRegistrationRepository clients,
            OAuth2UserService<OAuth2UserRequest,OAuth2User> users,OAuth2AccessTokenResponseClient<OAuth2AuthorizationCodeGrantRequest> tokens,
            @Value("${content.auth.frontend-return-uri}") String returnUri,
            @Value("${content.auth.secure-cookies}") boolean secure) throws Exception {
        URI target=URI.create(returnUri);
        if(target.getHost()==null || target.getUserInfo()!=null || target.getQuery()!=null || target.getFragment()!=null
                || !(target.getScheme().equals("https") || !secure && target.getScheme().equals("http"))) throw new IllegalArgumentException("Invalid OAuth return URI");
        var oidcUsers=new OidcUserService(); oidcUsers.setOauth2UserService(users);
        http.securityMatcher("/oauth2/**","/login/oauth2/**")
                .authorizeHttpRequests(a -> a.anyRequest().permitAll())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .securityContext(c -> c.securityContextRepository(new NullSecurityContextRepository()))
                .requestCache(c -> c.disable())
                .oauth2Login(oauth -> oauth.clientRegistrationRepository(clients)
                        .authorizedClientRepository(new NoStoredProviderTokens())
                        .tokenEndpoint(t -> t.accessTokenResponseClient(tokens))
                        .userInfoEndpoint(u -> u.userService(users).oidcUserService(oidcUsers))
                        .successHandler((request,response,authentication) -> {
                            try {
                                var identity=VerifiedIdentity.from((OAuth2AuthenticationToken)authentication);
                                var session=request.getSession(true); request.changeSessionId();
                                session.setAttribute(VerifiedIdentity.SESSION_KEY,identity);
                                response.setHeader("Cache-Control","no-store"); response.sendRedirect(returnUri);
                            } catch(AuthFailure failure) {
                                String code=switch(failure.code()) {
                                    case "VERIFIED_EMAIL_REQUIRED" -> "verified_email_required";
                                    case "OAUTH_IDENTITY_INVALID" -> "oauth_invalid_response";
                                    default -> "oauth_failed";
                                };
                                log.info("OAuth login proof rejected reason={}",code);
                                if(request.getSession(false)!=null) request.getSession(false).invalidate();
                                response.setHeader("Cache-Control","no-store");
                                response.sendRedirect(returnUri+"?error="+code);
                            }
                        }).failureHandler((request,response,failure) -> {
                            String code=OAuthErrors.code(failure);
                            log.info("OAuth login rejected reason={}",code);
                            if(request.getSession(false)!=null) request.getSession(false).invalidate();
                            response.setHeader("Cache-Control","no-store");
                            response.sendRedirect(returnUri+"?error="+code);
                        }));
        return http.build();
    }
    /** Provider tokens are used only to verify identity, not retained as Yogimangchi API credentials. */
    private static class NoStoredProviderTokens implements OAuth2AuthorizedClientRepository {
        @Override public <T extends OAuth2AuthorizedClient> T loadAuthorizedClient(String registration,Authentication principal,HttpServletRequest request) { return null; }
        @Override public void saveAuthorizedClient(OAuth2AuthorizedClient client,Authentication principal,HttpServletRequest request,HttpServletResponse response) { }
        @Override public void removeAuthorizedClient(String registration,Authentication principal,HttpServletRequest request,HttpServletResponse response) { }
    }
}
