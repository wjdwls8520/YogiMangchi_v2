package com.yogimangchi.content.auth.service;

import com.yogimangchi.content.auth.dto.*;
import com.yogimangchi.content.auth.entity.RefreshSession;
import com.yogimangchi.content.auth.oauth.VerifiedIdentity;
import com.yogimangchi.content.auth.repository.RefreshSessionRepository;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.entity.*;
import com.yogimangchi.content.member.repository.*;
import com.yogimangchi.content.member.validation.NicknamePolicy;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private final MemberRepository members;
    private final OAuthIdentityRepository identities;
    private final RefreshSessionRepository sessions;
    private final com.yogimangchi.content.member.service.MemberProvisioning provisioning;
    private final AccessTokens access;
    private final com.yogimangchi.content.consent.PolicyConsents consents;
    private final JdbcTemplate jdbc;

    public AuthService(
            MemberRepository members,
            OAuthIdentityRepository identities,
            RefreshSessionRepository sessions,
            AccessTokens access,
            com.yogimangchi.content.consent.PolicyConsents consents,
            com.yogimangchi.content.member.service.MemberProvisioning provisioning,
            JdbcTemplate jdbc) {
        this.members = members;
        this.identities = identities;
        this.sessions = sessions;
        this.access = access;
        this.consents = consents;
        this.provisioning = provisioning;
        this.jdbc = jdbc;
    }

    /** Internal handoff only; never serialize this wrapper (it contains the raw refresh token). */
    public record Issued(AccessResponse access, String refresh, Instant refreshExpiresAt) { }

    public record Flow(String status, String provider, String email, String accountStatus, String suspensionReason) {
        public Flow(String status, String provider, String email) {
            this(status, provider, email, null, null);
        }
    }

    @Transactional(readOnly = true, timeout = 10)
    public Flow flow(VerifiedIdentity identity) {
        identity.requireFresh();
        ensureNotBanned(identity);
        var existing = identities.findByProviderAndProviderSubject(identity.provider(), identity.subject());
        if (existing.isPresent()) {
            var member = members.findById(existing.get().getMemberId()).orElseThrow(AuthFailure::unauthorized);
            if (member.getStatus() == Member.Status.WITHDRAWING) {
                return new Flow("WITHDRAWAL_PENDING", identity.provider().name(), identity.email(), "WITHDRAWING", null);
            }
            if (member.getStatus() == Member.Status.BANNED) {
                throw new AuthFailure("MEMBER_BANNED", HttpStatus.FORBIDDEN);
            }
            if (member.getStatus() == Member.Status.SUSPENDED) {
                // Suspended members may authenticate into a restricted appeal/withdrawal-only session.
                return new Flow("LOGIN_READY", identity.provider().name(), identity.email(), "SUSPENDED", member.getSuspendedReason());
            }
            if (member.getStatus() != Member.Status.ACTIVE) {
                throw AuthFailure.unauthorized();
            }
            return new Flow("LOGIN_READY", identity.provider().name(), identity.email(), "ACTIVE", null);
        }
        return new Flow("SIGNUP_REQUIRED", identity.provider().name(), identity.email(), null, null);
    }

    @Transactional(timeout = 10)
    public Issued signup(VerifiedIdentity identity, SignupRequest request) {
        identity.requireFresh();
        ensureNotBanned(identity);
        if (request == null || request.profileMessage() != null && (request.profileMessage().length() > 255 || request.profileMessage().indexOf('\0') >= 0)) {
            throw new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
        }
        if (!NicknamePolicy.isValid(request.nickname())) {
            throw new AuthFailure("INVALID_NICKNAME", HttpStatus.BAD_REQUEST);
        }
        consents.validate(new com.yogimangchi.content.consent.PolicyConsents.Acceptance(
                request.termAgree(), request.privateAgree(), request.termsVersion(), request.privacyVersion()));
        if (identities.findByProviderAndProviderSubject(identity.provider(), identity.subject()).isPresent()) {
            throw new AuthFailure("MEMBER_ALREADY_EXISTS", HttpStatus.CONFLICT);
        }
        if (members.existsByNickname(request.nickname())) {
            throw new AuthFailure("NICKNAME_UNAVAILABLE", HttpStatus.CONFLICT);
        }
        Instant now = now();
        var member = members.save(Member.signup(request.nickname(), request.profileMessage() == null ? "" : request.profileMessage(), now));
        consents.record(member.getId(), new com.yogimangchi.content.consent.PolicyConsents.Acceptance(
                request.termAgree(), request.privateAgree(), request.termsVersion(), request.privacyVersion()), now);
        identities.save(OAuthIdentity.link(member.getId(), identity.provider(), identity.subject(), identity.email()));
        provisioning.enqueue(member.getId());
        return issue(member, UUID.randomUUID(), now, now.plus(Duration.ofDays(7)));
    }

    @Transactional(timeout = 10)
    public Issued completeLogin(VerifiedIdentity identity) {
        identity.requireFresh();
        ensureNotBanned(identity);
        var link = identities.findByProviderAndProviderSubject(identity.provider(), identity.subject())
                .orElseThrow(AuthFailure::unauthorized);
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        Instant now = now();
        return issue(allowedForLogin(link.getMemberId()), UUID.randomUUID(), now, now.plus(Duration.ofDays(7)));
    }

    @Transactional(timeout = 10, noRollbackFor = AuthFailure.class)
    public Issued refresh(String token) {
        if (!RefreshTokens.valid(token)) {
            throw AuthFailure.unauthorized();
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        // Member -> refresh lock order matches withdrawal, preventing post-revocation token issuance.
        Long owner = sessions.memberByHash(RefreshTokens.hash(token)).orElseThrow(AuthFailure::unauthorized);
        var lockedMember = members.lockById(owner).orElseThrow(AuthFailure::unauthorized);
        if (lockedMember.getStatus() == Member.Status.BANNED) {
            throw new AuthFailure("MEMBER_BANNED", HttpStatus.FORBIDDEN);
        }
        if (lockedMember.getStatus() != Member.Status.ACTIVE && lockedMember.getStatus() != Member.Status.SUSPENDED) {
            throw AuthFailure.unauthorized();
        }
        var old = sessions.lockByHash(RefreshTokens.hash(token)).orElseThrow(AuthFailure::unauthorized);
        Instant now = now();
        if (old.getStatus() != RefreshSession.Status.ACTIVE || !old.getExpiresAt().isAfter(now)) {
            sessions.revokeFamily(old.getFamilyId(), now); // Commit theft detection even though the HTTP response is 401.
            throw AuthFailure.unauthorized();
        }
        Member member;
        try {
            member = activeOrSuspended(old.getMemberId());
        } catch (AuthFailure failure) {
            sessions.revokeFamily(old.getFamilyId(), now);
            throw failure;
        }
        old.rotate(now);
        return issue(member, old.getFamilyId(), now, old.getExpiresAt()); // Fixed 7-day lifetime, no unlimited sliding session.
    }

    @Transactional(readOnly = true, timeout = 10)
    public boolean hasActiveRefreshSession(String token) {
        if (!RefreshTokens.valid(token)) {
            return false;
        }
        String hash = RefreshTokens.hash(token);
        Boolean active = jdbc.queryForObject("""
                SELECT EXISTS(
                    SELECT 1
                    FROM content.refresh_session rs
                    JOIN content.member m ON m.id = rs.member_id
                    WHERE rs.token_hash = ?
                      AND rs.status = 'ACTIVE'
                      AND rs.expires_at > NOW()
                      AND m.status IN ('ACTIVE', 'SUSPENDED')
                )
                """, Boolean.class, hash);
        return Boolean.TRUE.equals(active);
    }

    @Transactional(readOnly = true, timeout = 10)
    public boolean isMemberSessionEligible(Long memberId) {
        if (memberId == null || memberId <= 0) {
            return false;
        }
        Boolean eligible = jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM content.member WHERE id = ? AND status IN ('ACTIVE', 'SUSPENDED'))",
                Boolean.class,
                memberId);
        return Boolean.TRUE.equals(eligible);
    }

    @Transactional(timeout = 10)
    public void logout(String token) {
        if (!RefreshTokens.valid(token)) {
            return;
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        String hash = RefreshTokens.hash(token);
        var owner = sessions.memberByHash(hash);
        // Serialize with rotation/withdrawal before locking a family. Otherwise a family-wide
        // UPDATE can miss a successor inserted after its statement snapshot, or deadlock on it.
        if (owner.isEmpty() || members.lockById(owner.get()).isEmpty()) {
            return;
        }
        sessions.lockByHash(hash).ifPresent(s -> sessions.revokeFamily(s.getFamilyId(), now()));
    }

    @Transactional(timeout = 10)
    public int logoutAll(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw AuthFailure.unauthorized();
        }
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        members.lockById(memberId)
                .filter(m -> m.getStatus() == Member.Status.ACTIVE || m.getStatus() == Member.Status.SUSPENDED)
                .orElseThrow(AuthFailure::unauthorized);
        return sessions.revokeMember(memberId, now());
    }

    private void ensureNotBanned(VerifiedIdentity identity) {
        Boolean banned = jdbc.queryForObject(
                "select exists(select 1 from content.banned_oauth_identity where provider = ? and provider_subject = ?)",
                Boolean.class,
                identity.provider().name(),
                identity.subject());
        if (Boolean.TRUE.equals(banned)) {
            throw new AuthFailure("MEMBER_BANNED", HttpStatus.FORBIDDEN);
        }
    }

    private Issued issue(Member member, UUID family, Instant now, Instant expiry) {
        String refresh = RefreshTokens.issue();
        sessions.save(RefreshSession.issue(family, member.getId(), RefreshTokens.hash(refresh), now, expiry));
        return new Issued(access.issue(member, now), refresh, expiry);
    }

    private Member allowedForLogin(Long id) {
        Member member = members.lockById(id).orElseThrow(AuthFailure::unauthorized);
        if (member.getStatus() == Member.Status.BANNED) {
            throw new AuthFailure("MEMBER_BANNED", HttpStatus.FORBIDDEN);
        }
        if (member.getStatus() != Member.Status.ACTIVE && member.getStatus() != Member.Status.SUSPENDED) {
            throw AuthFailure.unauthorized();
        }
        return member;
    }

    private Member activeOrSuspended(Long id) {
        return members.lockById(id)
                .filter(m -> m.getStatus() == Member.Status.ACTIVE || m.getStatus() == Member.Status.SUSPENDED)
                .orElseThrow(AuthFailure::unauthorized);
    }

    private static Instant now() {
        return Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
    }
}
