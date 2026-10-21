package com.yogimangchi.content.auth.dto;

import jakarta.validation.constraints.*;
import io.swagger.v3.oas.annotations.media.Schema;

public record SignupRequest(
        @Pattern(regexp="[가-힣a-zA-Z0-9]{2,12}") @NotNull String nickname,
        @AssertTrue boolean termAgree,@AssertTrue boolean privateAgree,
        @Size(max=300) @Schema(description="Optional; null becomes empty") String profileMessage) { }
