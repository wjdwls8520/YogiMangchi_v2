package com.yogimangchi.content.member.service;

import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.dto.*;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import com.yogimangchi.content.member.validation.NicknamePolicy;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class MemberProfiles {
    private final MemberRepository members;
    private final JdbcTemplate jdbc;
    private final CommunityS3Service s3;

    public MemberProfiles(MemberRepository members,JdbcTemplate jdbc,CommunityS3Service s3) {
        this.members=members;
        this.jdbc=jdbc;
        this.s3=s3;
    }

    @Transactional(readOnly=true,timeout=3)
    public PublicMemberProfileResponse publicProfile(Long id) {
        var member=members.findById(id).filter(m -> m.getStatus()==Member.Status.ACTIVE)
                .orElseThrow(() -> new AuthFailure("MEMBER_NOT_FOUND",HttpStatus.NOT_FOUND));
        return new PublicMemberProfileResponse(
                member.getId(),
                member.getNickname(),
                member.getProfileMessage(),
                s3.sanitizeProfileImageUrl(member.getProfileImgUrl()),
                member.getCreatedAt());
    }

    @Transactional(readOnly=true,timeout=3)
    public boolean nicknameAvailable(String nickname) {
        if(!NicknamePolicy.isValid(nickname)) throw new AuthFailure("INVALID_NICKNAME",HttpStatus.BAD_REQUEST);
        return !members.existsByNickname(nickname); // Includes retained names until an actual withdrawal renames them.
    }

    @Transactional(timeout=5)
    public MemberProfileResponse change(Long memberId,UpdateProfileRequest request) {
        return change(memberId,request,null,null);
    }

    @Transactional(timeout=5)
    public MemberProfileResponse change(Long memberId,UpdateProfileRequest request,MultipartFile profileImage,String imageActionType) {
        String reqNickname = request == null ? null : request.nickname();
        String reqMessage = request == null ? null : request.profileMessage();
        boolean resetRequested = (request != null && Boolean.TRUE.equals(request.resetProfileImage()))
                || (imageActionType != null && ("reset".equalsIgnoreCase(imageActionType.strip()) || "default".equalsIgnoreCase(imageActionType.strip())));
        boolean hasNewImage = profileImage != null && !profileImage.isEmpty();

        if(reqNickname == null && reqMessage == null && !resetRequested && !hasNewImage) {
            throw invalid();
        }
        if(reqNickname != null && !NicknamePolicy.isValid(reqNickname)) {
            throw invalid();
        }
        if(reqMessage != null && (reqMessage.length() > 255 || reqMessage.indexOf('\0') >= 0)) {
            throw invalid();
        }
        CommunityS3Service.UploadResult uploaded = null;
        if(hasNewImage) {
            s3.validateImageFile(profileImage);
            var previewMember = members.findById(memberId)
                    .filter(m -> m.getStatus() == Member.Status.ACTIVE)
                    .orElseThrow(AuthFailure::unauthorized);
            if(reqNickname != null && !reqNickname.equals(previewMember.getNickname()) && members.existsByNickname(reqNickname)) {
                throw new AuthFailure("NICKNAME_UNAVAILABLE",HttpStatus.CONFLICT);
            }
            if(reqMessage == null && previewMember.getProfileMessage().length() > 255) {
                throw new AuthFailure("PROFILE_MESSAGE_UPDATE_REQUIRED",HttpStatus.CONFLICT);
            }
            uploaded = s3.validateAndUploadProfileImage(profileImage);
        }

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        var member=members.lockById(memberId).filter(m -> m.getStatus()==Member.Status.ACTIVE).orElseThrow(AuthFailure::unauthorized);

        String nickname=reqNickname==null ? member.getNickname() : reqNickname;
        if(!nickname.equals(member.getNickname()) && members.existsByNickname(nickname))
            throw new AuthFailure("NICKNAME_UNAVAILABLE",HttpStatus.CONFLICT);

        String message=reqMessage==null ? member.getProfileMessage() : reqMessage.strip();
        // A retained signup-era message may exceed the new edit limit; do not silently truncate untouched history.
        if(reqMessage==null && message.length()>255)
            throw new AuthFailure("PROFILE_MESSAGE_UPDATE_REQUIRED",HttpStatus.CONFLICT);

        member.changeBasicProfile(reqNickname,message);

        String oldS3Key = member.getProfileImgS3Key();
        if(uploaded != null) {
            member.changeProfileImage(uploaded.url(),uploaded.key());
            if(oldS3Key != null && !oldS3Key.isBlank() && !oldS3Key.equals(uploaded.key())) {
                s3.registerAfterCommitDelete(List.of(oldS3Key),"PROFILE_IMAGE_REPLACED");
            }
        } else if(resetRequested) {
            member.changeProfileImage(null,null);
            if(oldS3Key != null && !oldS3Key.isBlank()) {
                s3.registerAfterCommitDelete(List.of(oldS3Key),"PROFILE_IMAGE_RESET");
            }
        }

        return new MemberProfileResponse(
                member.getId(),
                member.getNickname(),
                member.getProfileMessage(),
                s3.sanitizeProfileImageUrl(member.getProfileImgUrl()),
                member.getRole().name(),
                member.getCreatedAt());
    }

    private static AuthFailure invalid() { return new AuthFailure("INVALID_PROFILE",HttpStatus.BAD_REQUEST); }
}
