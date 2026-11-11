package com.yogimangchi.content.member.service;

import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.dto.MemberProfileResponse;
import com.yogimangchi.content.member.entity.Member;
import com.yogimangchi.content.member.repository.MemberRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MemberQueries {
    private final MemberRepository members;
    private final CommunityS3Service s3;
    public MemberQueries(MemberRepository members) { this(members, null); }
    @org.springframework.beans.factory.annotation.Autowired
    public MemberQueries(MemberRepository members, CommunityS3Service s3) { this.members=members; this.s3=s3; }
    @Transactional(readOnly=true,timeout=3)
    public MemberProfileResponse ownProfile(String subject) {
        Long id;
        try { id=Long.valueOf(subject); } catch(NumberFormatException failure) { throw AuthFailure.unauthorized(); }
        var member=members.findById(id).filter(m -> m.getStatus()==Member.Status.ACTIVE).orElseThrow(AuthFailure::unauthorized);
        String imgUrl = s3 == null ? member.getProfileImgUrl() : s3.sanitizeProfileImageUrl(member.getProfileImgUrl());
        return new MemberProfileResponse(member.getId(),member.getNickname(),member.getProfileMessage(),imgUrl,member.getRole().name(),member.getCreatedAt());
    }
}
