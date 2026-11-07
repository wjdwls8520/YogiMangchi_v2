package com.yogimangchi.content.community;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.member.dto.WithdrawalRequest;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.member.service.ContentRetentionCleanupService;
import com.yogimangchi.content.member.service.MemberProvisioning;
import com.yogimangchi.content.member.service.MemberWithdrawals;
import com.yogimangchi.content.support.TestEnvironment;
import com.yogimangchi.content.support.TestInfrastructure;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
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
class CommunityNewsAndRetentionIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired MemberWithdrawals withdrawals;
    @Autowired MemberProvisioning provisioning;
    @Autowired ContentRetentionCleanupService retentionCleanup;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @Test
    void retentionCleanupPurgesExpiredSessionsAndCompletedProvisionsWhilePreservingActiveAndPendingData() {
        Instant now = Instant.now();
        var oldCompletedMember = signup();
        var oldCanceledMember = signup();
        var activePendingMember = signup();

        Long oldCompletedId = oldCompletedMember.access().memberId();
        Long oldCanceledId = oldCanceledMember.access().memberId();
        Long activePendingId = activePendingMember.access().memberId();

        // Mark oldCompletedMember's session as expired > 35 days ago and provision as COMPLETED > 35 days ago.
        Timestamp expired35DaysAgo = Timestamp.from(now.minus(Duration.ofDays(35)));
        jdbc.update(
                "update content.refresh_session set status = 'REVOKED', expires_at = ? where member_id = ?",
                expired35DaysAgo, oldCompletedId);
        provisioning.acknowledged(oldCompletedId);
        jdbc.update(
                "update content.member_trading_provision set next_attempt_at = ? where member_id = ?",
                expired35DaysAgo, oldCompletedId);

        // Mark oldCanceledMember's session as expired > 31 days ago and provision as CANCELED > 31 days ago.
        Timestamp expired31DaysAgo = Timestamp.from(now.minus(Duration.ofDays(31)));
        jdbc.update(
                "update content.refresh_session set status = 'ROTATED', expires_at = ? where member_id = ?",
                expired31DaysAgo, oldCanceledId);
        jdbc.update(
                "update content.member_trading_provision set status = 'CANCELED', next_attempt_at = ? where member_id = ?",
                expired31DaysAgo, oldCanceledId);

        var result = retentionCleanup.purgeExpired(now);
        assertThat(result.purgedRefreshSessions()).isGreaterThanOrEqualTo(2);
        assertThat(result.purgedProvisions()).isGreaterThanOrEqualTo(2);

        assertThat(jdbc.queryForObject(
                "select count(*) from content.refresh_session where member_id in (?, ?)",
                Long.class, oldCompletedId, oldCanceledId)).isZero();
        assertThat(jdbc.queryForObject(
                "select count(*) from content.member_trading_provision where member_id in (?, ?)",
                Long.class, oldCompletedId, oldCanceledId)).isZero();

        // Active session and PENDING provision must remain untouched.
        assertThat(jdbc.queryForObject(
                "select count(*) from content.refresh_session where member_id = ? and status = 'ACTIVE'",
                Long.class, activePendingId)).isEqualTo(1L);
        assertThat(jdbc.queryForObject(
                "select status from content.member_trading_provision where member_id = ?",
                String.class, activePendingId)).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject(
                "select count(*) from content.member where id in (?, ?, ?)",
                Long.class, oldCompletedId, oldCanceledId, activePendingId)).isEqualTo(3L);
    }

    @Test
    void newsFeedSupportsCategorySymbolKeywordCursorPaginationAndSingleArticleLookup() throws Exception {
        var allNews = json.readTree(mvc.perform(get("/api/v1/news").param("size", "4"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(4))
                .andExpect(jsonPath("$.hasNext").value(true))
                .andExpect(jsonPath("$.nextCursorId").isNumber())
                .andReturn().getResponse().getContentAsString());

        long firstArticleId = allNews.path("items").get(0).path("id").asLong();
        long cursorId = allNews.path("nextCursorId").asLong();

        mvc.perform(get("/api/v1/news").param("size", "4").param("cursorId", Long.toString(cursorId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").isNumber());

        mvc.perform(get("/api/v1/news").param("category", "CRYPTO").param("symbolTag", "BTC"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].category").value("CRYPTO"))
                .andExpect(jsonPath("$.items[0].symbolTag").value("BTC"));

        mvc.perform(get("/api/v1/news").param("keyword", "ETF"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].symbolTag").value("BTC"));

        mvc.perform(get("/api/v1/news/" + firstArticleId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(firstArticleId))
                .andExpect(jsonPath("$.title").isNotEmpty())
                .andExpect(jsonPath("$.content").isNotEmpty());

        mvc.perform(get("/api/v1/news/999999999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));

        mvc.perform(get("/api/v1/news").param("category", "INVALID_CAT"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void communityPostCrudLikesCommentsAndWithdrawnAuthorTombstoneWorkEndToEnd() throws Exception {
        var authorProof = identity();
        var author = auth.signup(authorProof, new SignupRequest(nickname(), true, true, "author", "ym-terms-v1", "ym-privacy-v1"));
        var reader = signup();

        String authorBearer = "Bearer " + author.access().accessToken();
        String readerBearer = "Bearer " + reader.access().accessToken();

        // Anonymous cannot create post
        mvc.perform(post("/api/v1/community/posts")
                        .contentType("application/json")
                        .content(json.writeValueAsString(Map.of(
                                "category", "ANALYSIS",
                                "symbolTag", "btc",
                                "title", "BTC 선물 미결제약정 분석",
                                "content", "현물 수급과 펀딩비 중립화로 단기 지지선 테스트 중입니다."))))
                .andExpect(status().isUnauthorized());

        // Create post by author
        var createdPostBody = mvc.perform(post("/api/v1/community/posts")
                        .header("Authorization", authorBearer)
                        .contentType("application/json")
                        .content(json.writeValueAsString(Map.of(
                                "category", "ANALYSIS",
                                "symbolTag", "btc",
                                "title", "BTC 선물 미결제약정 분석",
                                "content", "현물 수급과 펀딩비 중립화로 단기 지지선 테스트 중입니다."))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorNickname").value(author.access().nickname()))
                .andExpect(jsonPath("$.authorWithdrawn").value(false))
                .andExpect(jsonPath("$.category").value("ANALYSIS"))
                .andExpect(jsonPath("$.symbolTag").value("BTC"))
                .andExpect(jsonPath("$.mine").value(true))
                .andExpect(jsonPath("$.likeCount").value(0))
                .andExpect(jsonPath("$.commentCount").value(0))
                .andReturn().getResponse().getContentAsString();
        long postId = json.readTree(createdPostBody).path("id").asLong();

        // Non-owner cannot edit or delete post
        mvc.perform(patch("/api/v1/community/posts/" + postId)
                        .header("Authorization", readerBearer)
                        .contentType("application/json")
                        .content("{\"title\":\"탈취 시도\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        // Owner updates post
        mvc.perform(patch("/api/v1/community/posts/" + postId)
                        .header("Authorization", authorBearer)
                        .contentType("application/json")
                        .content(json.writeValueAsString(Map.of(
                                "title", "BTC 선물 미결제약정 및 청산맵 업데이트",
                                "content", "상단 유동성 구간 돌파 여부를 함께 점검합니다."))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("BTC 선물 미결제약정 및 청산맵 업데이트"));

        // Idempotent like & unlike by reader
        for (int i = 0; i < 2; i++) {
            mvc.perform(put("/api/v1/community/posts/" + postId + "/likes")
                            .header("Authorization", readerBearer))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.postId").value(postId))
                    .andExpect(jsonPath("$.likeCount").value(1))
                    .andExpect(jsonPath("$.likedByMe").value(true));
        }

        // Reader view has likedByMe=true, mine=false
        mvc.perform(get("/api/v1/community/posts/" + postId)
                        .header("Authorization", readerBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.likeCount").value(1))
                .andExpect(jsonPath("$.likedByMe").value(true))
                .andExpect(jsonPath("$.mine").value(false));

        // Create root comment by author and reply by reader
        var rootCommentBody = mvc.perform(post("/api/v1/community/posts/" + postId + "/comments")
                        .header("Authorization", authorBearer)
                        .contentType("application/json")
                        .content(json.writeValueAsString(Map.of("content", "작성자 추가 코멘트입니다."))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorNickname").value(author.access().nickname()))
                .andExpect(jsonPath("$.authorWithdrawn").value(false))
                .andExpect(jsonPath("$.mine").value(true))
                .andReturn().getResponse().getContentAsString();
        long rootCommentId = json.readTree(rootCommentBody).path("id").asLong();

        var replyCommentBody = mvc.perform(post("/api/v1/community/posts/" + postId + "/comments")
                        .header("Authorization", readerBearer)
                        .contentType("application/json")
                        .content(json.writeValueAsString(Map.of(
                                "content", "좋은 분석 감사합니다!",
                                "parentCommentId", rootCommentId))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.parentCommentId").value(rootCommentId))
                .andExpect(jsonPath("$.authorNickname").value(reader.access().nickname()))
                .andReturn().getResponse().getContentAsString();
        long replyCommentId = json.readTree(replyCommentBody).path("id").asLong();

        mvc.perform(get("/api/v1/community/posts/" + postId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentCount").value(2));

        // Author withdraws completely (WITHDRAWING -> delivered -> WITHDRAWN)
        withdrawals.request(
                author.access().memberId(),
                new WithdrawalRequest(true, "탈퇴합니다", "ym-withdrawal-v1"),
                authorProof);
        withdrawals.delivered(author.access().memberId());

        // Existing post and comment by withdrawn author remain visible with "탈퇴한회원" and authorWithdrawn=true
        mvc.perform(get("/api/v1/community/posts/" + postId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(postId))
                .andExpect(jsonPath("$.authorNickname").value("탈퇴한회원"))
                .andExpect(jsonPath("$.authorWithdrawn").value(true))
                .andExpect(jsonPath("$.title").value("BTC 선물 미결제약정 및 청산맵 업데이트"));

        mvc.perform(get("/api/v1/community/posts")
                        .param("category", "ANALYSIS")
                        .param("sort", "POPULAR")
                        .param("symbolTag", "BTC")
                        .param("keyword", "청산맵"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(postId))
                .andExpect(jsonPath("$.items[0].authorNickname").value("탈퇴한회원"))
                .andExpect(jsonPath("$.items[0].authorWithdrawn").value(true));

        mvc.perform(get("/api/v1/community/posts/" + postId + "/comments"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(rootCommentId))
                .andExpect(jsonPath("$.items[0].authorNickname").value("탈퇴한회원"))
                .andExpect(jsonPath("$.items[0].authorWithdrawn").value(true))
                .andExpect(jsonPath("$.items[1].id").value(replyCommentId))
                .andExpect(jsonPath("$.items[1].authorNickname").value(reader.access().nickname()))
                .andExpect(jsonPath("$.items[1].authorWithdrawn").value(false));

        // Reader deletes own reply comment (idempotent)
        for (int i = 0; i < 2; i++) {
            mvc.perform(delete("/api/v1/community/comments/" + replyCommentId)
                            .header("Authorization", readerBearer))
                    .andExpect(status().isNoContent());
        }
        mvc.perform(get("/api/v1/community/posts/" + postId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentCount").value(1));

        // Reader unlikes post (idempotent)
        for (int i = 0; i < 2; i++) {
            mvc.perform(delete("/api/v1/community/posts/" + postId + "/likes")
                            .header("Authorization", readerBearer))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.likeCount").value(0))
                    .andExpect(jsonPath("$.likedByMe").value(false));
        }

        // Reader creates and soft-deletes own post
        var readerPostBody = mvc.perform(post("/api/v1/community/posts")
                        .header("Authorization", readerBearer)
                        .contentType("application/json")
                        .content(json.writeValueAsString(Map.of(
                                "category", "FREE",
                                "title", "자유게시판 인사",
                                "content", "오늘 시장 변동성이 크네요."))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        long readerPostId = json.readTree(readerPostBody).path("id").asLong();

        for (int i = 0; i < 2; i++) {
            mvc.perform(delete("/api/v1/community/posts/" + readerPostId)
                            .header("Authorization", readerBearer))
                    .andExpect(status().isNoContent());
        }
        mvc.perform(get("/api/v1/community/posts/" + readerPostId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
    }

    private AuthService.Issued signup() {
        return auth.signup(identity(), new SignupRequest(nickname(), true, true, "test", "ym-terms-v1", "ym-privacy-v1"));
    }

    private static VerifiedIdentity identity() {
        return new VerifiedIdentity(Provider.GOOGLE, UUID.randomUUID().toString(), "community@example.test", Instant.now().plusSeconds(300));
    }

    private static String nickname() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }
}
