package com.yogimangchi.content.member;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.member.dto.UpdateProfileRequest;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.member.service.MemberProfiles;
import com.yogimangchi.content.support.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="content.oauth.enabled=false") @AutoConfigureMockMvc @Import(TestInfrastructure.class)
class MemberProfileIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired MemberProfiles profiles;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired JwtEncoder encoder;
    AuthService.Issued own,other;
    @BeforeEach void members() { own=member(); other=member(); }

    @Test void publicProfileExcludesPrivateIdentityAndMeStillRequiresBearer() throws Exception {
        mvc.perform(get("/api/v1/members/"+own.access().memberId())).andExpect(status().isOk())
                .andExpect(jsonPath("$.nickname").value(own.access().nickname())).andExpect(jsonPath("$.email").doesNotExist())
                .andExpect(jsonPath("$.role").doesNotExist()).andExpect(jsonPath("$.providerSubject").doesNotExist());
        mvc.perform(get("/api/v1/members/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/members/0")).andExpect(status().isNotFound());
        jdbc.update("update content.member set status='WITHDRAWN',withdrawn_at=now() where id=?",own.access().memberId());
        mvc.perform(get("/api/v1/members/"+own.access().memberId())).andExpect(status().isNotFound());
        mvc.perform(patch("/api/v1/members/me/profile").header("Authorization",bearer()).contentType("application/json").content("{\"profileMessage\":\"blocked\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test void publicNicknameCheckIsAdvisoryAndValidatesInput() throws Exception {
        mvc.perform(get("/api/v1/members/nickname/availability").param("nickname",own.access().nickname()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.available").value(false));
        mvc.perform(get("/api/v1/members/nickname/availability").param("nickname",nickname()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.available").value(true));
        mvc.perform(get("/api/v1/members/nickname/availability").param("nickname","x space")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/members/nickname/availability")).andExpect(status().isBadRequest());
    }

    @Test void partialChangesPreserveOtherFieldsAndCannotSelectAnotherMember() throws Exception {
        String name=nickname();
        mvc.perform(patch("/api/v1/members/me/profile").header("Authorization",bearer()).contentType("application/json")
                .content(json.writeValueAsString(Map.of("nickname",name,"memberId",other.access().memberId(),"role","ADMIN"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.memberId").value(own.access().memberId()))
                .andExpect(jsonPath("$.profileMessage").value("original")).andExpect(jsonPath("$.role").value("MEMBER"));
        mvc.perform(patch("/api/v1/members/me/profile").header("Authorization",bearer()).contentType("application/json").content("{\"profileMessage\":\"  changed  \"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value(name)).andExpect(jsonPath("$.profileMessage").value("changed"));
        mvc.perform(patch("/api/v1/members/me/profile").header("Authorization",bearer()).contentType("application/json").content("{\"profileMessage\":\"   \"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.profileMessage").value(""));
        assertThat(profiles.publicProfile(other.access().memberId()).nickname()).isEqualTo(other.access().nickname());
        mvc.perform(patch("/api/v1/members/"+other.access().memberId()).header("Authorization",bearer()).contentType("application/json").content("{\"nickname\":\"hijacked\"}"))
                .andExpect(status().isForbidden());
    }

    @Test void duplicateOrInvalidChangesDoNotModifyTheProfile() throws Exception {
        var before=profiles.publicProfile(own.access().memberId());
        mvc.perform(patch("/api/v1/members/me/profile").header("Authorization",bearer()).contentType("application/json")
                .content(json.writeValueAsString(Map.of("nickname",other.access().nickname(),"profileMessage","must roll back"))))
                .andExpect(status().isConflict());
        for(String body:List.of("{}","{\"nickname\":\"x space\"}",json.writeValueAsString(Map.of("profileMessage","x".repeat(256))),json.writeValueAsString(Map.of("profileMessage","\0"))))
            mvc.perform(patch("/api/v1/members/me/profile").header("Authorization",bearer()).contentType("application/json").content(body)).andExpect(status().isBadRequest());
        assertThat(profiles.publicProfile(own.access().memberId())).isEqualTo(before);
    }

    @Test void simultaneousPartialChangesPreserveBothCommittedFields() throws Exception {
        var start=new CountDownLatch(1); var pool=Executors.newFixedThreadPool(2); String name=nickname();
        try {
            var first=pool.submit(() -> { start.await(); return profiles.change(own.access().memberId(),new UpdateProfileRequest(name,null)); });
            var second=pool.submit(() -> { start.await(); return profiles.change(own.access().memberId(),new UpdateProfileRequest(null,"concurrent")); });
            start.countDown(); first.get(8,TimeUnit.SECONDS); second.get(8,TimeUnit.SECONDS);
            var actual=profiles.publicProfile(own.access().memberId());
            assertThat(actual.nickname()).isEqualTo(name); assertThat(actual.profileMessage()).isEqualTo("concurrent");
        } finally { start.countDown(); pool.shutdownNow(); }
    }

    @Test void docsAndCorsDescribePublicReadsAndPrivateBearerPatch() throws Exception {
        var api=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(api.path("paths").path("/api/v1/members/{memberId}").path("get").path("security").isEmpty()).isTrue();
        assertThat(api.path("paths").path("/api/v1/members/me/profile").path("patch").path("security").toString()).contains("memberBearer");
        mvc.perform(options("/api/v1/members/me/profile").header("Origin","https://app.test").header("Access-Control-Request-Method","PATCH")
                .header("Access-Control-Request-Headers","Authorization,Content-Type")).andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin","https://app.test"));
    }

    @Test void oversizedSignedSubjectIsRejectedInsteadOfCausingProfileServerError() throws Exception {
        var claims=JwtClaimsSet.builder().issuer("https://content.test").subject("9223372036854775808").audience(List.of("content"))
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).claim("token_use","access").build();
        String token=encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(),claims)).getTokenValue();
        mvc.perform(patch("/api/v1/members/me/profile").header("Authorization","Bearer "+token).contentType("application/json").content("{\"profileMessage\":\"test\"}"))
                .andExpect(status().isUnauthorized());
    }

    private AuthService.Issued member() {
        var id=new VerifiedIdentity(Provider.GOOGLE,UUID.randomUUID().toString(),"profile@example.test",Instant.now().plusSeconds(300));
        return auth.signup(id,new SignupRequest(nickname(),true,true,"original"));
    }
    private String bearer() { return "Bearer "+own.access().accessToken(); }
    private static String nickname() { return UUID.randomUUID().toString().replace("-","").substring(0,8); }
}
