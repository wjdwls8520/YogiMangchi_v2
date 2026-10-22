package com.yogimangchi.content.auth.service;

import com.yogimangchi.content.auth.dto.*;
import com.yogimangchi.content.auth.entity.RefreshSession;
import com.yogimangchi.content.auth.repository.RefreshSessionRepository;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.*;
import com.yogimangchi.content.member.repository.*;
import com.yogimangchi.content.member.validation.NicknamePolicy;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private final MemberRepository members;
    private final OAuthIdentityRepository identities;
    private final RefreshSessionRepository sessions;
    private final AccessTokens access;
    public AuthService(MemberRepository members,OAuthIdentityRepository identities,RefreshSessionRepository sessions,AccessTokens access) {
        this.members=members; this.identities=identities; this.sessions=sessions; this.access=access;
    }
    /** Internal handoff only; never serialize this wrapper (it contains the raw refresh token). */
    public record Issued(AccessResponse access,String refresh,Instant refreshExpiresAt) { }
    public record Flow(String status,String provider,String email) { }
    @Transactional(readOnly=true,timeout=3)
    public Flow flow(VerifiedIdentity identity) {
        identity.requireFresh();
        var existing=identities.findByProviderAndProviderSubject(identity.provider(),identity.subject());
        existing.ifPresent(i -> active(i.getMemberId()));
        return new Flow(existing.isPresent() ? "LOGIN_READY" : "SIGNUP_REQUIRED",identity.provider().name(),identity.email());
    }
    @Transactional(timeout=5)
    public Issued signup(VerifiedIdentity identity,SignupRequest request) {
        identity.requireFresh();
        if(request==null || !request.termAgree() || !request.privateAgree() || !NicknamePolicy.isValid(request.nickname())
                || request.profileMessage()!=null && (request.profileMessage().length()>255 || request.profileMessage().indexOf('\0')>=0)) throw new AuthFailure("INVALID_REQUEST",HttpStatus.BAD_REQUEST);
        if(identities.findByProviderAndProviderSubject(identity.provider(),identity.subject()).isPresent() || members.existsByNickname(request.nickname()))
            throw new AuthFailure("MEMBER_ALREADY_EXISTS",HttpStatus.CONFLICT);
        Instant now=now();
        var member=members.save(Member.signup(request.nickname(),request.profileMessage()==null ? "" : request.profileMessage(),now));
        identities.save(OAuthIdentity.link(member.getId(),identity.provider(),identity.subject(),identity.email()));
        return issue(member,UUID.randomUUID(),now,now.plus(Duration.ofDays(7)));
    }
    @Transactional(timeout=5)
    public Issued completeLogin(VerifiedIdentity identity) {
        identity.requireFresh();
        var link=identities.findByProviderAndProviderSubject(identity.provider(),identity.subject()).orElseThrow(AuthFailure::unauthorized);
        Instant now=now(); return issue(active(link.getMemberId()),UUID.randomUUID(),now,now.plus(Duration.ofDays(7)));
    }
    @Transactional(timeout=5,noRollbackFor=AuthFailure.class)
    public Issued refresh(String token) {
        if(!RefreshTokens.valid(token)) throw AuthFailure.unauthorized();
        var old=sessions.lockByHash(RefreshTokens.hash(token)).orElseThrow(AuthFailure::unauthorized);
        Instant now=now();
        if(old.getStatus()!=RefreshSession.Status.ACTIVE || !old.getExpiresAt().isAfter(now)) {
            sessions.revokeFamily(old.getFamilyId(),now); // Commit theft detection even though the HTTP response is 401.
            throw AuthFailure.unauthorized();
        }
        Member member;
        try { member=active(old.getMemberId()); }
        catch(AuthFailure failure) { sessions.revokeFamily(old.getFamilyId(),now); throw failure; }
        old.rotate(now);
        return issue(member,old.getFamilyId(),now,old.getExpiresAt()); // Fixed 7-day lifetime, no unlimited sliding session.
    }
    @Transactional(timeout=5)
    public void logout(String token) {
        if(!RefreshTokens.valid(token)) return;
        sessions.lockByHash(RefreshTokens.hash(token)).ifPresent(s -> sessions.revokeFamily(s.getFamilyId(),Instant.now()));
    }
    private Issued issue(Member member,UUID family,Instant now,Instant expiry) {
        String refresh=RefreshTokens.issue();
        sessions.save(RefreshSession.issue(family,member.getId(),RefreshTokens.hash(refresh),now,expiry));
        return new Issued(access.issue(member,now),refresh,expiry);
    }
    private Member active(Long id) {
        return members.findById(id).filter(m -> m.getStatus()==Member.Status.ACTIVE).orElseThrow(AuthFailure::unauthorized);
    }
    private static Instant now() { return Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS); }
}
