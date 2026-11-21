package com.yogimangchi.trading.tradingaccount.security;

import com.yogimangchi.trading.tradingaccount.repository.TradingAccountRepository;
import com.yogimangchi.trading.tradingaccount.service.MemberSuspensionService;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@ConditionalOnProperty(name="trading.member-auth.enabled",havingValue="true")
public class MemberCredentials {
    private final JwtDecoder decoder;
    private final TradingAccountRepository accounts;
    private final ObjectProvider<MemberSuspensionService> suspensions;

    public MemberCredentials(@Qualifier("memberJwtDecoder") JwtDecoder decoder, TradingAccountRepository accounts) {
        this(decoder, accounts, null);
    }

    @Autowired
    public MemberCredentials(
            @Qualifier("memberJwtDecoder") JwtDecoder decoder,
            TradingAccountRepository accounts,
            ObjectProvider<MemberSuspensionService> suspensions) {
        this.decoder = decoder;
        this.accounts = accounts;
        this.suspensions = suspensions;
    }

    @Transactional(readOnly=true,timeout=3)
    public Optional<TradingPrincipal> authenticate(String token) {
        return authenticate(token, null);
    }

    @Transactional(readOnly=true,timeout=3)
    public Optional<TradingPrincipal> authenticate(String token, Long contestSeasonId) {
        Jwt jwt;
        try { jwt=decoder.decode(token); } catch(JwtException failure) { return Optional.empty(); }
        Long member=Long.valueOf(jwt.getSubject());
        if(accounts.existsByMemberIdAndStatus(member,com.yogimangchi.trading.tradingaccount.entity.TradingAccount.Status.WITHDRAWN)) return Optional.empty();
        MemberSuspensionService suspensionService = suspensions != null ? suspensions.getIfAvailable() : null;
        if (suspensionService != null && suspensionService.isSuspended(member)) {
            throw new MemberSuspendedException(member);
        }
        Long account = (contestSeasonId != null && contestSeasonId > 0)
                ? accounts.findContestAccountId(member, contestSeasonId).orElse(null)
                : accounts.findAccountIdByMemberId(member).orElse(null);
        var roles = jwt.getClaimAsStringList("roles");
        return Optional.of(new TradingPrincipal(account,jwt.getExpiresAt(),member,roles));
    }

    /**
     * Signature-only RS256 verification without PostgreSQL access.
     * Used exclusively as a read-only degraded fallback for ROLE_ADMIN diagnostics endpoints during DB outages.
     */
    public Optional<TradingPrincipal> authenticateDegradedAdmin(String token) {
        if (token == null || token.length() > 8192 || !token.contains(".")) {
            return Optional.empty();
        }
        Jwt jwt;
        try {
            jwt = decoder.decode(token);
        } catch (JwtException failure) {
            return Optional.empty();
        }
        Instant expiresAt = jwt.getExpiresAt();
        if (expiresAt == null || !expiresAt.isAfter(Instant.now())) {
            return Optional.empty();
        }
        List<String> roles = jwt.getClaimAsStringList("roles");
        TradingPrincipal candidate = new TradingPrincipal(null, expiresAt, Long.valueOf(jwt.getSubject()), roles);
        return candidate.isAdmin() ? Optional.of(candidate) : Optional.empty();
    }
}
