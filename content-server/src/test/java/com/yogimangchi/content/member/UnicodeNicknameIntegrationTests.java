package com.yogimangchi.content.member;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.service.AuthService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.dto.UpdateProfileRequest;
import com.yogimangchi.content.member.entity.OAuthIdentity.Provider;
import com.yogimangchi.content.member.service.*;
import com.yogimangchi.content.member.validation.NicknamePolicy;
import com.yogimangchi.content.support.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="content.oauth.enabled=false") @AutoConfigureMockMvc @Import(TestInfrastructure.class)
class UnicodeNicknameIntegrationTests extends TestEnvironment {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired AuthService auth;
    @Autowired MemberProfiles profiles;
    @Autowired MemberFollows follows;
    @Autowired JdbcTemplate jdbc;

    @Test void unicodeNamesRoundTripThroughSignupAvailabilityProfileAndPostgres() throws Exception {
        String supplementary="\uD801\uDC00".repeat(8); // Eight Deseret letters, sixteen UTF-16 code units.
        assertThat(supplementary.length()).isEqualTo(16);
        for(String name:List.of("界","abcdefgh","가나다라마바사아","Москва","عرب١٢","Ⅷ½",supplementary)) {
            mvc.perform(get("/api/v1/members/nickname/availability").param("nickname",name))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.available").value(true));
            var identity=identity();
            var result=mvc.perform(post("/api/v1/auth/signup").session(proof(identity)).with(csrf()).contentType("application/json")
                    .content(json.writeValueAsString(new SignupRequest(name,true,true,"")))).andExpect(status().isOk())
                    .andExpect(jsonPath("$.nickname").value(name)).andReturn();
            var access=json.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
            Long memberId=access.path("memberId").longValue(); String bearer="Bearer "+access.path("accessToken").asText();
            mvc.perform(get("/api/v1/members/"+memberId)).andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value(name));
            mvc.perform(patch("/api/v1/members/me/profile").header("Authorization",bearer).contentType("application/json")
                    .content(json.writeValueAsString(new UpdateProfileRequest(name,"updated"))))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value(name));
            assertThat(jdbc.queryForObject("select char_length(nickname) from content.member where id=?",Integer.class,memberId))
                    .isEqualTo(name.codePointCount(0,name.length()));
            mvc.perform(get("/api/v1/members/nickname/availability").param("nickname",name))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.available").value(false));
            mvc.perform(post("/api/v1/auth/signup").session(proof(identity())).with(csrf()).contentType("application/json")
                    .content(json.writeValueAsString(new SignupRequest(name,true,true,"")))).andExpect(status().isConflict());
            var other=member();
            mvc.perform(patch("/api/v1/members/me/profile").header("Authorization","Bearer "+other.access().accessToken()).contentType("application/json")
                    .content(json.writeValueAsString(new UpdateProfileRequest(name,null))))
                    .andExpect(status().isConflict());
        }
        assertThat(jdbc.queryForObject("select character_maximum_length from information_schema.columns where table_schema='content' and table_name='member' and column_name='nickname'",Integer.class)).isEqualTo(12);
    }

    @Test void invalidInputIsRejectedConsistentlyByHttpAndServicesWithoutPartialWrites() throws Exception {
        var own=member(); long before=jdbc.queryForObject("select count(*) from content.member",Long.class);
        for(String name:List.of("","abcdefghi","\uD801\uDC00".repeat(9),"a b","a\n","a\t","a!","\uD83D\uDE00","a\u200B","a\u2060","a\uFEFF","a\u00A0")) {
            mvc.perform(get("/api/v1/members/nickname/availability").param("nickname",name)).andExpect(status().isBadRequest());
            mvc.perform(post("/api/v1/auth/signup").session(proof(identity())).with(csrf()).contentType("application/json")
                    .content(json.writeValueAsString(new SignupRequest(name,true,true,"")))).andExpect(status().isBadRequest());
            mvc.perform(patch("/api/v1/members/me/profile").header("Authorization","Bearer "+own.access().accessToken()).contentType("application/json")
                    .content(json.writeValueAsString(new UpdateProfileRequest(name,null)))).andExpect(status().isBadRequest());
            assertThatThrownBy(() -> auth.signup(identity(),new SignupRequest(name,true,true,""))).isInstanceOf(AuthFailure.class);
            assertThatThrownBy(() -> profiles.nicknameAvailable(name)).isInstanceOf(AuthFailure.class);
            assertThatThrownBy(() -> profiles.change(own.access().memberId(),new UpdateProfileRequest(name,null))).isInstanceOf(AuthFailure.class);
        }
        assertThat(jdbc.queryForObject("select count(*) from content.member",Long.class)).isEqualTo(before);
        assertThat(profiles.publicProfile(own.access().memberId()).nickname()).isEqualTo(own.access().nickname());
    }

    @Test void legacyNineToTwelveCharacterNamesRemainReadableLoginAndRefreshCapable() throws Exception {
        for(int length=9;length<=12;length++) {
            var identity=identity(); var own=auth.signup(identity,new SignupRequest(randomName(),true,true,"original"));
            String legacy="legacy"+"a".repeat(length-6);
            jdbc.update("update content.member set nickname=? where id=?",legacy,own.access().memberId());
            mvc.perform(get("/api/v1/members/"+own.access().memberId())).andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value(legacy));
            mvc.perform(get("/api/v1/members/me").header("Authorization","Bearer "+own.access().accessToken()))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value(legacy));
            mvc.perform(post("/api/v1/auth/login/complete").session(proof(identity)).with(csrf()))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value(legacy));
            assertThat(auth.refresh(own.refresh()).access().nickname()).isEqualTo(legacy);
            // Message-only PATCH must not reject or shorten the untouched old nickname.
            mvc.perform(patch("/api/v1/members/me/profile").header("Authorization","Bearer "+own.access().accessToken()).contentType("application/json")
                    .content("{\"profileMessage\":\"edited\"}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value(legacy));
            assertThat(jdbc.queryForObject("select nickname from content.member where id=?",String.class,own.access().memberId())).isEqualTo(legacy);
            // Explicit nickname input still follows the same new rule, even if equal to the old value.
            mvc.perform(patch("/api/v1/members/me/profile").header("Authorization","Bearer "+own.access().accessToken()).contentType("application/json")
                    .content(json.writeValueAsString(new UpdateProfileRequest(legacy,null)))).andExpect(status().isBadRequest());
            profiles.change(own.access().memberId(),new UpdateProfileRequest("新名"+length,null));
            assertThat(profiles.publicProfile(own.access().memberId()).nickname()).isEqualTo("新名"+length);
        }
    }

    @Test void followSearchSupportsSupplementaryNamesAndLegacyTwelveCharacterNames() throws Exception {
        var actor=member(); String name="\uD800\uDF48".repeat(8); // Gothic letters.
        var target=auth.signup(identity(),new SignupRequest(name,true,true,""));
        follows.change(actor.access().memberId(),target.access().memberId(),true);
        String endpoint="/api/v1/members/"+actor.access().memberId()+"/followings";
        mvc.perform(get(endpoint).param("keyword",name)).andExpect(status().isOk()).andExpect(jsonPath("$.content[0].nickname").value(name));
        jdbc.update("update content.member set nickname='LegacyName12' where id=?",target.access().memberId());
        mvc.perform(get(endpoint).param("keyword","LegacyName12")).andExpect(status().isOk()).andExpect(jsonPath("$.content[0].nickname").value("LegacyName12"));
    }

    @Test void runtimeOpenApiDescribesCodePointsAndMatchingUnicodePattern() throws Exception {
        var api=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
        for(String schema:List.of("SignupRequest","UpdateProfileRequest")) {
            var field=api.path("components").path("schemas").path(schema).path("properties").path("nickname");
            assertThat(field.path("pattern").asText()).isEqualTo(NicknamePolicy.REGEXP);
            assertThat(field.path("minLength").asInt()).isEqualTo(1);
            assertThat(field.path("maxLength").asInt()).isEqualTo(8);
            assertThat(field.path("description").asText()).contains("code point");
        }
    }
    private AuthService.Issued member() { return auth.signup(identity(),new SignupRequest(randomName(),true,true,"")); }
    private static String randomName() { return UUID.randomUUID().toString().replace("-","").substring(0,8); }
    private static VerifiedIdentity identity() { return new VerifiedIdentity(Provider.GOOGLE,UUID.randomUUID().toString(),"nickname@example.test",Instant.now().plusSeconds(300)); }
    private static MockHttpSession proof(VerifiedIdentity identity) { var session=new MockHttpSession(); session.setAttribute(VerifiedIdentity.SESSION_KEY,identity); return session; }
}
