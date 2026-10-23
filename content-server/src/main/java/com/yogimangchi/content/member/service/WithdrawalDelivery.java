package com.yogimangchi.content.member.service;

import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.*;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;

/** HTTP is deliberately outside the Content transaction. Trading commits before a successful acknowledgement. */
@Configuration(proxyBeanMethods=false) @EnableScheduling
@ConditionalOnProperty(name="content.withdrawal.delivery-enabled",havingValue="true")
public class WithdrawalDelivery {
    private static final Logger log=LoggerFactory.getLogger(WithdrawalDelivery.class);
    private final MemberWithdrawals withdrawals;
    private final JwtEncoder encoder;
    private final String issuer,keyId,baseUrl;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
    public WithdrawalDelivery(MemberWithdrawals withdrawals,JwtEncoder encoder,@Value("${content.auth.issuer}") String issuer,
            @Value("${content.auth.key-id}") String keyId,@Value("${content.withdrawal.trading-base-url}") String baseUrl) {
        URI uri=URI.create(baseUrl);
        if(uri.getHost()==null || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null
                || !(uri.getScheme().equals("https") || uri.getScheme().equals("http")) || !Set.of("","/").contains(uri.getPath()))
            throw new IllegalArgumentException("Explicit trusted Trading base URL required");
        this.withdrawals=withdrawals; this.encoder=encoder; this.issuer=issuer; this.keyId=keyId;
        this.baseUrl=baseUrl.endsWith("/") ? baseUrl.substring(0,baseUrl.length()-1) : baseUrl;
    }
    @Scheduled(fixedDelayString="${content.withdrawal.poll-ms:5000}")
    public void deliverPending() {
        for(Long id:withdrawals.pending()) {
            try {
                Instant now=Instant.now();
                var claims=JwtClaimsSet.builder().issuer(issuer).subject(id.toString()).issuedAt(now).expiresAt(now.plusSeconds(60))
                        .audience(List.of("trading-internal")).id(UUID.randomUUID().toString()).claim("token_use","member_withdrawal").build();
                String token=encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).keyId(keyId).build(),claims)).getTokenValue();
                var request=HttpRequest.newBuilder(URI.create(baseUrl+"/internal/v1/members/"+id+"/withdrawal"))
                        .timeout(Duration.ofSeconds(3)).header("Authorization","Bearer "+token).POST(HttpRequest.BodyPublishers.noBody()).build();
                var response=client.send(request,HttpResponse.BodyHandlers.ofInputStream());
                int status=response.statusCode();
                // Only the acknowledgement status is needed; do not wait for an arbitrary response body.
                response.body().close();
                if(status==204) withdrawals.delivered(id);
                else {
                    withdrawals.failed(id);
                    log.warn("Member withdrawal delivery deferred HTTP status={}",status);
                }
            } catch(InterruptedException failure) { Thread.currentThread().interrupt(); return; }
            catch(Exception failure) {
                withdrawals.failed(id);
                log.warn("Member withdrawal delivery deferred: {}",failure.getClass().getSimpleName());
            }
        }
    }
}
