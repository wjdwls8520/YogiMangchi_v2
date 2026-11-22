package com.yogimangchi.content.member.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.ops.OpsAlertService;
import com.yogimangchi.content.ops.RequestIdMdcFilter;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

/**
 * HTTP dispatcher and scheduled retry sweep for content.member_suspension_delivery outbox.
 * Runs strictly outside Content DB transactions. Sends RS256 internal JWT (token_use="member_suspension",
 * aud=["trading-internal"], exp-iat<=60s) + X-Request-Id header to trading-server.
 */
@Service
public class MemberSuspensionDelivery {
    private static final Logger log = LoggerFactory.getLogger(MemberSuspensionDelivery.class);

    public record SuspensionPayload(boolean suspended, String reason) { }

    private final MemberSuspensionOutbox outbox;
    private final JwtEncoder encoder;
    private final ObjectMapper json;
    private final OpsAlertService alerts;
    private final String issuer;
    private final String keyId;
    private final String baseUrl;
    private final boolean deliveryEnabled;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    public MemberSuspensionDelivery(
            MemberSuspensionOutbox outbox,
            JwtEncoder encoder,
            ObjectMapper json,
            OpsAlertService alerts,
            String issuer,
            String keyId,
            String baseUrl,
            boolean deliveryEnabled) {
        this.outbox = outbox;
        this.encoder = encoder;
        this.json = json;
        this.alerts = alerts;
        this.issuer = issuer;
        this.keyId = keyId;
        this.baseUrl = normalizeTrustedBaseUrl(baseUrl, deliveryEnabled);
        this.deliveryEnabled = deliveryEnabled;
    }

    @Autowired
    public MemberSuspensionDelivery(
            MemberSuspensionOutbox outbox,
            JwtEncoder encoder,
            ObjectMapper json,
            @Autowired(required = false) OpsAlertService alerts,
            @Value("${content.auth.issuer}") String issuer,
            @Value("${content.auth.key-id}") String keyId,
            @Value("${content.withdrawal.trading-base-url:http://localhost:8081}") String baseUrl,
            @Value("${content.withdrawal.delivery-enabled:true}") boolean deliveryEnabled,
            @Value("${content.suspension.poll-enabled:true}") boolean unusedPollFlag) {
        this(outbox, encoder, json, alerts, issuer, keyId, baseUrl, deliveryEnabled);
    }

    public void dispatchAfterCommitAsync(long deliveryId, String requestId) {
        if (!deliveryEnabled || baseUrl == null) {
            return;
        }
        String effectiveReqId = RequestIdMdcFilter.sanitize(requestId);
        if (effectiveReqId == null) {
            effectiveReqId = RequestIdMdcFilter.generateId();
        }
        final String traceId = effectiveReqId;
        CompletableFuture.runAsync(() -> outbox.findPendingById(deliveryId)
                .ifPresent(task -> deliverSingle(task, traceId)));
    }

    @Scheduled(fixedDelayString = "${content.withdrawal.poll-ms:5000}")
    public void scheduledDeliverPending() {
        if (!deliveryEnabled || baseUrl == null) {
            return;
        }
        deliverPending();
        checkAndAlertStuckDeliveries();
    }

    public int deliverPending() {
        if (baseUrl == null) {
            return 0;
        }
        int delivered = 0;
        for (MemberSuspensionOutbox.DeliveryTask task : outbox.pending()) {
            if (deliverSingle(task, RequestIdMdcFilter.currentOrGenerate())) {
                delivered++;
            }
        }
        return delivered;
    }

    public boolean deliverSingle(MemberSuspensionOutbox.DeliveryTask task, String requestId) {
        if (task == null || baseUrl == null) {
            return false;
        }
        String effectiveReqId = RequestIdMdcFilter.sanitize(requestId);
        if (effectiveReqId == null) {
            effectiveReqId = RequestIdMdcFilter.currentOrGenerate();
        }
        try {
            Instant now = Instant.now();
            var claims = JwtClaimsSet.builder()
                    .issuer(issuer)
                    .subject(Long.toString(task.memberId()))
                    .issuedAt(now)
                    .expiresAt(now.plusSeconds(60))
                    .audience(List.of("trading-internal"))
                    .id(UUID.randomUUID().toString())
                    .claim("token_use", "member_suspension")
                    .build();
            String token = encoder.encode(
                    JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).keyId(keyId).build(), claims))
                    .getTokenValue();

            String payloadJson = json.writeValueAsString(new SuspensionPayload(task.suspended(), task.reason()));
            var request = HttpRequest.newBuilder(
                            URI.create(baseUrl + "/internal/v1/members/" + task.memberId() + "/suspension"))
                    .timeout(Duration.ofSeconds(3))
                    .header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json")
                    .header(RequestIdMdcFilter.HEADER_NAME, effectiveReqId)
                    .POST(HttpRequest.BodyPublishers.ofString(payloadJson))
                    .build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            int status = response.statusCode();
            response.body().close();
            if (status == 204) {
                outbox.markDelivered(task.id());
                return true;
            }
            String err = "HTTP_" + status;
            int attempts = outbox.markFailed(task.id(), err);
            log.warn("Member suspension delivery deferred deliveryId={} memberId={} suspended={} attempts={} httpStatus={} reqId={}",
                    task.id(), task.memberId(), task.suspended(), attempts, status, effectiveReqId);
            alertIfStuck(task, attempts, err, effectiveReqId);
            return false;
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Exception failure) {
            String err = failure.getClass().getSimpleName();
            int attempts = outbox.markFailed(task.id(), err);
            log.warn("Member suspension delivery deferred deliveryId={} memberId={} suspended={} attempts={} cause={} reqId={}",
                    task.id(), task.memberId(), task.suspended(), attempts, err, effectiveReqId);
            alertIfStuck(task, attempts, err, effectiveReqId);
            return false;
        }
    }

    public void checkAndAlertStuckDeliveries() {
        if (alerts == null) {
            return;
        }
        List<MemberSuspensionOutbox.DeliveryTask> stuck = outbox.findStuckPending();
        if (!stuck.isEmpty()) {
            MemberSuspensionOutbox.DeliveryTask oldest = stuck.get(0);
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("stuckCount", stuck.size());
            details.put("oldestDeliveryId", oldest.id());
            details.put("memberId", oldest.memberId());
            details.put("suspended", oldest.suspended());
            details.put("attempts", oldest.attemptCount());
            alerts.alert("member-suspension-delivery-stuck", "CRITICAL",
                    "Member suspension delivery outbox has stuck items", details);
        }
    }

    private void alertIfStuck(MemberSuspensionOutbox.DeliveryTask task, int attempts, String error, String reqId) {
        if (alerts == null) {
            return;
        }
        boolean agedOut = task.createdAt() != null && task.createdAt().isBefore(Instant.now().minus(Duration.ofMinutes(5)));
        if (attempts >= 3 || agedOut) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("deliveryId", task.id());
            details.put("memberId", task.memberId());
            details.put("suspended", task.suspended());
            details.put("attempts", attempts);
            details.put("error", error);
            details.put("requestId", reqId);
            alerts.alert("member-suspension-delivery-stuck", "CRITICAL",
                    "Member suspension propagation to trading-server failing", details);
        }
    }

    private static String normalizeTrustedBaseUrl(String raw, boolean required) {
        if (raw == null || raw.isBlank()) {
            if (required) {
                throw new IllegalArgumentException("Explicit trusted Trading base URL required");
            }
            return null;
        }
        URI uri = URI.create(raw.strip());
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || !Set.of("http", "https").contains(uri.getScheme())
                || !Set.of("", "/").contains(uri.getPath())) {
            throw new IllegalArgumentException("Explicit trusted Trading base URL required");
        }
        String trimmed = raw.strip();
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }
}
