package com.yogimangchi.content.auth;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.*;
import com.sun.net.httpserver.HttpServer;
import com.yogimangchi.content.support.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.*;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.oauth2.client.registration.*;
import org.springframework.web.util.UriComponentsBuilder;
import static org.assertj.core.api.Assertions.*;

/** Real servlet HTTP + default Spring OIDC signature/claims/nonce validation; only provider HTTP is local. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"content.oauth.enabled=true","content.auth.nickname-lookups-per-minute=2",
        "GOOGLE_CLIENT_ID=test-google","GOOGLE_CLIENT_SECRET=test-secret","KAKAO_CLIENT_ID=test-kakao","KAKAO_CLIENT_SECRET=test-secret"})
@Import({TestInfrastructure.class,OidcHttpIntegrationTests.ProviderConfiguration.class})
class OidcHttpIntegrationTests extends TestEnvironment {
    static final RSAKey KEY=key();
    static final AtomicReference<String> ID_TOKEN=new AtomicReference<>();
    static final AtomicInteger TOKEN_CALLS=new AtomicInteger();
    static final AtomicInteger TOKEN_STATUS=new AtomicInteger(200);
    static final HttpServer PROVIDER=provider();
    @LocalServerPort int port;
    @org.springframework.beans.factory.annotation.Autowired com.fasterxml.jackson.databind.ObjectMapper json;
    static RSAKey key() { try {return new RSAKeyGenerator(2048).keyID("provider-test").generate();}catch(Exception e){throw new ExceptionInInitializerError(e);} }
    static HttpServer provider() {
        try {
            var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/jwks",e->respond(e,new JWKSet(KEY.toPublicJWK()).toString()));
            server.createContext("/token",e->{TOKEN_CALLS.incrementAndGet();
                if(TOKEN_STATUS.get()!=200) {e.sendResponseHeaders(TOKEN_STATUS.get(),-1);e.close();return;}
                respond(e,"{\"access_token\":\"provider-test-only\",\"token_type\":\"Bearer\",\"expires_in\":300,\"scope\":\"openid email\",\"id_token\":\""+ID_TOKEN.get()+"\"}");});
            server.createContext("/userinfo",e->respond(e,"{\"sub\":\"test-google-sub\",\"email\":\"oidc@example.test\",\"email_verified\":true}"));
            server.start();return server;
        }catch(Exception e){throw new ExceptionInInitializerError(e);}
    }
    static void respond(com.sun.net.httpserver.HttpExchange e,String body) throws java.io.IOException {
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().set("Content-Type","application/json");
        e.sendResponseHeaders(200,bytes.length);try(var out=e.getResponseBody()){out.write(bytes);}e.close();
    }
    @TestConfiguration(proxyBeanMethods=false)
    static class ProviderConfiguration {
        @Bean @Primary ClientRegistrationRepository testClients() {
            String base="http://127.0.0.1:"+PROVIDER.getAddress().getPort();
            return new InMemoryClientRegistrationRepository(CommonOAuth2Provider.GOOGLE.getBuilder("google")
                    .clientId("test-google").clientSecret("test-secret").scope("openid","email")
                    .tokenUri(base+"/token").jwkSetUri(base+"/jwks").userInfoUri(base+"/userinfo").build());
        }
    }
    @AfterAll static void closeProvider(){PROVIDER.stop(0);}
    private HttpClient browserTransport() {return HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER)
            .cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();}
    private HttpResponse<String> get(HttpClient client,String path) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).GET().build(),HttpResponse.BodyHandlers.ofString());
    }
    private Map<String,String> start(HttpClient client) throws Exception {
        var response=get(client,"/oauth2/authorization/google");assertThat(response.statusCode()).isEqualTo(302);
        var params=UriComponentsBuilder.fromUriString(response.headers().firstValue("Location").orElseThrow()).build().getQueryParams();
        return Map.of("state",params.getFirst("state"),"nonce",URLDecoder.decode(params.getFirst("nonce"),StandardCharsets.UTF_8));
    }
    private String signed(String nonce,String fault) throws Exception {
        Instant now=Instant.now();
        var claims=new JWTClaimsSet.Builder().issuer(fault.equals("issuer")?"https://wrong.test":"https://accounts.google.com")
                .subject("test-google-sub").audience(fault.equals("audience")?"wrong-client":"test-google")
                .issueTime(Date.from(now.minusSeconds(120))).expirationTime(Date.from(fault.equals("expired")?now.minusSeconds(120):now.plusSeconds(300)))
                .claim("nonce",fault.equals("nonce")?"wrong-nonce":nonce).claim("email","oidc@example.test").claim("email_verified",true).build();
        var jwt=new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(KEY.getKeyID()).build(),claims);
        jwt.sign(new RSASSASigner(fault.equals("signature")?key():KEY));return jwt.serialize();
    }
    @Test void signedGoogleIdTokenCrossesRealHttpCallbackThenProofIsAvailableWithoutUrlSecrets() throws Exception {
        var client=browserTransport();var flow=start(client);ID_TOKEN.set(signed(flow.get("nonce"),"valid"));
        var result=get(client,"/login/oauth2/code/google?code=test-code&state="+flow.get("state"));
        assertThat(result.statusCode()).isEqualTo(302);
        assertThat(result.headers().firstValue("Location")).hasValue("https://app.test/auth/callback");
        assertThat(result.headers().firstValue("Cache-Control")).hasValue("no-store");
        var proof=get(client,"/api/v1/auth/flow");assertThat(proof.statusCode()).isEqualTo(200);
        assertThat(proof.body()).contains("GOOGLE");
        assertThat(result.headers().firstValue("Set-Cookie").orElse("")).contains("CONTENT_SESSION","HttpOnly","SameSite=Lax");
    }
    @ParameterizedTest @ValueSource(strings={"nonce","signature","audience","issuer","expired"})
    void invalidGoogleIdTokenCannotCreateProof(String fault) throws Exception {
        var client=browserTransport();var flow=start(client);ID_TOKEN.set(signed(flow.get("nonce"),fault));
        var result=get(client,"/login/oauth2/code/google?code=test-code&state="+flow.get("state"));
        assertThat(result.statusCode()).isEqualTo(302);
        assertThat(result.headers().firstValue("Location")).hasValue("https://app.test/auth/callback?error=oauth_invalid_response");
        assertThat(get(client,"/api/v1/auth/flow").statusCode()).isEqualTo(401);
    }
    @Test void invalidStateIsRejectedBeforeAnyTokenExchangeOverHttp() throws Exception {
        var client=browserTransport();start(client);int before=TOKEN_CALLS.get();
        var result=get(client,"/login/oauth2/code/google?code=test-code&state=wrong");
        assertThat(result.headers().firstValue("Location")).hasValue("https://app.test/auth/callback?error=oauth_session_expired");
        assertThat(TOKEN_CALLS.get()).isEqualTo(before);assertThat(get(client,"/api/v1/auth/flow").statusCode()).isEqualTo(401);
    }
    @Test void providerHttpOutageReturnsSafeTemporaryFailureAndNoProof() throws Exception {
        var client=browserTransport();var flow=start(client);TOKEN_STATUS.set(503);
        try {
            var response=get(client,"/login/oauth2/code/google?code=test-code&state="+flow.get("state"));
            assertThat(response.headers().firstValue("Location")).hasValue("https://app.test/auth/callback?error=oauth_temporarily_unavailable");
            assertThat(get(client,"/api/v1/auth/flow").statusCode()).isEqualTo(401);
        }finally{TOKEN_STATUS.set(200);}
    }
    private HttpResponse<String> post(HttpClient client,String path,String body) throws Exception {
        var csrf=json.readTree(get(client,"/api/v1/auth/csrf").body());
        return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path))
                .header(csrf.path("headerName").asText(),csrf.path("token").asText()).header("Content-Type","application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    private void oauth(HttpClient client) throws Exception {
        var flow=start(client);ID_TOKEN.set(signed(flow.get("nonce"),"valid"));
        assertThat(get(client,"/login/oauth2/code/google?code=test-code&state="+flow.get("state")).headers().firstValue("Location"))
                .hasValue("https://app.test/auth/callback");
    }
    @Test void signupRefreshLogoutAndReloginWorkOverRealHttpWithSessionCsrfAndCookies() throws Exception {
        var client=browserTransport();oauth(client);
        String body="{\"nickname\":\"http회원\",\"termAgree\":true,\"privateAgree\":true,\"termsVersion\":\"ym-terms-v1\",\"privacyVersion\":\"ym-privacy-v1\"}";
        var signup=post(client,"/api/v1/auth/signup",body);assertThat(signup.statusCode()).isEqualTo(200);
        String cookie=refreshCookie(signup);
        assertThat(cookie).contains("CONTENT_REFRESH=","HttpOnly","SameSite=Lax","Path=/api/v1/auth").doesNotContain("Domain=");
        var access=json.readTree(signup.body());assertThat(access.path("expiresIn").asInt()).isEqualTo(900);
        var profile=client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/members/me"))
                .header("Authorization","Bearer "+access.path("accessToken").asText()).GET().build(),HttpResponse.BodyHandlers.ofString());
        assertThat(profile.statusCode()).isEqualTo(200);
        var duplicate=post(client,"/api/v1/auth/signup",body);assertThat(duplicate.statusCode()).isEqualTo(401);
        assertThat(duplicate.body()).contains("LOGIN_PROOF_REQUIRED");assertThat(duplicate.headers().allValues("Set-Cookie")).isEmpty();
        var refresh=post(client,"/api/v1/auth/refresh","{}");assertThat(refresh.statusCode()).isEqualTo(200);
        assertThat(refreshCookie(refresh)).isNotEqualTo(cookie);
        var logout=post(client,"/api/v1/auth/logout","{}");assertThat(logout.statusCode()).isEqualTo(204);
        assertThat(refreshCookie(logout)).contains("Max-Age=0");
        oauth(client);assertThat(get(client,"/api/v1/auth/flow").body()).contains("LOGIN_READY");
        var login=post(client,"/api/v1/auth/login/complete","{}");assertThat(login.statusCode()).isEqualTo(200);
        assertThat(json.readTree(login.body()).path("memberId")).isEqualTo(access.path("memberId"));
    }
    @Test void nicknameLimitIs429WithCorsReadableRetryAfterAndDoesNotBlockCsrf() throws Exception {
        var client=browserTransport();String path="/api/v1/members/nickname/availability?nickname=lookup";
        assertThat(get(client,path).statusCode()).isEqualTo(200);assertThat(get(client,path).statusCode()).isEqualTo(200);
        var response=client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Origin","https://app.test").GET().build(),HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(429);assertThat(response.body()).contains("RATE_LIMITED");
        assertThat(response.headers().firstValue("Access-Control-Expose-Headers").orElseThrow()).contains("Retry-After");
        assertThat(Integer.parseInt(response.headers().firstValue("Retry-After").orElseThrow())).isBetween(1,60);
        assertThat(get(client,"/api/v1/auth/csrf").statusCode()).isEqualTo(200);
    }
    private String refreshCookie(HttpResponse<?> response) {
        return response.headers().allValues("Set-Cookie").stream().filter(c->c.startsWith("CONTENT_REFRESH=")).findFirst().orElseThrow();
    }
}
