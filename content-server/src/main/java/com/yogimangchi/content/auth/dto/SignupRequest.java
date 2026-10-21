package com.yogimangchi.content.auth.dto;

import jakarta.validation.constraints.*;
import io.swagger.v3.oas.annotations.media.Schema;

public record SignupRequest(
        @Pattern(regexp="[가-힣a-zA-Z0-9]{2,12}") @NotNull String nickname,
        @AssertTrue boolean termAgree,@AssertTrue boolean privateAgree,
        @Size(max=255) @Pattern(regexp="[^\\x00]*") @Schema(description="Optional; null becomes empty. Maximum255 characters, matching V1 profile policy.") String profileMessage) { }
