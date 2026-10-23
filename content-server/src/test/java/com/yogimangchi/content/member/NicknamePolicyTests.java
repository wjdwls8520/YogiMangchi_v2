package com.yogimangchi.content.member;

import com.yogimangchi.content.auth.dto.SignupRequest;
import com.yogimangchi.content.member.dto.UpdateProfileRequest;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.validation.NicknamePolicy;
import jakarta.validation.*;
import java.time.Instant;
import java.util.stream.Stream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import static org.assertj.core.api.Assertions.*;

class NicknamePolicyTests {
    static ValidatorFactory factory;
    static Validator validator;
    @BeforeAll static void validation() { factory=Validation.buildDefaultValidatorFactory(); validator=factory.getValidator(); }
    @AfterAll static void close() { factory.close(); }
    static Stream<String> accepted() {
        return Stream.of("a","가","字","abcdefgh","가나다라마바사아","Émile","Москва","العربية","東京123","Ⅷ½",
                "\uD801\uDC00","\uD835\uDFD8","\uD801\uDC00".repeat(8));
    }
    static Stream<String> rejected() {
        return Stream.of("","abcdefghi","가".repeat(9),"\uD801\uDC00".repeat(9)," a","a ","a b","a\t","a\n","a\r","a\0","a-b","a_b","!",
                "\uD83D\uDE00","\uD83C\uDDF0\uD83C\uDDF7","1\uFE0F\u20E3","a\u200B","a\u200D","a\u2060","a\uFEFF","a\u00A0","a\u2028","a\u202E","e\u0301","\uD801","\uDC00");
    }
    @ParameterizedTest(name="accepted {index}") @MethodSource("accepted")
    void allCreationAndEditBoundariesAcceptUnicodeLettersAndNumbers(String name) {
        assertThat(NicknamePolicy.isValid(name)).isTrue();
        assertThat(validator.validate(new SignupRequest(name,true,true,"","ym-terms-v1","ym-privacy-v1"))).isEmpty();
        assertThat(validator.validate(new UpdateProfileRequest(name,null))).isEmpty();
        var member=Member.signup(name,"",Instant.now());
        member.changeBasicProfile(name,"edited");
        assertThat(member.getNickname()).isEqualTo(name);
    }
    @ParameterizedTest(name="rejected {index}") @MethodSource("rejected")
    void allCreationAndEditBoundariesRejectInvalidNames(String name) {
        assertThat(NicknamePolicy.isValid(name)).isFalse();
        assertThat(validator.validate(new SignupRequest(name,true,true,"","ym-terms-v1","ym-privacy-v1"))).isNotEmpty();
        assertThat(validator.validate(new UpdateProfileRequest(name,null))).isNotEmpty();
        assertThatIllegalArgumentException().isThrownBy(() -> Member.signup(name,"",Instant.now()));
        var member=Member.signup("valid","",Instant.now());
        assertThatIllegalArgumentException().isThrownBy(() -> member.changeBasicProfile(name,"edited"));
        assertThat(member.getNickname()).isEqualTo("valid");
    }
    @Test void signupRequiresNameWhileProfileOmissionKeepsIt() {
        assertThat(NicknamePolicy.isValid(null)).isFalse();
        assertThat(validator.validate(new SignupRequest(null,true,true,"","ym-terms-v1","ym-privacy-v1"))).isNotEmpty();
        assertThat(validator.validate(new UpdateProfileRequest(null,"edited"))).isEmpty();
        var member=Member.signup("가","",Instant.now()); member.changeBasicProfile(null,"edited");
        assertThat(member.getNickname()).isEqualTo("가");
    }
}
