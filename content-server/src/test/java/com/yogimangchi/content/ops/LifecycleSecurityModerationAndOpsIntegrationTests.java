package com.yogimangchi.content.ops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.community.CommunityService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.dto.WithdrawalRequest;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.member.service.MemberWithdrawals;
import com.yogimangchi.content.news.NewsIngestionService;
import com.yogimangchi.content.support.TestEnvironment;
import com.yogimangchi.content.support.TestInfrastructure;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "content.oauth.enabled=false")
@AutoConfigureMockMvc
@Import(TestInfrastructure.class)
class LifecycleSecurityModerationAndOpsIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired MemberWithdrawals withdrawals;
    @Autowired CommunityService community;
    @Autowired NewsIngestionService newsIngestion;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @Test
    void adminSuspendUnsuspendForceWithdrawOAuthBanLogoutAllAndWithdrawalCleanupWorkEndToEnd() throws Exception {
        var admin = signup(identity(Provider.GOOGLE));
        Long adminId = admin.access().memberId();
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", adminId);
        String adminBearer = "Bearer " + admin.access().accessToken();

        // 1. Member suspend -> 403 MEMBER_SUSPENDED, refresh revoked -> unsuspend -> restored ACTIVE
        var targetProof = identity(Provider.GOOGLE);
        var target = signup(targetProof);
        Long targetId = target.access().memberId();
        String targetBearer = "Bearer " + target.access().accessToken();

        mvc.perform(post("/api/v1/admin/members/" + targetId + "/suspend")
                        .header("Authorization", adminBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"반복 스팸 도배 위반\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memberId").value(targetId))
                .andExpect(jsonPath("$.status").value("SUSPENDED"))
                .andExpect(jsonPath("$.suspendedReason").value("반복 스팸 도배 위반"));

        // Suspended member blocked in ActiveMemberFilter with 403 MEMBER_SUSPENDED
        mvc.perform(get("/api/v1/members/me").header("Authorization", targetBearer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_SUSPENDED"));

        // Refresh sessions were revoked and OAuth flow/login are blocked with 403 MEMBER_SUSPENDED
        assertThat(jdbc.queryForObject(
                "select count(*) from content.refresh_session where member_id = ? and status = 'ACTIVE'",
                Long.class, targetId)).isZero();
        var proofSession = new MockHttpSession();
        proofSession.setAttribute(VerifiedIdentity.SESSION_KEY, targetProof);
        mvc.perform(get("/api/v1/auth/flow").session(proofSession))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_SUSPENDED"));

        // Unsuspend restores ACTIVE
        mvc.perform(post("/api/v1/admin/members/" + targetId + "/unsuspend")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        mvc.perform(get("/api/v1/members/me").header("Authorization", targetBearer))
                .andExpect(status().isOk());

        // 2. Seed notification rows for target, then force-withdraw -> bans OAuth identity & purges notifications
        var commenter = signup(identity(Provider.KAKAO));
        var post = community.createPost(targetId, new CommunityService.CreatePostRequest("FREE", "BTC", "제재대상글", "본문"));
        community.createComment(commenter.access().memberId(), post.id(), new CommunityService.CreateCommentRequest("댓글 알림 생성", null));
        assertThat(jdbc.queryForObject("select count(*) from content.notification where receiver_member_id = ?", Long.class, targetId))
                .isGreaterThanOrEqualTo(1L);

        mvc.perform(delete("/api/v1/admin/members/" + targetId)
                        .header("Authorization", adminBearer)
                        .param("reason", "심각한 약관 위반"))
                .andExpect(status().isNoContent());

        // Notification tables cleaned up
        assertThat(jdbc.queryForObject("select count(*) from content.notification where receiver_member_id = ?", Long.class, targetId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from content.notification_state where member_id = ?", Long.class, targetId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from content.notification_group_state where receiver_member_id = ?", Long.class, targetId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from content.notification_dedupe_state where receiver_member_id = ? or actor_member_id = ?", Long.class, targetId, targetId)).isZero();

        // Banned OAuth identity blocks re-signup AND flow with 403 MEMBER_BANNED!
        var retrySession = new MockHttpSession();
        retrySession.setAttribute(VerifiedIdentity.SESSION_KEY, targetProof);
        mvc.perform(get("/api/v1/auth/flow").session(retrySession))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_BANNED"));
        mvc.perform(post("/api/v1/auth/signup")
                        .session(retrySession)
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nickname\":\"재가입시도\",\"termAgree\":true,\"privateAgree\":true,\"termsVersion\":\"ym-terms-v2\",\"privacyVersion\":\"ym-privacy-v2\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_BANNED"));

        // 3. Voluntary withdrawal delivered() also cleans up notification tables & missing CSRF returns 403 CSRF_INVALID
        var leavingProof = identity(Provider.GOOGLE);
        var leaving = signup(leavingProof);
        Long leavingId = leaving.access().memberId();
        String leavingBearer = "Bearer " + leaving.access().accessToken();
        var leavingPost = community.createPost(leavingId, new CommunityService.CreatePostRequest("FREE", "ETH", "탈퇴전글", "본문"));
        community.createComment(commenter.access().memberId(), leavingPost.id(), new CommunityService.CreateCommentRequest("탈퇴전댓글", null));
        assertThat(jdbc.queryForObject("select count(*) from content.notification where receiver_member_id = ?", Long.class, leavingId))
                .isGreaterThanOrEqualTo(1L);

        // Missing CSRF on withdrawal endpoint returns 403 CSRF_INVALID (not ACCESS_DENIED)
        var leavingSession = new MockHttpSession();
        leavingSession.setAttribute(VerifiedIdentity.SESSION_KEY, leavingProof);
        mvc.perform(post("/api/v1/members/me/withdrawal")
                        .header("Authorization", leavingBearer)
                        .session(leavingSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new WithdrawalRequest(true, "탈퇴합니다", "ym-withdrawal-v1"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_INVALID"));

        withdrawals.request(leavingId, new WithdrawalRequest(true, "탈퇴합니다", "ym-withdrawal-v1"), leavingProof);
        withdrawals.delivered(leavingId);
        assertThat(jdbc.queryForObject("select count(*) from content.notification where receiver_member_id = ?", Long.class, leavingId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from content.notification_state where member_id = ?", Long.class, leavingId)).isZero();

        // 4. POST /api/v1/auth/logout-all revokes all refresh sessions across multiple logins
        var multiProof = identity(Provider.GOOGLE);
        var session1 = signup(multiProof);
        var session2 = auth.completeLogin(multiProof);
        Long multiId = session1.access().memberId();
        assertThat(jdbc.queryForObject(
                "select count(*) from content.refresh_session where member_id = ? and status = 'ACTIVE'",
                Long.class, multiId)).isEqualTo(2L);

        mvc.perform(post("/api/v1/auth/logout-all"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

        mvc.perform(post("/api/v1/auth/logout-all")
                        .header("Authorization", "Bearer " + session1.access().accessToken()))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Set-Cookie", containsString("Max-Age=0")));

        assertThat(jdbc.queryForObject(
                "select count(*) from content.refresh_session where member_id = ? and status <> 'REVOKED'",
                Long.class, multiId)).isZero();
        assertThatThrownBy(() -> auth.refresh(session1.refresh())).isInstanceOf(AuthFailure.class);
        assertThatThrownBy(() -> auth.refresh(session2.refresh())).isInstanceOf(AuthFailure.class);
    }

    @Test
    void reportNineReasonFilterSoftStatusNotificationsPostViewsAndAdminRestoreWorkEndToEnd() throws Exception {
        var admin = signup(identity(Provider.GOOGLE));
        Long adminId = admin.access().memberId();
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", adminId);
        String adminBearer = "Bearer " + admin.access().accessToken();

        var author = signup(identity(Provider.GOOGLE));
        var reporter = signup(identity(Provider.KAKAO));
        String authorBearer = "Bearer " + author.access().accessToken();
        String reporterBearer = "Bearer " + reporter.access().accessToken();

        // Create two posts & check viewCount increment + admin restore
        var post1 = community.createPost(author.access().memberId(), new CommunityService.CreatePostRequest("FREE", "BTC", "조회수복구테스트글", "본문1"));
        var post2 = community.createPost(author.access().memberId(), new CommunityService.CreatePostRequest("MARKET", "SOL", "신고제재테스트글", "본문2"));
        assertThat(post1.viewCount()).isZero();

        mvc.perform(get("/api/v1/community/posts/" + post1.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewCount").value(1));
        mvc.perform(get("/api/v1/community/posts/" + post1.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewCount").value(2));

        // Admin soft-deletes post1 -> 404, then restores post1 -> 200 OK
        mvc.perform(delete("/api/v1/admin/community/posts/" + post1.id())
                        .header("Authorization", adminBearer))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/community/posts/" + post1.id()))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/admin/community/posts/" + post1.id() + "/restore")
                        .header("Authorization", adminBearer))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/community/posts/" + post1.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewCount").value(3));

        // Report post1 with PRIVACY and post2 with ILLEGAL
        mvc.perform(put("/api/v1/community/posts/" + post1.id() + "/reports")
                        .header("Authorization", reporterBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reasonType\":\"PRIVACY\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reportCount").value(1));
        mvc.perform(put("/api/v1/community/posts/" + post2.id() + "/reports")
                        .header("Authorization", reporterBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reasonType\":\"ILLEGAL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reportCount").value(1));

        // All 9 reasons + alias OTHER must return 200 OK (never 400!)
        for (String reason : List.of("SPAM", "SEXUAL", "ILLEGAL", "YOUTH_HARMFUL", "ABUSE", "PRIVACY", "INAPPROPRIATE", "FRAUD", "ETC", "OTHER")) {
            mvc.perform(get("/api/v1/admin/community/reports")
                            .header("Authorization", adminBearer)
                            .param("reasonType", reason))
                    .andExpect(status().isOk());
        }

        // Dismiss report on post1 -> soft status DISMISSED (not hard-deleted!) + reporter notified
        mvc.perform(delete("/api/v1/admin/community/reports/POST/" + post1.id() + "/reporters/" + reporter.access().memberId())
                        .header("Authorization", adminBearer)
                        .param("resolutionNote", "개인정보 노출 확인되지 않음"))
                .andExpect(status().isNoContent());

        String post1ReportStatus = jdbc.queryForObject(
                "select status from content.community_post_report where post_id = ? and member_id = ?",
                String.class, post1.id(), reporter.access().memberId());
        assertThat(post1ReportStatus).isEqualTo("DISMISSED");

        // Moderate post2 with DELETE_TARGET -> soft status RESOLVED, post soft-deleted, reporter & author notified
        mvc.perform(post("/api/v1/admin/community/reports/POST/" + post2.id() + "/moderate")
                        .header("Authorization", adminBearer)
                        .param("action", "DELETE_TARGET")
                        .param("resolutionNote", "불법정보 게시물 확인되어 삭제 조치함"))
                .andExpect(status().isNoContent());

        String post2ReportStatus = jdbc.queryForObject(
                "select status from content.community_post_report where post_id = ? and member_id = ?",
                String.class, post2.id(), reporter.access().memberId());
        assertThat(post2ReportStatus).isEqualTo("RESOLVED");

        // Reporter's /api/v1/members/me/community/reports STILL returns BOTH reports with real status & resolutionNote (even after post2 soft-delete!)
        JsonNode myReports = json.readTree(mvc.perform(get("/api/v1/members/me/community/reports")
                        .header("Authorization", reporterBearer))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertThat(myReports.path("items").size()).isEqualTo(2);
        Map<Long, JsonNode> byTargetId = new java.util.HashMap<>();
        for (JsonNode item : myReports.path("items")) {
            byTargetId.put(item.path("targetId").asLong(), item);
        }
        assertThat(byTargetId.get(post1.id()).path("status").asText()).isEqualTo("DISMISSED");
        assertThat(byTargetId.get(post1.id()).path("resolutionNote").asText()).isEqualTo("개인정보 노출 확인되지 않음");
        assertThat(byTargetId.get(post2.id()).path("status").asText()).isEqualTo("RESOLVED");
        assertThat(byTargetId.get(post2.id()).path("resolutionNote").asText()).isEqualTo("불법정보 게시물 확인되어 삭제 조치함");

        // Reporter received REPORT_DISMISSED and REPORT_RESOLVED notifications
        JsonNode reporterNotis = json.readTree(mvc.perform(get("/api/v1/notifications")
                        .param("category", "REPORT")
                        .header("Authorization", reporterBearer))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        List<String> reporterNotiTypes = new java.util.ArrayList<>();
        reporterNotis.path("content").forEach(n -> reporterNotiTypes.add(n.path("type").asText()));
        assertThat(reporterNotiTypes).containsExactlyInAnyOrder("REPORT_RESOLVED", "REPORT_DISMISSED");

        // Moderated post author received CONTENT_MODERATED notification
        mvc.perform(get("/api/v1/notifications")
                        .param("category", "REPORT")
                        .header("Authorization", authorBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].type").value("CONTENT_MODERATED"));
    }

    @Test
    void newsReactionsAreIdempotentSupportingSetSwitchAndToggleOff() throws Exception {
        String recentPub = DateTimeFormatter.RFC_1123_DATE_TIME.format(Instant.now().minusSeconds(60).atOffset(ZoneOffset.UTC));
        String rss = """
                <?xml version="1.0" encoding="UTF-8"?>
                <rss version="2.0"><channel><title>Idempotent Reaction Feed</title>
                  <item>
                    <title>비트코인 멱등 반응 테스트 뉴스 %s</title>
                    <link>https://news.example.com/react/%s</link>
                    <pubDate>%s</pubDate>
                    <description>멱등성 검증용 기사</description>
                  </item>
                </channel></rss>
                """.formatted(UUID.randomUUID(), UUID.randomUUID(), recentPub);
        var inserted = newsIngestion.ingestRssXml(rss, "BREAKING", "COIN_FLASH", 5);
        long newsId = inserted.get(0).id();

        var member = signup(identity(Provider.GOOGLE));
        String memberBearer = "Bearer " + member.access().accessToken();

        // 1. Authenticated member sets BULL -> bull=1, bear=0, userReaction=BULL
        mvc.perform(post("/api/v1/news/" + newsId + "/reactions")
                        .header("Authorization", memberBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reaction\":\"BULL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bullCount").value(1))
                .andExpect(jsonPath("$.bearCount").value(0))
                .andExpect(jsonPath("$.userReaction").value("BULL"));

        // Article detail reflects member's active userReaction
        mvc.perform(get("/api/v1/news/" + newsId)
                        .param("countView", "false")
                        .header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userReaction").value("BULL"));

        // 2. Member switches BULL -> BEAR -> bull=0, bear=1, userReaction=BEAR
        mvc.perform(post("/api/v1/news/" + newsId + "/reactions")
                        .header("Authorization", memberBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reaction\":\"BEAR\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bullCount").value(0))
                .andExpect(jsonPath("$.bearCount").value(1))
                .andExpect(jsonPath("$.userReaction").value("BEAR"));

        // 3. Member clicks BEAR again (toggle-off) -> bull=0, bear=0, userReaction=null
        mvc.perform(post("/api/v1/news/" + newsId + "/reactions")
                        .header("Authorization", memberBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reaction\":\"BEAR\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bullCount").value(0))
                .andExpect(jsonPath("$.bearCount").value(0))
                .andExpect(jsonPath("$.userReaction").value(nullValue()));

        // 4. Anonymous IP+UA actor can set BULL and toggle off independently
        mvc.perform(post("/api/v1/news/" + newsId + "/reactions")
                        .header("X-Forwarded-For", "192.0.2.55")
                        .header("User-Agent", "TestBrowser/1.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reaction\":\"BULL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bullCount").value(1))
                .andExpect(jsonPath("$.userReaction").value("BULL"));
        mvc.perform(post("/api/v1/news/" + newsId + "/reactions")
                        .header("X-Forwarded-For", "192.0.2.55")
                        .header("User-Agent", "TestBrowser/1.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reaction\":\"BULL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bullCount").value(0))
                .andExpect(jsonPath("$.userReaction").value(nullValue()));
    }

    @Test
    void publishedV2PoliciesAndSupportInquiryLoopWithAdminReplyAndNotificationWorkEndToEnd() throws Exception {
        // 1. Finalized V2 policies are current & PUBLISHED without contradictory draft sentences
        mvc.perform(get("/api/v1/policies/current"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.policies.length()").value(2));
        mvc.perform(get("/api/v1/policies/TERMS/ym-terms-v2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.documentStatus").value("PUBLISHED"))
                .andExpect(jsonPath("$.text", not(containsString("커뮤니티를 구현하지 않는다"))));
        mvc.perform(get("/api/v1/policies/PRIVACY/ym-privacy-v2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.documentStatus").value("PUBLISHED"))
                .andExpect(jsonPath("$.text", not(containsString("개발 단계 초안"))));

        // 2. Support inquiry submit -> list me -> admin list -> admin reply -> member notification
        var member = signup(identity(Provider.GOOGLE));
        var admin = signup(identity(Provider.KAKAO));
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", admin.access().memberId());
        String memberBearer = "Bearer " + member.access().accessToken();
        String adminBearer = "Bearer " + admin.access().accessToken();

        JsonNode created = json.readTree(mvc.perform(post("/api/v1/support/inquiries")
                        .header("Authorization", memberBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category\":\"TRADING\",\"title\":\"모의투자 정산 문의\",\"content\":\"시즌 종료 후 랭킹 반영 시각을 알고 싶습니다.\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andExpect(jsonPath("$.category").value("TRADING"))
                .andReturn().getResponse().getContentAsString());
        long inquiryId = created.path("id").asLong();

        mvc.perform(get("/api/v1/support/inquiries/me").header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(inquiryId))
                .andExpect(jsonPath("$.items[0].status").value("OPEN"));

        // Normal member cannot access admin support routes
        mvc.perform(get("/api/v1/admin/support/inquiries").header("Authorization", memberBearer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        // Admin lists OPEN inquiries and replies
        mvc.perform(get("/api/v1/admin/support/inquiries")
                        .param("status", "OPEN")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openCount").isNumber())
                .andExpect(jsonPath("$.items[0].id").value(inquiryId));

        mvc.perform(post("/api/v1/admin/support/inquiries/" + inquiryId + "/reply")
                        .header("Authorization", adminBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reply\":\"시즌 종료 후 정산 배치 완료 즉시 리더보드에 반영됩니다.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ANSWERED"))
                .andExpect(jsonPath("$.adminReply").value("시즌 종료 후 정산 배치 완료 즉시 리더보드에 반영됩니다."));

        // Member sees reply in /me and receives SUPPORT_INQUIRY_ANSWERED notification
        mvc.perform(get("/api/v1/support/inquiries/me").header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].status").value("ANSWERED"))
                .andExpect(jsonPath("$.items[0].adminReply").value("시즌 종료 후 정산 배치 완료 즉시 리더보드에 반영됩니다."));

        mvc.perform(get("/api/v1/notifications")
                        .param("category", "SUPPORT")
                        .header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].type").value("SUPPORT_INQUIRY_ANSWERED"))
                .andExpect(jsonPath("$.content[0].payload.inquiryId").value(inquiryId));
    }

    @Test
    void requestIdTracingActuatorAccessControlAdminOpsSummaryAndS3RetryFailedWorkEndToEnd() throws Exception {
        var member = signup(identity(Provider.GOOGLE));
        var admin = signup(identity(Provider.KAKAO));
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", admin.access().memberId());
        String memberBearer = "Bearer " + member.access().accessToken();
        String adminBearer = "Bearer " + admin.access().accessToken();

        // 1. X-Request-Id echoed and included in ProblemDetail
        String customReqId = "req-trace-12345678";
        mvc.perform(get("/api/v1/community/posts/999999999")
                        .header("X-Request-Id", customReqId))
                .andExpect(status().isNotFound())
                .andExpect(header().string("X-Request-Id", customReqId))
                .andExpect(jsonPath("$.requestId").value(customReqId))
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));

        // Auto-generated X-Request-Id when omitted
        var autoRes = mvc.perform(get("/api/v1/policies/current"))
                .andExpect(status().isOk())
                .andExpect(header().exists("X-Request-Id"))
                .andReturn().getResponse();
        assertThat(autoRes.getHeader("X-Request-Id")).matches("^[a-f0-9]{16}$");

        // 2. Actuator security: health public, info/metrics require ROLE_ADMIN
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
        mvc.perform(get("/actuator/health/liveness")).andExpect(status().isOk());
        mvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk());

        mvc.perform(get("/actuator/info")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/info").header("Authorization", memberBearer)).andExpect(status().isForbidden());
        mvc.perform(get("/actuator/info").header("Authorization", adminBearer)).andExpect(status().isOk());

        mvc.perform(get("/actuator/metrics")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/metrics").header("Authorization", memberBearer)).andExpect(status().isForbidden());
        mvc.perform(get("/actuator/metrics").header("Authorization", adminBearer)).andExpect(status().isOk());

        // 3. Admin ops summary & S3 failed task retry
        mvc.perform(get("/api/v1/admin/ops/summary")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/admin/ops/summary").header("Authorization", memberBearer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        String failedKey = "community/post/20261121/failed-" + UUID.randomUUID() + ".png";
        jdbc.update(
                "insert into content.s3_cleanup_task(s3_key, reason, status, attempt_count, max_attempts, next_attempt_at, last_error, created_at) "
                        + "values (?, 'TEST_FAIL', 'FAILED', 5, 5, now(), 'Max retry attempts reached', now())",
                failedKey);

        mvc.perform(get("/api/v1/admin/ops/summary").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.db.up").value(true))
                .andExpect(jsonPath("$.newsIngestion.consecutiveFailures").isNumber())
                .andExpect(jsonPath("$.outbox.pendingWithdrawals").isNumber())
                .andExpect(jsonPath("$.outbox.stuckWithdrawals").isNumber())
                .andExpect(jsonPath("$.outbox.pendingProvisions").isNumber())
                .andExpect(jsonPath("$.outbox.stuckProvisions").isNumber())
                .andExpect(jsonPath("$.outbox.pendingS3Cleanup").isNumber())
                .andExpect(jsonPath("$.outbox.failedS3Cleanup").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$.openSupportInquiries").isNumber())
                .andExpect(jsonPath("$.activeSse.newsSse").isNumber())
                .andExpect(jsonPath("$.activeSse.communitySse").isNumber())
                .andExpect(jsonPath("$.activeSse.notificationSse").isNumber())
                .andExpect(jsonPath("$.recentErrors").isArray());

        mvc.perform(post("/api/v1/admin/ops/s3-cleanup/retry-failed").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.retriedCount").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));

        var retriedRow = jdbc.queryForMap(
                "select status, attempt_count, last_error from content.s3_cleanup_task where s3_key = ?",
                failedKey);
        assertThat(retriedRow.get("status")).isEqualTo("PENDING");
        assertThat(((Number) retriedRow.get("attempt_count")).intValue()).isZero();
        assertThat(retriedRow.get("last_error")).isNull();
    }

    private AuthService.Issued signup(VerifiedIdentity identity) {
        String nick = "u" + UUID.randomUUID().toString().replace("-", "").substring(0, 7);
        return auth.signup(identity, new SignupRequest(nick, true, true, "test", "ym-terms-v2", "ym-privacy-v2"));
    }

    private static VerifiedIdentity identity(Provider provider) {
        return new VerifiedIdentity(provider, UUID.randomUUID().toString(), "ops-test@example.test", Instant.now().plusSeconds(300));
    }
}
