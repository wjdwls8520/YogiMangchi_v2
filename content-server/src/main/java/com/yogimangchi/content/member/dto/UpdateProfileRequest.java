package com.yogimangchi.content.member.dto;

import jakarta.validation.constraints.*;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description="Update only provided non-null fields. Empty/whitespace profileMessage clears it; null preserves it. At least one field is required. Avatar upload is a separate pending capability.")
public record UpdateProfileRequest(@Pattern(regexp="[가-힣a-zA-Z0-9]{2,12}") String nickname,
        @Size(max=255) @Pattern(regexp="[^\\x00]*") String profileMessage) { }
