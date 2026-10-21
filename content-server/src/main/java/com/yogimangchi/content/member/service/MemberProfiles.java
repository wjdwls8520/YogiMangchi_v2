package com.yogimangchi.content.member.service;

import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.dto.*;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MemberProfiles {
    private final MemberRepository members;
    private final JdbcTemplate jdbc;
    public MemberProfiles(MemberRepository members,JdbcTemplate jdbc) { this.members=members; this.jdbc=jdbc; }
    @Transactional(readOnly=true,timeout=3)
    public PublicMemberProfileResponse publicProfile(Long id) {
        var member=members.findById(id).filter(m -> m.getStatus()==Member.Status.ACTIVE)
                .orElseThrow(() -> new AuthFailure("MEMBER_NOT_FOUND",HttpStatus.NOT_FOUND));
        return new PublicMemberProfileResponse(member.getId(),member.getNickname(),member.getProfileMessage(),member.getCreatedAt());
    }
    @Transactional(readOnly=true,timeout=3)
    public boolean nicknameAvailable(String nickname) {
        if(!validNickname(nickname)) throw invalid();
        return !members.existsByNickname(nickname); // Includes retained names until an actual withdrawal renames them.
    }
    @Transactional(timeout=5)
    public MemberProfileResponse change(Long memberId,UpdateProfileRequest request) {
        if(request==null || request.nickname()==null && request.profileMessage()==null
                || request.nickname()!=null && !validNickname(request.nickname())
                || request.profileMessage()!=null && (request.profileMessage().length()>255 || request.profileMessage().indexOf('\0')>=0)) throw invalid();
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        var member=members.lockById(memberId).filter(m -> m.getStatus()==Member.Status.ACTIVE).orElseThrow(AuthFailure::unauthorized);
        String nickname=request.nickname()==null ? member.getNickname() : request.nickname();
        if(!nickname.equals(member.getNickname()) && members.existsByNickname(nickname))
            throw new AuthFailure("NICKNAME_UNAVAILABLE",HttpStatus.CONFLICT);
        String message=request.profileMessage()==null ? member.getProfileMessage() : request.profileMessage().strip();
        // A retained signup-era message may exceed the new edit limit; do not silently truncate untouched history.
        if(request.profileMessage()==null && message.length()>255)
            throw new AuthFailure("PROFILE_MESSAGE_UPDATE_REQUIRED",HttpStatus.CONFLICT);
        member.changeBasicProfile(nickname,message);
        return new MemberProfileResponse(member.getId(),member.getNickname(),member.getProfileMessage(),member.getRole().name(),member.getCreatedAt());
    }
    private static boolean validNickname(String value) { return value!=null && value.matches("[가-힣a-zA-Z0-9]{2,12}"); }
    private static AuthFailure invalid() { return new AuthFailure("INVALID_PROFILE",HttpStatus.BAD_REQUEST); }
}
