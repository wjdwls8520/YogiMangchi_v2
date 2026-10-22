package com.yogimangchi.content.auth.dto;

import jakarta.validation.constraints.*;
import io.swagger.v3.oas.annotations.media.Schema;
import com.yogimangchi.content.member.validation.NicknamePolicy;

public record SignupRequest(
        @Pattern(regexp=NicknamePolicy.REGEXP) @NotNull
        @Schema(pattern=NicknamePolicy.REGEXP,minLength=1,maxLength=8,description="1-8 Unicode code points in Letter/Number categories (L/N). JavaScript validation requires the Unicode u flag. No spaces, punctuation, emoji, controls or invisible separators; no automatic normalization/truncation.") String nickname,
        @AssertTrue boolean termAgree,@AssertTrue boolean privateAgree,
        @Size(max=255) @Pattern(regexp="[^\\x00]*") @Schema(description="Optional; null becomes empty. Maximum255 characters, matching V1 profile policy.") String profileMessage) { }
