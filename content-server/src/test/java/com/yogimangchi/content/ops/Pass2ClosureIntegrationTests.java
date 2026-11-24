package com.yogimangchi.content.ops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.community.CommunityService;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.news.NewsIngestionService;
import com.yogimangchi.content.support.TestEnvironment;
import com.yogimangchi.content.support.TestInfrastructure;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "content.oauth.enabled=false")
@AutoConfigureMockMvc
@Import(TestInfrastructure.class)
class Pass2ClosureIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired CommunityService community;
    @Autowired NewsIngestionService newsIngestion;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @Test
    void c1ClientSpoofedVerifiedFlagIsAlwaysPersistedFalseAndMaxLeverageIs100() throws Exception {
        var author = signup();
        String bearer = "Bearer " + author.access().accessToken();

        // Leverage 101 (and 125) rejected with 400 INVALID_REQUEST
        for (int badLev : new int[]{101, 125}) {
            mvc.perform(post("/api/v1/community/posts")
                            .header("Authorization", bearer)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {
                                      "category": "POSITION",
                                      "symbolTag": "BTC",
                                      "title": "과도한 레버리지 거절 테스트",
                                      "content": "본문",
                                      "sharedPosition": {
                                        "id": "MOCK_POS_1",
                                        "marketLabel": "모의투자 선물",
                                        "symbol": "BTC",
                                        "pair": "BTCUSDT",
                                        "side": "LONG",
                                        "leverage": %d,
                                        "entryPrice": "90000",
                                        "markPrice": "91000",
                                        "liquidationPrice": "89000",
                                        "roePct": "+100%%",
                                        "pnlUsdt": "+500 USDT",
                                        "positive": true,
                                        "showPnlAmount": true,
                                        "verified": true
                                      }
                                    }
                                    """.formatted(badLev)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }

        // Client POSTing verified=true without Trading Server confirmation MUST be persisted & returned as verified=false
        String createdBody = mvc.perform(post("/api/v1/community/posts")
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "category": "POSITION",
                                  "symbolTag": "BTC",
                                  "title": "스푸핑 검증 테스트",
                                  "content": "클라이언트가 verified=true를 위조해도 false로 저장되어야 함",
                                  "sharedPosition": {
                                    "id": "FAKE_POS_999",
                                    "marketLabel": "모의투자 선물",
                                    "symbol": "BTC",
                                    "pair": "BTCUSDT",
                                    "side": "LONG",
                                    "leverage": 100,
                                    "entryPrice": "90000",
                                    "markPrice": "95000",
                                    "liquidationPrice": "89100",
                                    "roePct": "+555.00%",
                                    "pnlUsdt": "+5550.00 USDT",
                                    "positive": true,
                                    "showPnlAmount": true,
                                    "verified": true
                                  }
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.sharedPosition.leverage").value(100))
                .andExpect(jsonPath("$.sharedPosition.verified").value(false))
                .andReturn().getResponse().getContentAsString();
        long postId = json.readTree(createdBody).path("id").asLong();

        // Confirm raw DB JSON column also has verified=false
        String rawDbJson = jdbc.queryForObject(
                "select shared_position_json from content.community_post where id = ?",
                String.class, postId);
        assertThat(json.readTree(rawDbJson).path("verified").asBoolean()).isFalse();

        // PATCH attempting to spoof verified=true also persists verified=false
        mvc.perform(patch("/api/v1/community/posts/" + postId)
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "sharedPosition": {
                                    "id": "FAKE_POS_999",
                                    "marketLabel": "모의투자 선물",
                                    "symbol": "ETH",
                                    "pair": "ETHUSDT",
                                    "side": "SHORT",
                                    "leverage": 50,
                                    "entryPrice": "3500",
                                    "markPrice": "3400",
                                    "liquidationPrice": "3570",
                                    "roePct": "+142.86%",
                                    "pnlUsdt": "+1428.57 USDT",
                                    "positive": true,
                                    "showPnlAmount": true,
                                    "verified": true
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sharedPosition.symbol").value("ETH"))
                .andExpect(jsonPath("$.sharedPosition.verified").value(false));
    }

    @Test
    void c2SuspendedAndBannedMembersPreserveRealNicknameAndAccurateStatusAcrossCommunityAdminAndSupport() throws Exception {
        var admin = signup();
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", admin.access().memberId());
        String adminBearer = "Bearer " + admin.access().accessToken();

        var suspendedUser = signup();
        var reporter = signup();
        Long suspendedId = suspendedUser.access().memberId();
        String suspendedNick = suspendedUser.access().nickname();
        String suspendedBearer = "Bearer " + suspendedUser.access().accessToken();
        String reporterBearer = "Bearer " + reporter.access().accessToken();

        // Create post, comment, report, and support inquiry BEFORE suspending
        var post = community.createPost(suspendedId,
                new CommunityService.CreatePostRequest("FREE", "BTC", "정지회원닉네임보존글", "정지된 회원도 닉네임이 유지되어야 합니다."));
        var comment = community.createComment(suspendedId, post.id(),
                new CommunityService.CreateCommentRequest("정지회원닉네임보존댓글", null));
        mvc.perform(put("/api/v1/community/posts/" + post.id() + "/reports")
                        .header("Authorization", reporterBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reasonType\":\"SPAM\"}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/support/inquiries")
                        .header("Authorization", suspendedBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category\":\"ACCOUNT\",\"title\":\"정지전문의\",\"content\":\"문의 내용\"}"))
                .andExpect(status().isCreated());

        // Suspend the member
        mvc.perform(post("/api/v1/admin/members/" + suspendedId + "/suspend")
                        .header("Authorization", adminBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"임시 정지 사유\"}"))
                .andExpect(status().isOk());

        // 1. Public Community post & comment views preserve real nickname (NOT "탈퇴한회원") and accurate authorStatus="SUSPENDED"
        mvc.perform(get("/api/v1/community/posts/" + post.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authorNickname").value(suspendedNick))
                .andExpect(jsonPath("$.authorWithdrawn").value(false))
                .andExpect(jsonPath("$.authorStatus").value("SUSPENDED"));

        mvc.perform(get("/api/v1/community/posts/" + post.id() + "/comments"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(comment.id()))
                .andExpect(jsonPath("$.items[0].authorNickname").value(suspendedNick))
                .andExpect(jsonPath("$.items[0].authorWithdrawn").value(false))
                .andExpect(jsonPath("$.items[0].authorStatus").value("SUSPENDED"));

        // 2. Admin posts/replies views preserve real nickname & authorStatus="SUSPENDED",
        //    AND /withdrawn-author MUST NOT include suspended members!
        mvc.perform(get("/api/v1/admin/community/posts")
                        .header("Authorization", adminBearer)
                        .param("title", "정지회원닉네임보존글")
                        .param("authorNickname", suspendedNick))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].authorNickname").value(suspendedNick))
                .andExpect(jsonPath("$.content[0].authorStatus").value("SUSPENDED"));

        mvc.perform(get("/api/v1/admin/community/posts/withdrawn-author")
                        .header("Authorization", adminBearer)
                        .param("title", "정지회원닉네임보존글"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));

        mvc.perform(get("/api/v1/admin/community/replies")
                        .header("Authorization", adminBearer)
                        .param("replyContent", "정지회원닉네임보존댓글")
                        .param("authorNickname", suspendedNick))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].authorNickname").value(suspendedNick))
                .andExpect(jsonPath("$.content[0].authorStatus").value("SUSPENDED"));

        mvc.perform(get("/api/v1/admin/community/replies/withdrawn-author")
                        .header("Authorization", adminBearer)
                        .param("replyContent", "정지회원닉네임보존댓글"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));

        // 3. Admin reports view preserves targetAuthorNickname and targetAuthorStatus="SUSPENDED"
        mvc.perform(get("/api/v1/admin/community/reports")
                        .header("Authorization", adminBearer)
                        .param("keyword", "정지회원닉네임보존글"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].targetAuthorNickname").value(suspendedNick))
                .andExpect(jsonPath("$.content[0].targetAuthorStatus").value("SUSPENDED"));

        // 4. Support inquiry admin view preserves memberNickname and memberStatus="SUSPENDED"
        JsonNode adminInquiries = json.readTree(mvc.perform(get("/api/v1/admin/support/inquiries")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        JsonNode matchedInquiry = null;
        for (JsonNode item : adminInquiries.path("items")) {
            if (item.path("memberId").asLong() == suspendedId) {
                matchedInquiry = item;
                break;
            }
        }
        assertThat(matchedInquiry).isNotNull();
        assertThat(matchedInquiry.path("memberNickname").asText()).isEqualTo(suspendedNick);
        assertThat(matchedInquiry.path("memberStatus").asText()).isEqualTo("SUSPENDED");
    }

    @Test
    void c3ForgedXForwardedForHeadersDoNotBypassNewsReactionDeduplication() throws Exception {
        String recentPub = DateTimeFormatter.RFC_1123_DATE_TIME.format(Instant.now().minusSeconds(60).atOffset(ZoneOffset.UTC));
        String rss = """
                <?xml version="1.0" encoding="UTF-8"?>
                <rss version="2.0"><channel><title>XFF Spoof Feed</title>
                  <item>
                    <title>XFF 헤더 스푸핑 차단 테스트 뉴스 %s</title>
                    <link>https://news.example.com/xff/%s</link>
                    <pubDate>%s</pubDate>
                    <description>위조 X-Forwarded-For 차단 검증</description>
                  </item>
                </channel></rss>
                """.formatted(UUID.randomUUID(), UUID.randomUUID(), recentPub);
        long newsId = newsIngestion.ingestRssXml(rss, "BREAKING", "COIN_FLASH", 5).get(0).id();

        // First vote from remoteAddr=192.0.2.77 with forged X-Forwarded-For=198.51.100.1 -> bullCount=1
        mvc.perform(post("/api/v1/news/" + newsId + "/reactions")
                        .with(req -> {
                            req.setRemoteAddr("192.0.2.77");
                            return req;
                        })
                        .header("X-Forwarded-For", "198.51.100.1")
                        .header("User-Agent", "SpoofTest/1.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reaction\":\"BULL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bullCount").value(1))
                .andExpect(jsonPath("$.userReaction").value("BULL"));

        // Second vote from SAME remoteAddr=192.0.2.77 with DIFFERENT forged X-Forwarded-For=198.51.100.2
        // MUST resolve to the same actor and toggle OFF to 0 (never inflate bullCount to 2!)
        mvc.perform(post("/api/v1/news/" + newsId + "/reactions")
                        .with(req -> {
                            req.setRemoteAddr("192.0.2.77");
                            return req;
                        })
                        .header("X-Forwarded-For", "198.51.100.2")
                        .header("User-Agent", "SpoofTest/1.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reaction\":\"BULL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bullCount").value(0))
                .andExpect(jsonPath("$.userReaction").value(nullValue()));
    }

    @Test
    void c6AdminReplyRestoreRestoresCommentVisibilityAndCountersAtomicallyAndEnforcesAdminRole() throws Exception {
        var admin = signup();
        var member = signup();
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", admin.access().memberId());
        String adminBearer = "Bearer " + admin.access().accessToken();
        String memberBearer = "Bearer " + member.access().accessToken();

        var post = community.createPost(member.access().memberId(),
                new CommunityService.CreatePostRequest("FREE", "SOL", "댓글복구테스트글", "본문"));
        var rootComment = community.createComment(member.access().memberId(), post.id(),
                new CommunityService.CreateCommentRequest("루트 댓글 원문", null));
        var childReply = community.createComment(member.access().memberId(), post.id(),
                new CommunityService.CreateCommentRequest("자식 대댓글 원문", rootComment.id()));

        // Non-admin & unauthenticated cannot call restore
        mvc.perform(post("/api/v1/admin/community/replies/" + childReply.id() + "/restore"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/admin/community/replies/" + childReply.id() + "/restore")
                        .header("Authorization", memberBearer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        // Unknown reply returns 404 COMMENT_NOT_FOUND
        mvc.perform(post("/api/v1/admin/community/replies/999999999/restore")
                        .header("Authorization", adminBearer))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMENT_NOT_FOUND"));

        // Admin deletes child reply -> post commentCount drops 2 -> 1, root reply_count drops 1 -> 0
        mvc.perform(delete("/api/v1/admin/community/replies/" + childReply.id())
                        .header("Authorization", adminBearer))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/community/posts/" + post.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentCount").value(1));
        assertThat(jdbc.queryForObject(
                "select reply_count from content.community_comment where id = ?",
                Integer.class, rootComment.id())).isZero();

        // Admin restores child reply (twice to verify idempotency)
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/v1/admin/community/replies/" + childReply.id() + "/restore")
                            .header("Authorization", adminBearer))
                    .andExpect(status().isNoContent());
        }

        // Counters and public visibility are restored cleanly!
        mvc.perform(get("/api/v1/community/posts/" + post.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentCount").value(2));
        assertThat(jdbc.queryForObject(
                "select reply_count from content.community_comment where id = ?",
                Integer.class, rootComment.id())).isEqualTo(1);

        mvc.perform(get("/api/v1/community/posts/" + post.id() + "/comments"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[1].id").value(childReply.id()))
                .andExpect(jsonPath("$.items[1].content").value("자식 대댓글 원문"))
                .andExpect(jsonPath("$.items[1].deleted").value(false));

        mvc.perform(get("/api/v1/admin/community/replies")
                        .header("Authorization", adminBearer)
                        .param("replyContent", "자식 대댓글 원문"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].replyId").value(childReply.id()))
                .andExpect(jsonPath("$.content[0].deleteYn").value("N"));
    }

    @Test
    void c7SuspendedMemberCanReadOwnProfileSubmitSupportAppealAndLogoutAllWhileBlockedFromCommunityAndBannedIsBlockedEverywhere() throws Exception {
        var admin = signup();
        jdbc.update("update content.member set role = 'ADMIN' where id = ?", admin.access().memberId());
        String adminBearer = "Bearer " + admin.access().accessToken();

        var activeAuthor = signup();
        var existingPost = community.createPost(activeAuthor.access().memberId(),
                new CommunityService.CreatePostRequest("FREE", "BTC", "일반게시글", "본문"));

        var target = signup();
        Long targetId = target.access().memberId();
        String targetBearer = "Bearer " + target.access().accessToken();

        // Suspend target member
        mvc.perform(post("/api/v1/admin/members/" + targetId + "/suspend")
                        .header("Authorization", adminBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"커뮤니티 운영정책 위반\"}"))
                .andExpect(status().isOk());

        // 1. Suspended member CAN read GET /api/v1/members/me
        mvc.perform(get("/api/v1/members/me").header("Authorization", targetBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memberId").value(targetId))
                .andExpect(jsonPath("$.nickname").value(target.access().nickname()))
                .andExpect(jsonPath("$.status").value("SUSPENDED"))
                .andExpect(jsonPath("$.suspendedReason").value("커뮤니티 운영정책 위반"));

        // 2. Suspended member CAN submit a 1:1 support appeal & list own inquiries
        JsonNode appeal = json.readTree(mvc.perform(post("/api/v1/support/inquiries")
                        .header("Authorization", targetBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category\":\"ACCOUNT\",\"title\":\"정지 이의 제기\",\"content\":\"오해가 있어 재검토 부탁드립니다.\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.memberNickname").value(target.access().nickname()))
                .andExpect(jsonPath("$.memberStatus").value("SUSPENDED"))
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andReturn().getResponse().getContentAsString());
        long appealId = appeal.path("id").asLong();

        mvc.perform(get("/api/v1/support/inquiries/me").header("Authorization", targetBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(appealId))
                .andExpect(jsonPath("$.items[0].title").value("정지 이의 제기"));

        // 3. Suspended member CAN call POST /api/v1/auth/logout-all
        mvc.perform(post("/api/v1/auth/logout-all").header("Authorization", targetBearer))
                .andExpect(status().isNoContent());

        // 4. Suspended member CAN read notifications (for appeal replies), while STILL blocked with 403 MEMBER_SUSPENDED on posting, commenting, profile edit
        mvc.perform(post("/api/v1/community/posts")
                        .header("Authorization", targetBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category\":\"FREE\",\"title\":\"차단\",\"content\":\"차단\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_SUSPENDED"));

        mvc.perform(post("/api/v1/community/posts/" + existingPost.id() + "/comments")
                        .header("Authorization", targetBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"정지중 댓글 차단\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_SUSPENDED"));

        mvc.perform(patch("/api/v1/members/me/profile")
                        .header("Authorization", targetBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"profileMessage\":\"정지중 수정 차단\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_SUSPENDED"));

        mvc.perform(get("/api/v1/notifications").header("Authorization", targetBearer))
                .andExpect(status().isOk());

        // 5. BANNED member is blocked EVERYWHERE (even /members/me and /support/inquiries)
        jdbc.update("update content.member set status = 'BANNED' where id = ?", targetId);
        mvc.perform(get("/api/v1/members/me").header("Authorization", targetBearer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_BANNED"));
        mvc.perform(get("/api/v1/support/inquiries/me").header("Authorization", targetBearer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_BANNED"));
        mvc.perform(post("/api/v1/support/inquiries")
                        .header("Authorization", targetBearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category\":\"ACCOUNT\",\"title\":\"차단회원\",\"content\":\"차단되어야함\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_BANNED"));
    }

    private AuthService.Issued signup() {
        String nick = "p" + UUID.randomUUID().toString().replace("-", "").substring(0, 7);
        return auth.signup(
                new VerifiedIdentity(Provider.GOOGLE, UUID.randomUUID().toString(), nick + "@example.test", Instant.now().plusSeconds(300)),
                new SignupRequest(nick, true, true, "test", "ym-terms-v3", "ym-privacy-v3"));
    }
}
