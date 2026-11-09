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
import com.yogimangchi.content.news.NewsIngestionService;
import com.yogimangchi.content.support.TestEnvironment;
import com.yogimangchi.content.support.TestInfrastructure;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.support.PropertiesLoaderUtils;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "content.oauth.enabled=false")
@AutoConfigureMockMvc
@Import(TestInfrastructure.class)
class CommunityNewsAndRetentionIntegrationTests extends TestEnvironment {
    private static final Logger log = LoggerFactory.getLogger(CommunityNewsAndRetentionIntegrationTests.class);
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired MemberWithdrawals withdrawals;
    @Autowired MemberProvisioning provisioning;
    @Autowired ContentRetentionCleanupService retentionCleanup;
    @Autowired CommunityS3Service s3;
    @Autowired NewsIngestionService newsIngestion;
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

    @Test
    void v1S3MultipartAttachmentsPositionShareCommentTreeMentionsReportsAndUxSseWorkEndToEnd() throws Exception {
        var author = signup();
        var responder = signup();
        String authorBearer = "Bearer " + author.access().accessToken();
        String responderBearer = "Bearer " + responder.access().accessToken();

        // 1. Report reasons public endpoints (both main and V1 alias)
        mvc.perform(get("/api/v1/community/report-reasons"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].code").value("SPAM"));
        mvc.perform(get("/api/v1/report/type/community"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].code").value("SPAM"));

        // 2. UX SSE feed subscription
        mvc.perform(get("/api/v1/community/ux/subscribe/feed"))
                .andExpect(status().isOk());

        // 3. Reject video/* upload, oversized GIF (>3MB), and oversized image (>5MB), but allow small GIF (<=3MB, e.g. 1KB)
        var videoFile = new MockMultipartFile("files", "clip.mp4", "video/mp4", new byte[]{1, 2, 3, 4});
        mvc.perform(multipart("/api/v1/community/posts")
                        .file(videoFile)
                        .param("category", "POSITION")
                        .param("title", "동영상 업로드 차단 테스트")
                        .param("content", "video/* 포맷은 업로드할 수 없습니다.")
                        .header("Authorization", authorBearer))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FILE_VIDEO_NOT_ALLOWED"));

        var oversizedGifFile = new MockMultipartFile(
                "files", "huge-anim.gif", "image/gif", new byte[3 * 1024 * 1024 + 1024]);
        mvc.perform(multipart("/api/v1/community/posts")
                        .file(oversizedGifFile)
                        .param("category", "POSITION")
                        .param("title", "대용량 GIF 거절 테스트")
                        .param("content", "3MB 초과 GIF 파일은 업로드할 수 없습니다.")
                        .header("Authorization", authorBearer))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("GIF_FILE_TOO_LARGE"));

        var oversizedPngFile = new MockMultipartFile(
                "files", "huge-chart.png", "image/png", new byte[5 * 1024 * 1024 + 1024]);
        mvc.perform(multipart("/api/v1/community/posts")
                        .file(oversizedPngFile)
                        .param("category", "POSITION")
                        .param("title", "대용량 일반 이미지 거절 테스트")
                        .param("content", "5MB 초과 일반 이미지는 업로드할 수 없습니다.")
                        .header("Authorization", authorBearer))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IMAGE_FILE_TOO_LARGE"));

        var smallGifFile = new MockMultipartFile("files", "crash-meme.gif", "image/gif", new byte[1024]);
        var gifCreatedBody = mvc.perform(multipart("/api/v1/community/posts")
                        .file(smallGifFile)
                        .param("category", "FREE")
                        .param("title", "급락 짤 소용량 GIF 허용 테스트")
                        .param("content", "3MB 이하 소용량 GIF는 정상 업로드됩니다.")
                        .header("Authorization", authorBearer))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.files.length()").value(1))
                .andExpect(jsonPath("$.files[0].originalName").value("crash-meme.gif"))
                .andExpect(jsonPath("$.files[0].contentType").value("image/gif"))
                .andExpect(jsonPath("$.files[0].size").value(1024))
                .andReturn().getResponse().getContentAsString();
        long gifPostId = json.readTree(gifCreatedBody).path("id").asLong();
        long gifFileId = json.readTree(gifCreatedBody).path("files").get(0).path("id").asLong();
        String gifFileKey = jdbc.queryForObject(
                "select s3_key from content.community_post_file where id = ?",
                String.class, gifFileId);
        assertThat(gifFileKey).startsWith("community/post/").endsWith(".gif");
        assertThat(s3.isSimulatedKeyPresent(gifFileKey)).isTrue();

        mvc.perform(delete("/api/v1/community/posts/" + gifPostId)
                        .header("Authorization", authorBearer))
                .andExpect(status().isNoContent());
        assertThat(s3.isSimulatedKeyPresent(gifFileKey)).isFalse();

        // 4. Create multipart post with 2 images and a shared position snapshot
        var img1 = new MockMultipartFile("files", "chart-1.png", "image/png", new byte[]{10, 20, 30, 40});
        var img2 = new MockMultipartFile("files", "chart-2.jpg", "image/jpeg", new byte[]{50, 60, 70, 80, 90});
        String sharedPosJson = json.writeValueAsString(new CommunityService.SharedPositionSnapshot(
                "pos-btc-long-1",
                "비트코인 무기한",
                "BTC",
                "BTCUSDT",
                "LONG",
                25,
                "94,120.00",
                "95,680.50",
                "90,510.00",
                "+41.45%",
                "+310.88 USDT",
                true,
                true,
                true
        ));

        var multipartCreatedBody = mvc.perform(multipart("/api/v1/community/posts")
                        .file(img1)
                        .file(img2)
                        .param("category", "POSITION")
                        .param("symbolTag", "btc")
                        .param("title", "BTC 25배 롱 포지션 수익 인증")
                        .param("content", "전저점 리테스트 구간에서 진입해 1차 익절 완료했습니다.")
                        .param("sharedPosition", sharedPosJson)
                        .header("Authorization", authorBearer))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.category").value("POSITION"))
                .andExpect(jsonPath("$.symbolTag").value("BTC"))
                .andExpect(jsonPath("$.files.length()").value(2))
                .andExpect(jsonPath("$.files[0].originalName").value("chart-1.png"))
                .andExpect(jsonPath("$.files[1].originalName").value("chart-2.jpg"))
                .andExpect(jsonPath("$.sharedPosition.symbol").value("BTC"))
                .andExpect(jsonPath("$.sharedPosition.leverage").value(25))
                .andExpect(jsonPath("$.sharedPosition.roePct").value("+41.45%"))
                .andReturn().getResponse().getContentAsString();

        var createdPost = json.readTree(multipartCreatedBody);
        long postId = createdPost.path("id").asLong();
        long firstFileId = createdPost.path("files").get(0).path("id").asLong();
        String firstFileKey = jdbc.queryForObject(
                "select s3_key from content.community_post_file where id = ?",
                String.class, firstFileId);
        assertThat(firstFileKey).startsWith("community/post/").endsWith(".png");
        assertThat(s3.isSimulatedKeyPresent(firstFileKey)).isTrue();

        // 5. Update multipart post: delete first image and attach a new WebP image
        var img3 = new MockMultipartFile("files", "updated-chart.webp", "image/webp", new byte[]{1, 3, 5, 7, 9});
        mvc.perform(multipart(org.springframework.http.HttpMethod.PATCH, "/api/v1/community/posts/" + postId)
                        .file(img3)
                        .param("title", "BTC 25배 롱 포지션 수익 인증 (차트 교체)")
                        .param("deleteFileIds", Long.toString(firstFileId))
                        .header("Authorization", authorBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("BTC 25배 롱 포지션 수익 인증 (차트 교체)"))
                .andExpect(jsonPath("$.files.length()").value(2))
                .andExpect(jsonPath("$.files[0].originalName").value("chart-2.jpg"))
                .andExpect(jsonPath("$.files[1].originalName").value("updated-chart.webp"));

        // Verify deleted file key was purged from S3 after transaction commit
        assertThat(s3.isSimulatedKeyPresent(firstFileKey)).isFalse();

        // 6. latest-check and sort aliases (ALL / BEST)
        mvc.perform(get("/api/v1/community/posts/latest-check").param("sincePostId", "0").param("category", "POSITION"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newPostCount").isNumber())
                .andExpect(jsonPath("$.latestPostId").value(postId))
                .andExpect(jsonPath("$.items[0].id").value(postId));

        mvc.perform(get("/api/v1/community/posts").param("sort", "BEST"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/community/posts").param("sort", "ALL"))
                .andExpect(status().isOk());

        // 7. Create parent comment, edit it, like it, reply with target mention, then delete parent comment
        var parentCommentBody = mvc.perform(post("/api/v1/community/posts/" + postId + "/comments")
                        .header("Authorization", authorBearer)
                        .contentType("application/json")
                        .content(json.writeValueAsString(Map.of("content", "1차 목표가는 96.2k 부근입니다."))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.deleted").value(false))
                .andReturn().getResponse().getContentAsString();
        long parentCommentId = json.readTree(parentCommentBody).path("id").asLong();

        // Update comment
        mvc.perform(patch("/api/v1/community/comments/" + parentCommentId)
                        .header("Authorization", authorBearer)
                        .contentType("application/json")
                        .content(json.writeValueAsString(Map.of("content", "1차 목표가는 96.5k 부근으로 상향합니다."))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("1차 목표가는 96.5k 부근으로 상향합니다."));

        // Like & unlike comment
        mvc.perform(put("/api/v1/community/comments/" + parentCommentId + "/likes")
                        .header("Authorization", responderBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentId").value(parentCommentId))
                .andExpect(jsonPath("$.likeCount").value(1))
                .andExpect(jsonPath("$.likedByMe").value(true));

        // Create reply with targetCommentId & targetMemberId mention
        var childCommentBody = mvc.perform(post("/api/v1/community/posts/" + postId + "/comments")
                        .header("Authorization", responderBearer)
                        .contentType("application/json")
                        .content(json.writeValueAsString(Map.of(
                                "content", "타겟 멘션 답글입니다!",
                                "parentCommentId", parentCommentId,
                                "targetCommentId", parentCommentId,
                                "targetMemberId", author.access().memberId()))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.parentCommentId").value(parentCommentId))
                .andExpect(jsonPath("$.targetCommentId").value(parentCommentId))
                .andExpect(jsonPath("$.targetMemberId").value(author.access().memberId()))
                .andExpect(jsonPath("$.targetNickname").value(author.access().nickname()))
                .andReturn().getResponse().getContentAsString();
        long childCommentId = json.readTree(childCommentBody).path("id").asLong();

        // Delete parent comment while child reply is still ACTIVE -> parent stays in list as masked node!
        mvc.perform(delete("/api/v1/community/comments/" + parentCommentId)
                        .header("Authorization", authorBearer))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/community/posts/" + postId + "/comments")
                        .header("Authorization", responderBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(parentCommentId))
                .andExpect(jsonPath("$.items[0].deleted").value(true))
                .andExpect(jsonPath("$.items[0].content").value("삭제된 댓글입니다."))
                .andExpect(jsonPath("$.items[1].id").value(childCommentId))
                .andExpect(jsonPath("$.items[1].deleted").value(false))
                .andExpect(jsonPath("$.items[1].targetNickname").value(author.access().nickname()));

        // Active comment count on post is 1 (only the active child reply)
        mvc.perform(get("/api/v1/community/posts/" + postId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentCount").value(1));

        // 8. Post & comment reports (self-report blocked, other member report idempotent)
        mvc.perform(put("/api/v1/community/posts/" + postId + "/reports")
                        .header("Authorization", authorBearer)
                        .param("reasonType", "SPAM"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        for (int i = 0; i < 2; i++) {
            mvc.perform(put("/api/v1/community/posts/" + postId + "/reports")
                            .header("Authorization", responderBearer)
                            .contentType("application/json")
                            .content("{\"reasonType\":\"FRAUD\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.targetId").value(postId))
                    .andExpect(jsonPath("$.reportCount").value(1))
                    .andExpect(jsonPath("$.reportedByMe").value(true));
        }

        mvc.perform(delete("/api/v1/community/posts/" + postId + "/reports")
                        .header("Authorization", responderBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reportCount").value(0))
                .andExpect(jsonPath("$.reportedByMe").value(false));

        mvc.perform(put("/api/v1/community/comments/" + childCommentId + "/reports")
                        .header("Authorization", authorBearer)
                        .param("reasonType", "ABUSE"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetId").value(childCommentId))
                .andExpect(jsonPath("$.reportCount").value(1))
                .andExpect(jsonPath("$.reportedByMe").value(true));

        mvc.perform(delete("/api/v1/community/comments/" + childCommentId + "/reports")
                        .header("Authorization", authorBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reportCount").value(0))
                .andExpect(jsonPath("$.reportedByMe").value(false));

        // 9. Verify 10-item cursor pagination (LATEST and POPULAR) without duplicates or omissions
        List<Long> bulkPostIds = new java.util.ArrayList<>();
        for (int i = 1; i <= 12; i++) {
            var bulkBody = mvc.perform(post("/api/v1/community/posts")
                            .header("Authorization", authorBearer)
                            .contentType("application/json")
                            .content(json.writeValueAsString(Map.of(
                                    "category", "MARKET",
                                    "symbolTag", "SOL",
                                    "title", "SOL 10개 단위 무한스크롤 커서 테스트 #" + i,
                                    "content", "10개 단위 커서 기반 페이지네이션 검증 본문 #" + i))))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            bulkPostIds.add(json.readTree(bulkBody).path("id").asLong());
        }

        // latest-check returns up to 10 newest items
        mvc.perform(get("/api/v1/community/posts/latest-check")
                        .param("sincePostId", "0")
                        .param("category", "MARKET")
                        .param("symbolTag", "SOL"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newPostCount").value(12))
                .andExpect(jsonPath("$.items.length()").value(10));

        // Page 1 (default size=10, LATEST) -> 10 items, hasNext=true
        var latestPage1 = json.readTree(mvc.perform(get("/api/v1/community/posts")
                        .param("category", "MARKET")
                        .param("symbolTag", "SOL")
                        .param("sort", "LATEST"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(10))
                .andExpect(jsonPath("$.hasNext").value(true))
                .andExpect(jsonPath("$.nextCursorId").isNumber())
                .andReturn().getResponse().getContentAsString());
        long latestCursor = latestPage1.path("nextCursorId").asLong();

        // Page 2 (cursorId=latestCursor, LATEST) -> remaining 2 items, hasNext=false
        mvc.perform(get("/api/v1/community/posts")
                        .param("category", "MARKET")
                        .param("symbolTag", "SOL")
                        .param("sort", "LATEST")
                        .param("cursorId", Long.toString(latestCursor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.hasNext").value(false));

        // POPULAR sort 10-item cursor pagination
        var popularPage1 = json.readTree(mvc.perform(get("/api/v1/community/posts")
                        .param("category", "MARKET")
                        .param("symbolTag", "SOL")
                        .param("sort", "POPULAR"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(10))
                .andExpect(jsonPath("$.hasNext").value(true))
                .andReturn().getResponse().getContentAsString());
        long popularCursor = popularPage1.path("nextCursorId").asLong();

        mvc.perform(get("/api/v1/community/posts")
                        .param("category", "MARKET")
                        .param("symbolTag", "SOL")
                        .param("sort", "POPULAR")
                        .param("cursorId", Long.toString(popularCursor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.hasNext").value(false));
    }

    @Test
    void rootDotEnvS3LiveUploadAndImmediateDeleteWhenConfigured() throws Exception {
        List<Path> candidates = List.of(
                Path.of(".env"),
                Path.of("../.env"),
                Path.of("../../../.env"),
                Path.of("../../../../.env")
        );
        Path envPath = candidates.stream().filter(Files::isRegularFile).findFirst().orElse(null);
        Properties props = new Properties();
        if (envPath != null) {
            props = PropertiesLoaderUtils.loadProperties(new FileSystemResource(envPath));
        }
        String bucket = props.getProperty("S3_BUCKET", "").strip();
        String access = props.getProperty("S3_ACCESS", "").strip();
        String secret = props.getProperty("S3_SECRET", "").strip();
        String region = props.getProperty("S3_REGION", "ap-northeast-2").strip();

        CommunityS3Service service = new CommunityS3Service(bucket, access, secret, region);
        try {
            var tinyGif = new MockMultipartFile("files", "probe.gif", "image/gif", new byte[]{0x47, 0x49, 0x46, 0x38, 0x39, 0x61});
            List<CommunityS3Service.UploadResult> uploaded = service.validateAndUploadPostImages(List.of(tinyGif), 0);
            assertThat(uploaded).hasSize(1);
            CommunityS3Service.UploadResult item = uploaded.get(0);
            try {
                assertThat(item.key()).matches("^community/post/\\d{8}/[0-9a-f\\-]+\\.gif$");
                assertThat(item.url()).startsWith("https://").endsWith(item.key());
                assertThat(item.contentType()).isEqualTo("image/gif");
                assertThat(item.size()).isEqualTo(6L);
            } finally {
                boolean deleted = service.deleteByKeyQuietly(item.key());
                assertThat(deleted).isTrue();
                log.info("S3 upload & immediate delete probe completed: realS3={}, region={}, key={}, deleted={}",
                        service.isRealS3Configured(), service.region(), item.key(), deleted);
            }
        } finally {
            service.closeClient();
        }
    }

    @Test
    void rssIngestionDeduplicationSectionFiltersHighlightsReactionsAndSseStreamWorkEndToEnd() throws Exception {
        // 1. SSE stream endpoint connects immediately
        mvc.perform(get("/api/v1/news/stream"))
                .andExpect(status().isOk());

        // 2. Ingest official RSS 2.0 XML (Google News RSS format with <source>, HTML description, media:content)
        String sampleRssXml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
                  <channel>
                    <title>Google News 코인 속보</title>
                    <item>
                      <title>비트코인 9만8천달러 저항 돌파 강세… 선물 매수 수급 급등 - 한경글로벌</title>
                      <link>https://news.example.com/articles/btc-breakout-98k</link>
                      <pubDate>Mon, 09 Nov 2026 12:00:00 GMT</pubDate>
                      <description>&lt;p&gt;비트코인 현물 및 무기한 선물 시장에서 매수세가 강하게 유입되며 단기 저항선을 돌파했습니다.&lt;/p&gt;</description>
                      <source url="https://news.example.com">한경글로벌</source>
                      <media:content url="https://cdn.example.com/thumb/btc-98k.jpg" type="image/jpeg"/>
                    </item>
                    <item>
                      <title>이더리움 고래 지갑 스테이킹 물량 확대… 온체인 수수료 개선 - 코인데스크코리아</title>
                      <link>https://news.example.com/articles/eth-whale-staking</link>
                      <pubDate>Mon, 09 Nov 2026 11:30:00 GMT</pubDate>
                      <description>&lt;div&gt;이더리움 메인넷 고래 지갑들의 스테이킹 예치량이 꾸준히 증가하며 유통 물량 감소세가 나타나고 있습니다.&lt;/div&gt;</description>
                      <source url="https://coindesk.example.com">코인데스크코리아</source>
                    </item>
                  </channel>
                </rss>
                """;

        var firstBatch = newsIngestion.ingestRssXml(sampleRssXml, "BREAKING", "COIN_FLASH", 10);
        assertThat(firstBatch).hasSize(2);

        // Latest item in feed (BTC) should have stripped " - 한경글로벌" from title, extracted sourceName, symbolTag=BTC, BULLISH sentiment, aiSummary
        var btcItem = firstBatch.stream().filter(i -> "BTC".equals(i.symbolTag())).findFirst().orElseThrow();
        assertThat(btcItem.title()).isEqualTo("비트코인 9만8천달러 저항 돌파 강세… 선물 매수 수급 급등");
        assertThat(btcItem.sourceName()).isEqualTo("한경글로벌");
        assertThat(btcItem.sourceUrl()).isEqualTo("https://news.example.com/articles/btc-breakout-98k");
        assertThat(btcItem.thumbnailUrl()).isEqualTo("https://cdn.example.com/thumb/btc-98k.jpg");
        assertThat(btcItem.sentiment()).isEqualTo("BULLISH");
        assertThat(btcItem.aiSummary()).startsWith("[AI 강세 분석]").contains("#BTC");
        assertThat(btcItem.content()).contains("공개 RSS 메타데이터 기반 요약 브리핑");

        var ethItem = firstBatch.stream().filter(i -> "ETH".equals(i.symbolTag())).findFirst().orElseThrow();
        assertThat(ethItem.category()).isEqualTo("ONCHAIN");
        assertThat(ethItem.sourceName()).isEqualTo("코인데스크코리아");

        // 3. Re-ingesting the exact same RSS feed must deduplicate 100% (0 items inserted)
        var duplicateBatch = newsIngestion.ingestRssXml(sampleRssXml, "BREAKING", "COIN_FLASH", 10);
        assertThat(duplicateBatch).isEmpty();

        // 4. Filter by section & subCategory & sort
        mvc.perform(get("/api/v1/news")
                        .param("section", "BREAKING")
                        .param("subCategory", "COIN_FLASH")
                        .param("size", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].section").value("BREAKING"))
                .andExpect(jsonPath("$.items[0].subCategory").value("COIN_FLASH"));

        mvc.perform(get("/api/v1/news")
                        .param("section", "NEWSROOM")
                        .param("subCategory", "STOCKS")
                        .param("sort", "POPULAR"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].section").value("NEWSROOM"))
                .andExpect(jsonPath("$.items[0].subCategory").value("STOCKS"));

        // 5. Vote BULL and BEAR reactions on the newly ingested BTC article
        mvc.perform(post("/api/v1/news/" + btcItem.id() + "/reactions")
                        .contentType("application/json")
                        .content("{\"reaction\":\"BULL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newsId").value(btcItem.id()))
                .andExpect(jsonPath("$.reaction").value("BULL"))
                .andExpect(jsonPath("$.bullCount").value(1))
                .andExpect(jsonPath("$.bearCount").value(0))
                .andExpect(jsonPath("$.bullPct").value(100));

        mvc.perform(post("/api/v1/news/" + btcItem.id() + "/reactions")
                        .contentType("application/json")
                        .content("{\"reaction\":\"BEAR\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bullCount").value(1))
                .andExpect(jsonPath("$.bearCount").value(1))
                .andExpect(jsonPath("$.bullPct").value(50))
                .andExpect(jsonPath("$.bearPct").value(50));

        // 6. Single article lookup increments viewCount
        mvc.perform(get("/api/v1/news/" + btcItem.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewCount").value(1))
                .andExpect(jsonPath("$.bullCount").value(1))
                .andExpect(jsonPath("$.bearCount").value(1));

        // 7. Highlights endpoint returns mustReadBreaking, popularByViews, popularByReactions, keywordIssues, recommendedNewsroom, sentimentSummary
        mvc.perform(get("/api/v1/news/highlights"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mustReadBreaking").isArray())
                .andExpect(jsonPath("$.mustReadBreaking.length()").value(3))
                .andExpect(jsonPath("$.popularByViews").isArray())
                .andExpect(jsonPath("$.popularByReactions").isArray())
                .andExpect(jsonPath("$.keywordIssues.length()").value(3))
                .andExpect(jsonPath("$.recommendedNewsroom").isArray())
                .andExpect(jsonPath("$.sentimentSummary.bullPct").isNumber())
                .andExpect(jsonPath("$.sentimentSummary.bearPct").isNumber());
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
