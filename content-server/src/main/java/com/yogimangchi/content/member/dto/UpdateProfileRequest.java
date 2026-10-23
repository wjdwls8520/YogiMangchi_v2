package com.yogimangchi.content.member.dto;

import jakarta.validation.constraints.*;
import io.swagger.v3.oas.annotations.media.Schema;
import com.yogimangchi.content.member.validation.NicknamePolicy;

@Schema(description="Update only provided non-null fields. Empty/whitespace profileMessage clears it; null preserves it. At least one field is required. Avatar upload is a separate pending capability.")
public record UpdateProfileRequest(@Pattern(regexp=NicknamePolicy.REGEXP)
        @Schema(pattern=NicknamePolicy.REGEXP,minLength=1,maxLength=8,description="If provided,1-8 Unicode Letter/Number code points (L/N; JavaScript u flag). Null/omitted keeps the existing nickname, including legacy9-12-character values. No automatic trimming/normalization.") String nickname,
        @Size(max=255) @Pattern(regexp="[^\\x00]*") String profileMessage) { }
