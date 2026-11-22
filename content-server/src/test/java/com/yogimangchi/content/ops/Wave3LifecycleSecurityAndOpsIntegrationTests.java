package com.yogimangchi.content.ops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.RSAKey;
import com.sun.net.httpserver.HttpServer;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.security.ActiveMemberFilter;
import com.yogimangchi.content.auth.security.ContentEndpointRateLimiter;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.community.CommunityService;
import com.yogimangchi.content.community.CommunityUxSseService;
import com.yogimangchi.content.member.dto.WithdrawalRequest;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.member.service.ContentRetentionCleanupService;
import com.yogimangchi.content.member.service.MemberSuspensionDelivery;
import com.yogimangchi.content.member.service.MemberSuspensionOutbox;
import com.yogimangchi.content.member.service.MemberWithdrawals;
import com.yogimangchi.content.news.NewsIngestionService;
import com.yogimangchi.content.news.NewsSseService;
import com.yogimangchi.content.notification.ContentNotificationSseService;
import com.yogimangchi.content.support.TestEnvironment;
import com.yogimangchi.content.support.TestInfrastructure;
import jakarta.servlet.http.Cookie;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "content.oauth.enabled=false")
@AutoConfigureMockMvc
@Import(TestInfrastructure.class)
class Wave3LifecycleSecurityAndOpsIntegrationTests extends TestEnvironment {
    private static final byte[] VALID_PNG = new byte[]{(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4};

    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired JwtDecoder jwtDecoder;
    @Autowired JwtEncoder jwtEncoder;
    @Autowired RSAKey rsaKey;
    @Autowired MemberSuspensionOutbox suspensionOutbox;
    @Autowired MemberWithdrawals withdrawals;
    @Autowired ContentRetentionCleanupService retentionCleanup;
    @Autowired CommunityService community;
    @Autowired CommunityS3Service s3;
    @Autowired NewsIngestionService newsIngestion;
    @Autowired NewsSseService newsSse;
    @Autowired CommunityUxSseService communitySse;
    @Autowired ContentNotificationSseService notificationSse;
    @Autowired OpsErrorBuffer errorBuffer;
    @Autowired ClientErrorBuffer clientErrorBuffer;
    @Autowired ContentEndpointRateLimiter rateLimiter;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @BeforeEach
    @AfterEach
    void resetRateLimiter() {
        rateLimiter.reset();
    }

    @Test
    void suspendedMemberGetsRestrictedAppealSessionAcrossLoginRefreshNotificationsConsentsAndWithdrawal() throws Exception {
        var admin = signup(identity(Provider.GOOGLE));
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", admin.access().memberId());
        String adminBearer = "Bearer " + admin.access().accessToken();

        var proof = identity(Provider.GOOGLE);
        var user = signup(proof);
        Long userId = user.access().memberId();

        // Suspend user -> old refresh tokens revoked + suspension outbox row enqueued
        mvc.perform(post("/api/v1/admin/members/" + userId + "/suspend")
                        .header("Authorization", adminBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"허위 정보 반복 유포\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUSPENDED"));

        // Old refresh token issued before suspension is rejected
        mvc.perform(post("/api/v1/auth/refresh")
                        .with(csrf())
                        .cookie(new Cookie("CONTENT_REFRESH", user.refresh())))
                .andExpect(status().isUnauthorized());

        // Suspended member re-authenticates via OAuth flow & login/complete -> receives restricted SUSPENDED session!
        var loginSession = new MockHttpSession();
        loginSession.setAttribute(VerifiedIdentity.SESSION_KEY, proof);
        mvc.perform(get("/api/v1/auth/flow").session(loginSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("LOGIN_READY"))
                .andExpect(jsonPath("$.accountStatus").value("SUSPENDED"))
                .andExpect(jsonPath("$.suspensionReason").value("허위 정보 반복 유포"));

        var loginResult = mvc.perform(post("/api/v1/auth/login/complete")
                        .session(loginSession)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountStatus").value("SUSPENDED"))
                .andExpect(jsonPath("$.suspensionReason").value("허위 정보 반복 유포"))
                .andReturn();
        String restrictedToken = json.readTree(loginResult.getResponse().getContentAsString()).path("accessToken").asText();
        Cookie suspendedRefreshCookie = loginResult.getResponse().getCookie("CONTENT_REFRESH");
        assertThat(suspendedRefreshCookie).isNotNull();

        // Verify Access JWT carries account_status="SUSPENDED" claim
        Jwt decoded = jwtDecoder.decode(restrictedToken);
        assertThat(decoded.getClaimAsString("account_status")).isEqualTo("SUSPENDED");

        // Refresh token issued while suspended CAN rotate cleanly while keeping accountStatus="SUSPENDED"
        var refreshedRes = mvc.perform(post("/api/v1/auth/refresh")
                        .with(csrf())
                        .cookie(suspendedRefreshCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountStatus").value("SUSPENDED"))
                .andExpect(jsonPath("$.suspensionReason").value("허위 정보 반복 유포"))
                .andReturn();
        String refreshedToken = json.readTree(refreshedRes.getResponse().getContentAsString()).path("accessToken").asText();
        String suspendedBearer = "Bearer " + refreshedToken;

        // Allowlist check: /members/me, /members/me/consents (GET/POST), /support/inquiries/**, /notifications/**
        mvc.perform(get("/api/v1/members/me").header("Authorization", suspendedBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUSPENDED"))
                .andExpect(jsonPath("$.accountStatus").value("SUSPENDED"))
                .andExpect(jsonPath("$.suspensionReason").value("허위 정보 반복 유포"));

        mvc.perform(get("/api/v1/members/me/consents").header("Authorization", suspendedBearer))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/members/me/consents")
                        .header("Authorization", suspendedBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"termAgree\":true,\"privateAgree\":true,\"termsVersion\":\"ym-terms-v3\",\"privacyVersion\":\"ym-privacy-v3\"}"))
                .andExpect(status().isOk());

        // Submit support appeal -> edit while OPEN -> admin replies -> suspended user reads & deletes notification!
        JsonNode createdAppeal = json.readTree(mvc.perform(post("/api/v1/support/inquiries")
                        .header("Authorization", suspendedBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category\":\"ACCOUNT\",\"title\":\"정지 이의제기\",\"content\":\"초기 내용\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        long appealId = createdAppeal.path("id").asLong();

        mvc.perform(patch("/api/v1/support/inquiries/" + appealId)
                        .header("Authorization", suspendedBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"수정된 소명 내용입니다.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("수정된 소명 내용입니다."));

        mvc.perform(post("/api/v1/admin/support/inquiries/" + appealId + "/reply")
                        .header("Authorization", adminBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reply\":\"소명 내용을 확인 중입니다.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ANSWERED"));

        JsonNode notiList = json.readTree(mvc.perform(get("/api/v1/notifications")
                        .param("category", "SUPPORT")
                        .header("Authorization", suspendedBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].type").value("SUPPORT_INQUIRY_ANSWERED"))
                .andReturn().getResponse().getContentAsString());
        long notiId = notiList.path("content").get(0).path("notificationId").asLong();

        mvc.perform(put("/api/v1/notifications/" + notiId + "/read").header("Authorization", suspendedBearer))
                .andExpect(status().isNoContent());
        mvc.perform(delete("/api/v1/notifications/read").header("Authorization", suspendedBearer))
                .andExpect(status().isNoContent());

        // Non-allowlisted endpoints return 403 MEMBER_SUSPENDED with clear Korean message directing to /support or 탈퇴
        mvc.perform(post("/api/v1/community/posts")
                        .header("Authorization", suspendedBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category\":\"FREE\",\"title\":\"차단\",\"content\":\"차단\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_SUSPENDED"))
                .andExpect(jsonPath("$.detail", containsString("/support")))
                .andExpect(jsonPath("$.detail", containsString("탈퇴")));

        mvc.perform(patch("/api/v1/members/me/profile")
                        .header("Authorization", suspendedBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profileMessage\":\"차단\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_SUSPENDED"));

        // Suspended member CAN fetch CSRF and withdraw via POST /api/v1/members/me/withdrawal
        var withdrawSession = new MockHttpSession();
        withdrawSession.setAttribute(VerifiedIdentity.SESSION_KEY, proof);
        JsonNode csrfRes = json.readTree(mvc.perform(get("/api/v1/auth/csrf")
                        .header("Authorization", suspendedBearer)
                        .session(withdrawSession))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        mvc.perform(post("/api/v1/members/me/withdrawal")
                        .header("Authorization", suspendedBearer)
                        .header(csrfRes.path("headerName").asText(), csrfRes.path("token").asText())
                        .session(withdrawSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new WithdrawalRequest(true, "탈퇴합니다", "ym-withdrawal-v1"))))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("PENDING"));
    }

    @Test
    void suspensionOutboxDispatchesSignedRs256JwtWithRequestIdAndAlertsWhenStuck() throws Exception {
        var admin = signup(identity(Provider.GOOGLE));
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", admin.access().memberId());
        String adminBearer = "Bearer " + admin.access().accessToken();
        var target = signup(identity(Provider.KAKAO));
        Long targetId = target.access().memberId();

        mvc.perform(post("/api/v1/admin/members/" + targetId + "/suspend")
                        .header("Authorization", adminBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"시세 조작 의심\"}"))
                .andExpect(status().isOk());

        List<String> capturedAuthHeaders = new ArrayList<>();
        List<String> capturedReqIds = new ArrayList<>();
        List<String> capturedBodies = new ArrayList<>();
        AtomicReference<Integer> responseStatus = new AtomicReference<>(204);

        HttpServer mockTrading = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        try {
            mockTrading.createContext("/internal/v1/members/" + targetId + "/suspension", exchange -> {
                capturedAuthHeaders.add(exchange.getRequestHeaders().getFirst("Authorization"));
                capturedReqIds.add(exchange.getRequestHeaders().getFirst("X-Request-Id"));
                capturedBodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                exchange.sendResponseHeaders(responseStatus.get(), -1);
                exchange.close();
            });
            mockTrading.start();

            String tradingBase = "http://127.0.0.1:" + mockTrading.getAddress().getPort();
            List<String> alertPayloads = new ArrayList<>();
            OpsAlertService testAlert = new OpsAlertService(
                    "https://hooks.example.test/ops",
                    Duration.ofMinutes(5),
                    Clock.systemUTC(),
                    json,
                    (uri, payload) -> alertPayloads.add(payload));

            MemberSuspensionDelivery delivery = new MemberSuspensionDelivery(
                    suspensionOutbox, jwtEncoder, json, testAlert,
                    "https://content.test", "content-1", tradingBase, true);

            // 1. Successful delivery of suspended=true
            int delivered = delivery.deliverPending();
            assertThat(delivered).isGreaterThanOrEqualTo(1);
            assertThat(capturedAuthHeaders).isNotEmpty();
            String bearer = capturedAuthHeaders.get(capturedAuthHeaders.size() - 1);
            assertThat(bearer).startsWith("Bearer ");
            String rawJwt = bearer.substring(7);

            // Validate RS256 internal JWT with real public RSA key (matching trading-server's WithdrawalSecurity!)
            NimbusJwtDecoder internalDecoder = NimbusJwtDecoder.withPublicKey(rsaKey.toRSAPublicKey()).build();
            Jwt verified = internalDecoder.decode(rawJwt);
            assertThat(verified.getIssuer().toString()).isEqualTo("https://content.test");
            assertThat(verified.getAudience()).containsExactly("trading-internal");
            assertThat(verified.getSubject()).isEqualTo(targetId.toString());
            assertThat(verified.getClaimAsString("token_use")).isEqualTo("member_suspension");
            assertThat(Duration.between(verified.getIssuedAt(), verified.getExpiresAt())).isLessThanOrEqualTo(Duration.ofSeconds(60));
            assertThat(capturedReqIds.get(capturedReqIds.size() - 1)).isNotBlank();

            JsonNode sentJson = json.readTree(capturedBodies.get(capturedBodies.size() - 1));
            assertThat(sentJson.path("suspended").asBoolean()).isTrue();
            assertThat(sentJson.path("reason").asText()).isEqualTo("시세 조작 의심");

            assertThat(jdbc.queryForObject(
                    "select status from content.member_suspension_delivery where member_id = ? order by id desc limit 1",
                    String.class, targetId)).isEqualTo("COMPLETED");

            // 2. Unsuspend enqueues suspended=false, reason=null -> fail 3 times to verify OpsAlert firing
            mvc.perform(post("/api/v1/admin/members/" + targetId + "/unsuspend")
                            .header("Authorization", adminBearer))
                    .andExpect(status().isOk());

            responseStatus.set(503);
            for (int attempt = 1; attempt <= 3; attempt++) {
                jdbc.update("update content.member_suspension_delivery set next_attempt_at = now() - interval '1 second' where member_id = ? and status = 'PENDING'", targetId);
                delivery.deliverPending();
            }
            assertThat(alertPayloads).isNotEmpty();
            assertThat(alertPayloads.get(0)).contains("member-suspension-delivery-stuck");

            // Recover trading-server -> delivery succeeds with suspended=false
            responseStatus.set(204);
            jdbc.update("update content.member_suspension_delivery set next_attempt_at = now() - interval '1 second' where member_id = ? and status = 'PENDING'", targetId);
            assertThat(delivery.deliverPending()).isGreaterThanOrEqualTo(1);
            JsonNode unsuspendJson = json.readTree(capturedBodies.get(capturedBodies.size() - 1));
            assertThat(unsuspendJson.path("suspended").asBoolean()).isFalse();
            assertThat(unsuspendJson.path("reason").isNull()).isTrue();
        } finally {
            mockTrading.stop(0);
        }
    }

    @Test
    void softDeletePreservesAttachmentsOnAdminRestoreAndRetentionPurgesAfter30Days() throws Exception {
        var admin = signup(identity(Provider.GOOGLE));
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", admin.access().memberId());
        String adminBearer = "Bearer " + admin.access().accessToken();

        var author = signup(identity(Provider.GOOGLE));
        String authorBearer = "Bearer " + author.access().accessToken();

        // Spoofed MP4 renamed .jpg rejected at HTTP boundary
        byte[] mp4 = new byte[]{0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'm', 'p', '4', '2', 0, 0, 0, 0};
        mvc.perform(multipart("/api/v1/community/posts")
                        .file(new MockMultipartFile("files", "fake.jpg", "image/jpeg", mp4))
                        .param("category", "FREE")
                        .param("title", "위장 MP4")
                        .param("content", "차단")
                        .header("Authorization", authorBearer))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FILE_TYPE_NOT_ALLOWED"));

        // Upload real PNG post
        var pngFile = new MockMultipartFile("files", "chart.png", "image/png", VALID_PNG);
        JsonNode created = json.readTree(mvc.perform(multipart("/api/v1/community/posts")
                        .file(pngFile)
                        .param("category", "ANALYSIS")
                        .param("title", "복구 이미지 보존 테스트")
                        .param("content", "삭제 후 복구해도 이미지가 유지되어야 합니다.")
                        .header("Authorization", authorBearer))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.files.length()").value(1))
                .andReturn().getResponse().getContentAsString());
        long postId = created.path("id").asLong();
        String s3Key = jdbc.queryForObject(
                "select s3_key from content.community_post_file where post_id = ?",
                String.class, postId);
        assertThat(s3.isSimulatedKeyPresent(s3Key)).isTrue();

        // Admin soft-deletes -> restores -> image is STILL present & readable via local-media!
        mvc.perform(delete("/api/v1/admin/community/posts/" + postId).header("Authorization", adminBearer))
                .andExpect(status().isNoContent());
        assertThat(s3.isSimulatedKeyPresent(s3Key)).isTrue();

        mvc.perform(post("/api/v1/admin/community/posts/" + postId + "/restore").header("Authorization", adminBearer))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/community/posts/" + postId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.files.length()").value(1));
        mvc.perform(get("/api/v1/community/local-media/" + s3Key))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", containsString("image/png")));

        // Soft-delete again, age deleted_at > 30 days, seed expired retention rows across notifications,
        // notification_dedupe_state, community_post_viewer_daily, and news_article_anon_daily_view, then purge!
        mvc.perform(delete("/api/v1/admin/community/posts/" + postId).header("Authorization", adminBearer))
                .andExpect(status().isNoContent());
        jdbc.update("update content.community_post set deleted_at = ? where id = ?",
                Timestamp.from(Instant.now().minus(Duration.ofDays(31))), postId);

        long oldNotiId = jdbc.queryForObject("""
                insert into content.notification (receiver_member_id, actor_member_id, category, type, payload_json, created_at)
                values (?, ?, 'COMMUNITY', 'POST_LIKED', '{}'::jsonb, ?) returning id
                """, Long.class, author.access().memberId(), admin.access().memberId(), Timestamp.from(Instant.now().minus(Duration.ofDays(95))));
        long oldDedupeId = jdbc.queryForObject("""
                insert into content.notification_dedupe_state (notification_type, actor_member_id, receiver_member_id, target_type, target_id, first_notified_at, last_notified_at)
                values ('POST_LIKED', ?, ?, 'POST', ?, ?, ?) returning id
                """, Long.class, admin.access().memberId(), author.access().memberId(), postId,
                Timestamp.from(Instant.now().minus(Duration.ofDays(95))), Timestamp.from(Instant.now().minus(Duration.ofDays(95))));
        jdbc.update("""
                insert into content.community_post_viewer_daily (post_id, viewed_date, viewer_key)
                values (?, current_date - 20, 'a:expired-viewer-key')
                """, postId);
        Long anyNewsId = jdbc.queryForObject("select id from content.news_article order by id asc limit 1", Long.class);
        jdbc.update("""
                insert into content.news_article_anon_daily_view (news_id, viewed_date, viewer_hash)
                values (?, current_date - 5, 'expired-news-anon-hash')
                on conflict do nothing
                """, anyNewsId);

        retentionCleanup.purgeExpired(Instant.now());

        assertThat(jdbc.queryForObject("select count(*) from content.community_post_file where post_id = ?", Long.class, postId))
                .isZero();
        assertThat(s3.isSimulatedKeyPresent(s3Key)).isFalse();
        assertThat(jdbc.queryForObject("select count(*) from content.notification where id = ?", Long.class, oldNotiId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from content.notification_dedupe_state where id = ?", Long.class, oldDedupeId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from content.community_post_viewer_daily where viewer_key = 'a:expired-viewer-key'", Long.class)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from content.news_article_anon_daily_view where viewer_hash = 'expired-news-anon-hash'", Long.class)).isZero();
    }

    @Test
    void bannedOAuthManagementAuditLogsWeeklyPopularReportLockAndVerifiedPositionPreservationWork() throws Exception {
        var admin = signup(identity(Provider.GOOGLE));
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", admin.access().memberId());
        String adminBearer = "Bearer " + admin.access().accessToken();

        // 1. Force-withdraw -> list banned OAuth identities -> unban -> re-signup works + audit log persisted
        var bannedProof = identity(Provider.GOOGLE);
        var bannedUser = signup(bannedProof);
        mvc.perform(delete("/api/v1/admin/members/" + bannedUser.access().memberId())
                        .header("Authorization", adminBearer)
                        .param("reason", "오탐 제재 테스트"))
                .andExpect(status().isNoContent());

        JsonNode bannedList = json.readTree(mvc.perform(get("/api/v1/admin/banned-oauth-identities")
                        .header("Authorization", adminBearer)
                        .param("provider", "GOOGLE")
                        .param("keyword", "오탐 제재 테스트"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(greaterThanOrEqualTo(1)))
                .andReturn().getResponse().getContentAsString());
        long banId = bannedList.path("items").get(0).path("id").asLong();

        mvc.perform(delete("/api/v1/admin/banned-oauth-identities/" + banId)
                        .header("Authorization", adminBearer))
                .andExpect(status().isNoContent());

        // After unban, same OAuth identity can sign up again!
        var reSigned = signup(bannedProof);
        assertThat(reSigned.access().memberId()).isNotEqualTo(bannedUser.access().memberId());

        // Persistent audit logs capture UNBAN_OAUTH_IDENTITY and FORCE_WITHDRAW_MEMBER
        mvc.perform(get("/api/v1/admin/audit-logs")
                        .header("Authorization", adminBearer)
                        .param("action", "UNBAN_OAUTH_IDENTITY"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].action").value("UNBAN_OAUTH_IDENTITY"))
                .andExpect(jsonPath("$.items[0].targetId").value(Long.toString(banId)))
                .andExpect(jsonPath("$.items[0].adminMemberId").value(admin.access().memberId()));

        // 2. WEEKLY_POPULAR filters strictly to last 7 days
        var author = signup(identity(Provider.GOOGLE));
        var reporter = signup(identity(Provider.KAKAO));
        String authorBearer = "Bearer " + author.access().accessToken();
        String reporterBearer = "Bearer " + reporter.access().accessToken();

        var oldPopular = community.createPost(author.access().memberId(),
                new CommunityService.CreatePostRequest("FREE", "XRP", "주간필터_오래된인기글", "10일 전 작성"));
        var recentPopular = community.createPost(author.access().memberId(),
                new CommunityService.CreatePostRequest("FREE", "XRP", "주간필터_최신인기글", "1일 전 작성"));
        jdbc.update("update content.community_post set like_count = 99, created_at = now() - interval '10 days' where id = ?", oldPopular.id());
        jdbc.update("update content.community_post set like_count = 3, created_at = now() - interval '1 day' where id = ?", recentPopular.id());

        mvc.perform(get("/api/v1/community/posts")
                        .param("sort", "WEEKLY_POPULAR")
                        .param("symbolTag", "XRP")
                        .param("keyword", "주간필터_"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(recentPopular.id()));

        mvc.perform(get("/api/v1/community/posts")
                        .param("sort", "POPULAR")
                        .param("symbolTag", "XRP")
                        .param("keyword", "주간필터_"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(oldPopular.id()));

        // 3. Block report re-opening after DISMISSED -> 409 REPORT_ALREADY_RESOLVED
        mvc.perform(put("/api/v1/community/posts/" + recentPopular.id() + "/reports")
                        .header("Authorization", reporterBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reasonType\":\"SPAM\"}"))
                .andExpect(status().isOk());
        mvc.perform(delete("/api/v1/admin/community/reports/POST/" + recentPopular.id() + "/reporters/" + reporter.access().memberId())
                        .header("Authorization", adminBearer))
                .andExpect(status().isNoContent());

        mvc.perform(put("/api/v1/community/posts/" + recentPopular.id() + "/reports")
                        .header("Authorization", reporterBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reasonType\":\"ABUSE\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REPORT_ALREADY_RESOLVED"));

        // 4. Preserve verified=true sharedPosition on text-only JSON & multipart edits; clear ONLY on clearSharedPosition=true
        String verifiedJson = """
                {"id":"MOCK_POS_77","marketLabel":"모의투자 선물","symbol":"BTC","pair":"BTCUSDT","side":"LONG","leverage":10,
                 "entryPrice":"90000.00","markPrice":"91000.00","liquidationPrice":"81000.00","roePct":"+11.11%","pnlUsdt":"+111.10 USDT",
                 "positive":true,"showPnlAmount":true,"verified":true}
                """;
        jdbc.update("update content.community_post set shared_position_json = ? where id = ?", verifiedJson, recentPopular.id());

        mvc.perform(patch("/api/v1/community/posts/" + recentPopular.id())
                        .header("Authorization", authorBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"텍스트만 수정\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("텍스트만 수정"))
                .andExpect(jsonPath("$.sharedPosition.verified").value(true))
                .andExpect(jsonPath("$.sharedPosition.id").value("MOCK_POS_77"));

        mvc.perform(multipart(HttpMethod.PATCH, "/api/v1/community/posts/" + recentPopular.id())
                        .param("title", "멀티파트 텍스트만 수정")
                        .param("sharedPosition", "")
                        .header("Authorization", authorBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sharedPosition.verified").value(true));

        mvc.perform(patch("/api/v1/community/posts/" + recentPopular.id())
                        .header("Authorization", authorBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clearSharedPosition\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sharedPosition").value(nullValue()));
    }

    @Test
    void supportLifecyclePaginationWithdrawalPiiCleanupNotificationsReadDeleteAndSessionProbeWork() throws Exception {
        var admin = signup(identity(Provider.GOOGLE));
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", admin.access().memberId());
        String adminBearer = "Bearer " + admin.access().accessToken();

        // 1. Session probe: anonymous cold visit -> 200 OK (never 401!), expired/bad Bearer -> 200 OK, valid cookie -> authenticated=true
        mvc.perform(get("/api/v1/auth/session-probe"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.hasRefreshCookie").value(false));
        mvc.perform(get("/api/v1/auth/session-probe").header("Authorization", "Bearer not-a-valid-jwt"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));

        var userProof = identity(Provider.GOOGLE);
        var user = signup(userProof);
        Long userId = user.access().memberId();
        String userBearer = "Bearer " + user.access().accessToken();

        mvc.perform(get("/api/v1/auth/session-probe").cookie(new Cookie("CONTENT_REFRESH", user.refresh())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.hasRefreshCookie").value(true));

        // 2. Support inquiry edit/delete/close + admin keyword & cursor pagination beyond 20 items
        JsonNode openInquiry = json.readTree(mvc.perform(post("/api/v1/support/inquiries")
                        .header("Authorization", userBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category\":\"BUG\",\"title\":\"삭제할 문의\",\"content\":\"곧 취소할 문의\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        long cancelId = openInquiry.path("id").asLong();

        mvc.perform(delete("/api/v1/support/inquiries/" + cancelId).header("Authorization", userBearer))
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("select count(*) from content.support_inquiry where id = ?", Long.class, cancelId)).isZero();

        JsonNode closeable = json.readTree(mvc.perform(post("/api/v1/support/inquiries")
                        .header("Authorization", userBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category\":\"TRADING\",\"title\":\"마감테스트_특수키워드\",\"content\":\"질문 본문\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        long closeableId = closeable.path("id").asLong();

        mvc.perform(post("/api/v1/admin/support/inquiries/" + closeableId + "/reply")
                        .header("Authorization", adminBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reply\":\"답변 완료했습니다.\"}"))
                .andExpect(status().isOk());

        // Cannot edit or delete ANSWERED inquiry
        mvc.perform(patch("/api/v1/support/inquiries/" + closeableId)
                        .header("Authorization", userBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"수정시도\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INQUIRY_STATUS_CONFLICT"));
        mvc.perform(delete("/api/v1/support/inquiries/" + closeableId)
                        .header("Authorization", userBearer))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INQUIRY_STATUS_CONFLICT"));

        // Close answered inquiry -> CLOSED
        mvc.perform(post("/api/v1/support/inquiries/" + closeableId + "/close")
                        .header("Authorization", userBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CLOSED"))
                .andExpect(jsonPath("$.closedAt").isNotEmpty());

        // Admin keyword search & >20 item pagination
        for (int i = 0; i < 23; i++) {
            jdbc.update("insert into content.support_inquiry(member_id, category, title, content, status, created_at) values (?, 'GENERAL', ?, 'paged content', 'OPEN', now())",
                    userId, "페이징테스트문의_" + i);
        }
        JsonNode page1 = json.readTree(mvc.perform(get("/api/v1/admin/support/inquiries")
                        .header("Authorization", adminBearer)
                        .param("keyword", "페이징테스트문의_")
                        .param("size", "20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(20))
                .andExpect(jsonPath("$.hasNext").value(true))
                .andReturn().getResponse().getContentAsString());
        long nextCursor = page1.path("nextCursorId").asLong();
        mvc.perform(get("/api/v1/admin/support/inquiries")
                        .header("Authorization", adminBearer)
                        .param("keyword", "페이징테스트문의_")
                        .param("size", "20")
                        .param("cursorId", Long.toString(nextCursor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(3))
                .andExpect(jsonPath("$.hasNext").value(false));

        // 3. DELETE /api/v1/notifications/read deletes ALL read notifications regardless of lastCheckedId
        var other = signup(identity(Provider.KAKAO));
        String otherBearer = "Bearer " + other.access().accessToken();
        var userPost = community.createPost(userId, new CommunityService.CreatePostRequest("FREE", "BTC", "알림삭제글", "본문"));
        community.createComment(other.access().memberId(), userPost.id(), new CommunityService.CreateCommentRequest("댓글1", null));
        // User checks bell -> sets lastCheckedId = notification #1
        mvc.perform(put("/api/v1/notifications/check").header("Authorization", userBearer)).andExpect(status().isNoContent());
        // New notification #2 arrives AFTER lastCheckedId!
        community.createComment(other.access().memberId(), userPost.id(), new CommunityService.CreateCommentRequest("댓글2", null));
        // Mark both read, do NOT call /check again
        mvc.perform(put("/api/v1/notifications/read-all").header("Authorization", userBearer)).andExpect(status().isNoContent());
        mvc.perform(delete("/api/v1/notifications/read").header("Authorization", userBearer)).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/notifications").header("Authorization", userBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));

        // 4. Withdrawal scrubs support_inquiry PII, deletes news reactions/views, deletes community likes & reconciles counts!
        var otherPost = community.createPost(other.access().memberId(), new CommunityService.CreatePostRequest("FREE", "ETH", "좋아요정리글", "본문"));
        var otherComment = community.createComment(other.access().memberId(), otherPost.id(), new CommunityService.CreateCommentRequest("좋아요정리댓글", null));
        mvc.perform(put("/api/v1/community/posts/" + otherPost.id() + "/likes").header("Authorization", userBearer)).andExpect(status().isOk());
        mvc.perform(put("/api/v1/community/comments/" + otherComment.id() + "/likes").header("Authorization", userBearer)).andExpect(status().isOk());

        String recentPub = DateTimeFormatter.RFC_1123_DATE_TIME.format(Instant.now().minusSeconds(60).atOffset(ZoneOffset.UTC));
        String rss = """
                <?xml version="1.0" encoding="UTF-8"?>
                <rss version="2.0"><channel><title>Withdraw Feed</title>
                  <item>
                    <title>탈퇴정리 테스트 기사 %s</title>
                    <link>https://news.example.com/w/%s</link>
                    <pubDate>%s</pubDate>
                    <description>기사 본문</description>
                  </item>
                </channel></rss>
                """.formatted(UUID.randomUUID(), UUID.randomUUID(), recentPub);
        long newsId = newsIngestion.ingestRssXml(rss, "BREAKING", "COIN_FLASH", 5).get(0).id();
        try {
            mvc.perform(get("/api/v1/news/" + newsId).header("Authorization", userBearer)).andExpect(status().isOk());
            mvc.perform(post("/api/v1/news/" + newsId + "/reactions")
                            .header("Authorization", userBearer)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"reaction\":\"BULL\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.bullCount").value(1));

            // Invalid X-Anon-Viewer-Id falls back cleanly to remoteAddr
            mvc.perform(get("/api/v1/news/" + newsId).header("X-Anon-Viewer-Id", "bad!@#")).andExpect(status().isOk());

            withdrawals.request(userId, new WithdrawalRequest(true, "탈퇴합니다", "ym-withdrawal-v1"), userProof);
            withdrawals.delivered(userId);

            var anonymizedInquiry = jdbc.queryForMap("select title, content, admin_reply, status from content.support_inquiry where id = ?", closeableId);
            assertThat(anonymizedInquiry.get("title")).isEqualTo(MemberWithdrawals.ANONYMIZED_INQUIRY_TITLE);
            assertThat(anonymizedInquiry.get("content")).isEqualTo(MemberWithdrawals.ANONYMIZED_INQUIRY_CONTENT);
            assertThat(anonymizedInquiry.get("admin_reply")).isEqualTo(MemberWithdrawals.ANONYMIZED_INQUIRY_REPLY);
            assertThat(anonymizedInquiry.get("status")).isEqualTo("CLOSED");

            assertThat(jdbc.queryForObject("select count(*) from content.news_article_reaction where actor_key = ?", Long.class, "member:" + userId)).isZero();
            assertThat(jdbc.queryForObject("select bull_count from content.news_article where id = ?", Integer.class, newsId)).isZero();
            assertThat(jdbc.queryForObject("select count(*) from content.news_article_member_view where member_id = ?", Long.class, userId)).isZero();
            assertThat(jdbc.queryForObject("select like_count from content.community_post where id = ?", Integer.class, otherPost.id())).isZero();
            assertThat(jdbc.queryForObject("select like_count from content.community_comment where id = ?", Integer.class, otherComment.id())).isZero();
        } finally {
            jdbc.update("delete from content.news_article where id = ?", newsId);
        }
    }

    @Test
    void enrichedAdminOpsSummaryOutboxRetryTestAlertClientErrorsSseCapAndDbOutageFallbackWork() throws Exception {
        var admin = signup(identity(Provider.GOOGLE));
        Long adminId = admin.access().memberId();
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", adminId);
        String adminBearer = "Bearer " + admin.access().accessToken();

        // 1. Client errors ingestion: 202 Accepted, >4KB rejected 413, 21st request returns 429 + Retry-After
        String testIp = "198.51.100.77";
        mvc.perform(post("/api/v1/ops/client-errors")
                        .with(req -> { req.setRemoteAddr(testIp); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"route\":\"/trading\",\"message\":\"TypeError: x is undefined\",\"stack\":\"at App (app.tsx:12)\",\"digest\":\"NEXT_ERR_1\"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.accepted").value(true));

        String hugePayload = "{\"route\":\"/trading\",\"message\":\"" + "x".repeat(4200) + "\"}";
        mvc.perform(post("/api/v1/ops/client-errors")
                        .with(req -> { req.setRemoteAddr("198.51.100.78"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(hugePayload))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("PAYLOAD_TOO_LARGE"));

        // Trigger 20/min IP rate limit on client-errors (1 already sent above -> 19 more succeed, 21st returns 429)
        for (int i = 0; i < 19; i++) {
            mvc.perform(post("/api/v1/ops/client-errors")
                            .with(req -> { req.setRemoteAddr(testIp); return req; })
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"route\":\"/news\",\"message\":\"Crash " + i + "\"}"))
                    .andExpect(status().isAccepted());
        }
        mvc.perform(post("/api/v1/ops/client-errors")
                        .with(req -> { req.setRemoteAddr(testIp); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"route\":\"/news\",\"message\":\"Overflow\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"));

        // 2. Enriched /api/v1/admin/ops/summary
        mvc.perform(get("/api/v1/admin/ops/summary").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.db.up").value(true))
                .andExpect(jsonPath("$.dbLatencyMs").isNumber())
                .andExpect(jsonPath("$.runtime.heapUsedMb").isNumber())
                .andExpect(jsonPath("$.runtime.heapMaxMb").isNumber())
                .andExpect(jsonPath("$.runtime.uptimeSeconds").isNumber())
                .andExpect(jsonPath("$.hikari.maxPoolSize").isNumber())
                .andExpect(jsonPath("$.rssSources.length()").value(5))
                .andExpect(jsonPath("$.s3Storage.mode").value("LOCAL_DISK"))
                .andExpect(jsonPath("$.outbox.pendingSuspensions").isNumber())
                .andExpect(jsonPath("$.outbox.stuckDetails").isArray())
                .andExpect(jsonPath("$.alerts.configured").value(false))
                .andExpect(jsonPath("$.errorMetrics.criticalErrors").isArray())
                .andExpect(jsonPath("$.errorMetrics.total429").value(greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$.clientErrors[0].route").value("/news"));

        // 3. POST /api/v1/admin/ops/outbox/retry & POST /api/v1/admin/ops/test-alert + audit logs
        mvc.perform(post("/api/v1/admin/ops/outbox/retry").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalRearmed").isNumber());

        mvc.perform(post("/api/v1/admin/ops/test-alert").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.status").value("DISABLED"));

        mvc.perform(get("/api/v1/admin/audit-logs")
                        .header("Authorization", adminBearer)
                        .param("action", "RETRY_OUTBOX"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(greaterThanOrEqualTo(1)));

        mvc.perform(get("/api/v1/admin/audit-logs")
                        .header("Authorization", adminBearer)
                        .param("action", "SEND_TEST_ALERT"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(greaterThanOrEqualTo(1)));

        // 4. SSE max 5 concurrent connections per IP over HTTP
        String sseIp = "198.51.100.200";
        for (int i = 0; i < 5; i++) {
            mvc.perform(get("/api/v1/news/stream").with(req -> { req.setRemoteAddr(sseIp); return req; }))
                    .andExpect(status().isOk());
        }
        mvc.perform(get("/api/v1/news/stream").with(req -> { req.setRemoteAddr(sseIp); return req; }))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"));

        // 5. DB-outage resilient RS256 ADMIN auth on GET /api/v1/admin/ops/summary!
        JdbcTemplate brokenJdbc = mock(JdbcTemplate.class);
        when(brokenJdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
                .thenThrow(new CannotGetJdbcConnectionException("PostgreSQL down"));
        when(brokenJdbc.queryForObject(anyString(), any(Class.class)))
                .thenThrow(new CannotGetJdbcConnectionException("PostgreSQL down"));

        // Re-login admin so JWT carries roles=["ADMIN"]
        var adminJwt = jwtDecoder.decode(
                auth.completeLogin(new VerifiedIdentity(
                        Provider.GOOGLE,
                        jdbc.queryForObject("select provider_subject from content.oauth_identity where member_id = ?", String.class, adminId),
                        "admin@example.test",
                        Instant.now().plusSeconds(300))).access().accessToken());

        ActiveMemberFilter filter = new ActiveMemberFilter(brokenJdbc, errorBuffer, null);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/admin/ops/summary");
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(adminJwt, List.of(), adminJwt.getSubject()));
        try {
            filter.doFilter(req, res, chain);
            assertThat(res.getStatus()).isEqualTo(200);
            assertThat(req.getAttribute(ActiveMemberFilter.DEGRADED_DB_OUTAGE_ADMIN_ATTR)).isEqualTo(Boolean.TRUE);
            assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
                    .extracting(Object::toString)
                    .contains("ROLE_ADMIN");

            // AdminOpsService.summary with brokenJdbc STILL returns live diagnostics with db.up=false!
            AdminOpsService degradedOps = new AdminOpsService(
                    brokenJdbc, newsIngestion, newsSse, communitySse, notificationSse, errorBuffer,
                    null, clientErrorBuffer, s3, null, null, null, null, null, null);
            AdminOpsService.OpsSummaryResponse summary = degradedOps.summary(adminId, true);
            assertThat(summary.db().up()).isFalse();
            assertThat(summary.runtime().heapMaxMb()).isPositive();
            assertThat(summary.rssSources()).hasSize(5);
            assertThat(summary.clientErrors()).isNotEmpty();

            // Non-admin JWT during DB outage MUST still be rejected with 503
            var normalMember = signup(identity(Provider.GOOGLE));
            Jwt normalJwt = jwtDecoder.decode(normalMember.access().accessToken());
            MockHttpServletRequest normalReq = new MockHttpServletRequest("GET", "/api/v1/admin/ops/summary");
            MockHttpServletResponse normalRes = new MockHttpServletResponse();
            SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(normalJwt, List.of(), normalJwt.getSubject()));
            filter.doFilter(normalReq, normalRes, new MockFilterChain());
            assertThat(normalRes.getStatus()).isEqualTo(503);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private AuthService.Issued signup(VerifiedIdentity identity) {
        String nick = "w" + UUID.randomUUID().toString().replace("-", "").substring(0, 7);
        return auth.signup(identity, new SignupRequest(nick, true, true, "wave3", "ym-terms-v3", "ym-privacy-v3"));
    }

    private static VerifiedIdentity identity(Provider provider) {
        return new VerifiedIdentity(provider, UUID.randomUUID().toString(), "wave3-test@example.test", Instant.now().plusSeconds(300));
    }
}
