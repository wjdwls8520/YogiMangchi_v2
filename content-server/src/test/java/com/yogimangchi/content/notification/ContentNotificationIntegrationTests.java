package com.yogimangchi.content.notification;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.support.TestEnvironment;
import com.yogimangchi.content.support.TestInfrastructure;
import java.time.Instant;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "content.oauth.enabled=false")
@AutoConfigureMockMvc
@Import(TestInfrastructure.class)
class ContentNotificationIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @Test
    void communityCommentsRepliesMentionsGroupedLikesFollowCooldownAndReadLifecycleMatchV1Spec() throws Exception {
        var author = signupWithPrefix("작성자");
        var commenterA = signupWithPrefix("댓글러A");
        var commenterB = signupWithPrefix("댓글러B");
        var mentionedUser = signupWithPrefix("멘션수신");

        String authorToken = "Bearer " + author.access().accessToken();
        String tokenA = "Bearer " + commenterA.access().accessToken();
        String tokenB = "Bearer " + commenterB.access().accessToken();
        String mentionedToken = "Bearer " + mentionedUser.access().accessToken();

        // 1. Author creates a post
        JsonNode createdPost = json.readTree(mvc.perform(post("/api/v1/community/posts")
                        .header("Authorization", authorToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "category": "FREE",
                                  "symbolTag": "BTC",
                                  "title": "비트코인 롱 관점 공유",
                                  "content": "오늘 지지선 테스트 중입니다."
                                }
                                """))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        long postId = createdPost.get("id").asLong();

        // Self-like and self-comment must NOT notify author
        mvc.perform(put("/api/v1/community/posts/" + postId + "/likes")
                        .header("Authorization", authorToken))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/community/posts/" + postId + "/comments")
                        .header("Authorization", authorToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"내 글에 내가 남긴 메모\"}"))
                .andExpect(status().isCreated());

        mvc.perform(get("/api/v1/notifications/status").header("Authorization", authorToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newCount").value(0))
                .andExpect(jsonPath("$.unreadCount").value(0));

        // 2. CommenterA writes a root comment mentioning @mentionedUser -> notifies post author (POST_COMMENT_CREATED) AND @mentionedUser (REPLY_COMMENT_CREATED)
        String mentionText = "좋은 분석 감사합니다 @" + mentionedUser.access().nickname() + " 님도 참고해보세요!";
        JsonNode rootComment = json.readTree(mvc.perform(post("/api/v1/community/posts/" + postId + "/comments")
                        .header("Authorization", tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(java.util.Map.of("content", mentionText))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        long rootCommentId = rootComment.get("id").asLong();

        mvc.perform(get("/api/v1/notifications").header("Authorization", authorToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].type").value("POST_COMMENT_CREATED"))
                .andExpect(jsonPath("$.content[0].payload.postId").value(postId))
                .andExpect(jsonPath("$.content[0].payload.replyId").value(rootCommentId));

        mvc.perform(get("/api/v1/notifications").header("Authorization", mentionedToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].type").value("REPLY_COMMENT_CREATED"))
                .andExpect(jsonPath("$.content[0].payload.mentioned").value(true))
                .andExpect(jsonPath("$.content[0].payload.targetNickname").value(mentionedUser.access().nickname()));

        // 3. CommenterB replies to CommenterA's root comment -> notifies CommenterA (REPLY_COMMENT_CREATED)
        mvc.perform(post("/api/v1/community/posts/" + postId + "/comments")
                        .header("Authorization", tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(java.util.Map.of(
                                "content", "저도 동의합니다!",
                                "parentCommentId", rootCommentId,
                                "targetCommentId", rootCommentId,
                                "targetMemberId", commenterA.access().memberId()))))
                .andExpect(status().isCreated());

        mvc.perform(get("/api/v1/notifications").header("Authorization", tokenA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].type").value("REPLY_COMMENT_CREATED"))
                .andExpect(jsonPath("$.content[0].payload.mentioned").value(true));

        // 4. Post Likes: CommenterA and CommenterB both like before author checks -> grouped into 1 POST_LIKED row (groupCount = 2)
        mvc.perform(put("/api/v1/community/posts/" + postId + "/likes").header("Authorization", tokenA))
                .andExpect(status().isOk());
        mvc.perform(put("/api/v1/community/posts/" + postId + "/likes").header("Authorization", tokenB))
                .andExpect(status().isOk());

        // Unlike + re-like by CommenterA must NOT duplicate or increment groupCount
        mvc.perform(delete("/api/v1/community/posts/" + postId + "/likes").header("Authorization", tokenA))
                .andExpect(status().isOk());
        mvc.perform(put("/api/v1/community/posts/" + postId + "/likes").header("Authorization", tokenA))
                .andExpect(status().isOk());

        JsonNode beforeCheckList = json.readTree(mvc.perform(get("/api/v1/notifications")
                        .header("Authorization", authorToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertThat(beforeCheckList.get("content").size()).isEqualTo(2); // 1 grouped POST_LIKED + 1 POST_COMMENT_CREATED
        assertThat(beforeCheckList.get("content").get(0).get("type").asText()).isEqualTo("POST_LIKED");
        assertThat(beforeCheckList.get("content").get(0).get("payload").get("groupCount").asLong()).isEqualTo(2L);

        // Author checks bell -> newCount becomes 0, unreadCount stays 2, and open like group closes!
        mvc.perform(put("/api/v1/notifications/check").header("Authorization", authorToken))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/notifications/status").header("Authorization", authorToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newCount").value(0))
                .andExpect(jsonPath("$.unreadCount").value(2));

        // MentionedUser likes post AFTER check -> creates a brand-new POST_LIKED group (groupCount = 1, total notifications = 3)
        mvc.perform(put("/api/v1/community/posts/" + postId + "/likes").header("Authorization", mentionedToken))
                .andExpect(status().isOk());
        JsonNode afterCheckList = json.readTree(mvc.perform(get("/api/v1/notifications")
                        .header("Authorization", authorToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertThat(afterCheckList.get("content").size()).isEqualTo(3);
        assertThat(afterCheckList.get("content").get(0).get("payload").get("groupCount").asLong()).isEqualTo(1L);

        // 5. Follow 1-day cooldown: CommenterA follows Author, unfollows, and immediately follows again -> only 1 FOLLOW_CREATED
        long authorId = author.access().memberId();
        mvc.perform(put("/api/v1/members/" + authorId + "/follows").header("Authorization", tokenA))
                .andExpect(status().isOk());
        mvc.perform(delete("/api/v1/members/" + authorId + "/follows").header("Authorization", tokenA))
                .andExpect(status().isOk());
        mvc.perform(put("/api/v1/members/" + authorId + "/follows").header("Authorization", tokenA))
                .andExpect(status().isOk());

        mvc.perform(get("/api/v1/notifications").param("category", "FOLLOW").header("Authorization", authorToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].type").value("FOLLOW_CREATED"));

        // 6. Read-all, check, and delete-read lifecycle
        mvc.perform(put("/api/v1/notifications/read-all").header("Authorization", authorToken))
                .andExpect(status().isNoContent());
        mvc.perform(put("/api/v1/notifications/check").header("Authorization", authorToken))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/notifications/status").header("Authorization", authorToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newCount").value(0))
                .andExpect(jsonPath("$.unreadCount").value(0));

        mvc.perform(delete("/api/v1/notifications/read").header("Authorization", authorToken))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/notifications").header("Authorization", authorToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));

        // SSE subscribe returns 200 OK
        mvc.perform(get("/api/v1/notifications/subscribe").header("Authorization", authorToken))
                .andExpect(status().isOk());
    }

    private AuthService.Issued signupWithPrefix(String prefix) {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 4);
        String nick = prefix + suffix;
        return auth.signup(
                new VerifiedIdentity(Provider.GOOGLE, UUID.randomUUID().toString(), nick + "@example.test", Instant.now().plusSeconds(300)),
                new SignupRequest(nick, true, true, "test", "ym-terms-v1", "ym-privacy-v1"));
    }
}
