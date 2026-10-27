package com.yogimangchi.content.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.support.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;

/** Real HTTP/cookie transport with isolated identities; not a browser or external OAuth E2E. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties="content.oauth.enabled=false")
@Import(TestInfrastructure.class)
class MemberSessionHttpIntegrationTests extends TestEnvironment {
    @LocalServerPort int port;
    @Autowired AuthService auth;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    @Test void signupReloginAndRefreshAccessVerifyUsingOnlyThePublishedPublicKey() throws Exception {
        var proof=identity();var signup=signup(proof);
        var cookies=cookies(signup.refresh());var client=document(cookies);
        var published=get(client,"/.well-known/jwks.json");
        assertThat(published.statusCode()).isEqualTo(200);
        var keys=JWKSet.parse(published.body());
        assertThat(keys.getKeys()).hasSize(1);
        assertThat(keys.getKeys().get(0).isPrivate()).isFalse();
        var publicKey=(RSAKey)keys.getKeys().get(0);

        verifyAccess(signup.access().accessToken(),publicKey,signup.access().memberId());
        var relogin=auth.completeLogin(proof);
        verifyAccess(relogin.access().accessToken(),publicKey,signup.access().memberId());
        var refreshed=post(client,"/api/v1/auth/refresh",true);
        assertThat(refreshed.statusCode()).isEqualTo(200);
        verifyAccess(json.readTree(refreshed.body()).path("accessToken").asText(),publicKey,signup.access().memberId());
        assertThat(jdbc.queryForObject("select count(*) from content.member_trading_provision where member_id=?",Long.class,signup.access().memberId())).isEqualTo(1);
    }

    @Test void serializedNewDocumentsRotateTheSharedCookieWithoutRevokingTheFamilyUntilLogout() throws Exception {
        var signup=signup(identity());var cookies=cookies(signup.refresh());
        var expiry=signup.refreshExpiresAt();
        for(int i=0;i<24;i++) {
            // New document has no in-memory Access. Shared cookie is read at request time,
            // after the preceding response, as required by Frontend's cross-tab cookie lock.
            var response=post(document(cookies),"/api/v1/auth/refresh",true);
            assertThat(response.statusCode()).as("serialized rotation %s",i).isEqualTo(200);
            assertThat(response.headers().firstValue("Cache-Control")).hasValue("no-store");
            assertThat(response.headers().allValues("Set-Cookie").stream().anyMatch(c->c.startsWith("CONTENT_REFRESH=") && c.contains("HttpOnly") && c.contains("SameSite=Lax"))).isTrue();
        }
        Long id=signup.access().memberId();
        assertThat(jdbc.queryForObject("select count(distinct family_id) from content.refresh_session where member_id=?",Long.class,id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='ACTIVE'",Long.class,id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='ROTATED'",Long.class,id)).isEqualTo(24);
        assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and expires_at<>?",Long.class,id,java.sql.Timestamp.from(expiry))).isZero();

        assertThat(post(document(cookies),"/api/v1/auth/logout",true).statusCode()).isEqualTo(204);
        assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status<>'REVOKED'",Long.class,id)).isZero();
        var denied=post(document(cookies),"/api/v1/auth/refresh",true);
        assertThat(denied.statusCode()).isEqualTo(401);
        assertThat(json.readTree(denied.body()).path("code").asText()).isEqualTo("AUTHENTICATION_REQUIRED");
        assertThat(denied.headers().allValues("Set-Cookie")).isEmpty();
    }

    @Test void missingTemporarySessionRejectsWithoutRotationThenCsrfBootstrapRestoresRefresh() throws Exception {
        var signup=signup(identity());var client=document(cookies(signup.refresh()));
        var rejected=post(client,"/api/v1/auth/refresh",false);
        assertThat(rejected.statusCode()).isEqualTo(403);
        assertThat(json.readTree(rejected.body()).path("code").asText()).isEqualTo("CSRF_INVALID");
        assertThat(rejected.headers().allValues("Set-Cookie").stream().noneMatch(c->c.startsWith("CONTENT_REFRESH="))).isTrue();
        assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='ROTATED'",Long.class,signup.access().memberId())).isZero();
        var recovered=post(client,"/api/v1/auth/refresh",true);
        assertThat(recovered.statusCode()).isEqualTo(200);
        assertThat(json.readTree(recovered.body()).path("memberId").asLong()).isEqualTo(signup.access().memberId());
    }

    @Test void losingHeadersThenExplicitlyRedeliveringTheSameRequestRevokesTheRealRefreshFamily() throws Exception {
        var signup=signup(identity());var cookies=cookies(signup.refresh());var client=document(cookies);
        var csrf=json.readTree(get(client,"/api/v1/auth/csrf").body());
        String cookie=String.join("; ",cookies.get(uri("/api/v1/auth/refresh"),Map.of()).get("Cookie"));
        String requestId=UUID.randomUUID().toString();
        var deliveries=new AtomicInteger();var statuses=new ConcurrentLinkedQueue<Integer>();var ids=new ConcurrentLinkedQueue<String>();
        var proxy=lossProxy(false,deliveries,statuses,ids);
        try {
            String request="POST /api/v1/auth/refresh HTTP/1.1\r\nHost: 127.0.0.1:"+proxy.getAddress().getPort()
                    +"\r\nCookie: "+cookie+"\r\n"+csrf.path("headerName").asText()+": "+csrf.path("token").asText()
                    +"\r\nX-QA-Request-ID: "+requestId+"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            // A raw socket sends exactly once, so this baseline cannot hide a client retry.
            assertThat(rawRequest(proxy,request).length).isZero();
            assertThat(deliveries.get()).isEqualTo(1);
            assertThat(statuses).containsExactly(200);
            assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='ACTIVE'",Long.class,signup.access().memberId())).isEqualTo(1);
            assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='ROTATED'",Long.class,signup.access().memberId())).isEqualTo(1);

            // Simulate a transport/browser redelivery, not an intentional second UI action.
            String replay=new String(rawRequest(proxy,request),StandardCharsets.UTF_8);
            assertThat(replay.startsWith("HTTP/1.1 401")).isTrue();
            assertThat(replay).contains("AUTHENTICATION_REQUIRED").doesNotContain("Set-cookie:","Set-Cookie:");
            assertThat(deliveries.get()).isEqualTo(2);
            assertThat(ids).containsExactly(requestId,requestId);
            assertThat(statuses).containsExactly(200,401);
            assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status<>'REVOKED'",Long.class,signup.access().memberId())).isZero();
        } finally {proxy.stop(0);}
    }

    @Test void losingOnlyTheBodyCanKeepTheSuccessorCookieAndASerializedRefreshStillWorks() throws Exception {
        var signup=signup(identity());var cookies=cookies(signup.refresh());var client=document(cookies);
        var csrf=json.readTree(get(client,"/api/v1/auth/csrf").body());
        var deliveries=new AtomicInteger();var statuses=new ConcurrentLinkedQueue<Integer>();var ids=new ConcurrentLinkedQueue<String>();
        var proxy=lossProxy(true,deliveries,statuses,ids);
        try {
            var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+proxy.getAddress().getPort()+"/api/v1/auth/refresh"))
                    .timeout(Duration.ofSeconds(8)).header(csrf.path("headerName").asText(),csrf.path("token").asText())
                    .header("X-QA-Request-ID",UUID.randomUUID().toString()).POST(HttpRequest.BodyPublishers.noBody()).build();
            assertThatThrownBy(()->client.send(request,HttpResponse.BodyHandlers.ofString())).isInstanceOf(java.io.IOException.class);
            assertThat(deliveries.get()).isEqualTo(1);
            assertThat(statuses).containsExactly(200);
            assertThat(cookies.getCookieStore().getCookies().stream().filter(c->c.getName().equals("CONTENT_REFRESH"))
                    .anyMatch(c->!c.getValue().equals(signup.refresh()))).as("HTTP client accepted the successor header before losing the body").isTrue();
            assertThat(post(document(cookies),"/api/v1/auth/refresh",true).statusCode()).isEqualTo(200);
            assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='ACTIVE'",Long.class,signup.access().memberId())).isEqualTo(1);
            assertThat(jdbc.queryForObject("select count(*) from content.refresh_session where member_id=? and status='REVOKED'",Long.class,signup.access().memberId())).isZero();
        } finally {proxy.stop(0);}
    }

    private HttpServer lossProxy(boolean sendHeaders,AtomicInteger deliveries,Queue<Integer> statuses,Queue<String> ids) throws Exception {
        var proxy=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        // A proxy forwards the caller's cookie; it must never retain a successor of its own.
        var upstream=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        proxy.createContext("/api/v1/auth/refresh",exchange->{
            int delivery=deliveries.incrementAndGet();ids.add(exchange.getRequestHeaders().getFirst("X-QA-Request-ID"));
            try {
                var request=HttpRequest.newBuilder(uri("/api/v1/auth/refresh")).timeout(Duration.ofSeconds(8));
                for(String name:List.of("Cookie","X-CSRF-TOKEN"))
                    for(String value:exchange.getRequestHeaders().getOrDefault(name,List.of())) request.header(name,value);
                var response=upstream.send(request.POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofByteArray());
                statuses.add(response.statusCode());
                if(delivery==1 && !sendHeaders) return;
                for(String name:List.of("Set-Cookie","Content-Type","Cache-Control"))
                    for(String value:response.headers().allValues(name)) exchange.getResponseHeaders().add(name,value);
                exchange.sendResponseHeaders(response.statusCode(),response.body().length);
                if(delivery==1) exchange.getResponseBody().write(response.body(),0,1);
                else exchange.getResponseBody().write(response.body());
            } catch(InterruptedException failure) {Thread.currentThread().interrupt();}
            finally {exchange.close();}
        });
        proxy.start();return proxy;
    }
    private byte[] rawRequest(HttpServer proxy,String request) throws Exception {
        try(var socket=new Socket("127.0.0.1",proxy.getAddress().getPort())) {
            socket.setSoTimeout(10000);
            socket.getOutputStream().write(request.getBytes(StandardCharsets.UTF_8));socket.getOutputStream().flush();
            return socket.getInputStream().readAllBytes();
        }
    }

    private void verifyAccess(String token,RSAKey key,Long memberId) throws Exception {
        var jwt=SignedJWT.parse(token);
        assertThat(jwt.getHeader().getAlgorithm().getName()).isEqualTo("RS256");
        assertThat(jwt.getHeader().getKeyID()).isEqualTo(key.getKeyID());
        assertThat(jwt.verify(new RSASSAVerifier(key))).as("Signature must match the anonymous HTTP JWKS").isTrue();
        var claims=jwt.getJWTClaimsSet();
        assertThat(claims.getIssuer()).isEqualTo("https://content.test");
        assertThat(claims.getSubject()).isEqualTo(memberId.toString());
        assertThat(claims.getAudience()).containsExactlyInAnyOrder("content","trading");
        assertThat(claims.getStringClaim("token_use")).isEqualTo("access");
        assertThat(claims.getStringListClaim("roles")).contains("MEMBER");
        assertThat(Duration.between(claims.getIssueTime().toInstant(),claims.getExpirationTime().toInstant())).isEqualTo(Duration.ofMinutes(15));
        assertThat(claims.getExpirationTime().toInstant()).isAfter(Instant.now());
        assertThat(claims.getClaims()).doesNotContainKeys("email","provider","providerSubject","refreshToken");
        var response=document(new CookieManager()).send(HttpRequest.newBuilder(uri("/api/v1/members/me"))
                .header("Authorization","Bearer "+token).GET().build(),HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
    }
    private CookieManager cookies(String refresh) {
        var manager=new CookieManager(null,CookiePolicy.ACCEPT_ALL);
        var cookie=new HttpCookie("CONTENT_REFRESH",refresh);cookie.setVersion(0);cookie.setPath("/api/v1/auth");cookie.setDomain("127.0.0.1");
        manager.getCookieStore().add(uri("/"),cookie);return manager;
    }
    private HttpClient document(CookieManager cookies) {
        return HttpClient.newBuilder().cookieHandler(cookies).connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
    }
    private URI uri(String path) { return URI.create("http://127.0.0.1:"+port+path); }
    private HttpResponse<String> get(HttpClient client,String path) throws Exception {
        return client.send(HttpRequest.newBuilder(uri(path)).timeout(Duration.ofSeconds(8)).GET().build(),HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<String> post(HttpClient client,String path,boolean withCsrf) throws Exception {
        var request=HttpRequest.newBuilder(uri(path)).timeout(Duration.ofSeconds(8));
        if(withCsrf) {
            var csrf=json.readTree(get(client,"/api/v1/auth/csrf").body());
            request.header(csrf.path("headerName").asText(),csrf.path("token").asText());
        }
        return client.send(request.POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());
    }
    private AuthService.Issued signup(VerifiedIdentity identity) {
        return auth.signup(identity,new SignupRequest(UUID.randomUUID().toString().substring(0,8),true,true,"","ym-terms-v1","ym-privacy-v1"));
    }
    private VerifiedIdentity identity() {
        return new VerifiedIdentity(Provider.GOOGLE,UUID.randomUUID().toString(),"isolated@example.test",Instant.now().plusSeconds(300));
    }
}
