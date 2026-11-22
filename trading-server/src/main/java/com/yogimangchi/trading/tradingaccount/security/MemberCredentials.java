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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name="trading.member-auth.enabled",havingValue="true")
public class MemberCredentials {
    private static final String AUTH_LOOKUP_MOCK_SQL = """
            SELECT
              EXISTS(SELECT 1 FROM trading.trading_account WHERE member_id = ? AND account_type = 'MOCK' AND status = 'WITHDRAWN') AS withdrawn,
              EXISTS(SELECT 1 FROM trading.member_suspension WHERE member_id = ? AND suspended = TRUE) AS suspended,
              (SELECT id FROM trading.trading_account WHERE member_id = ? AND account_type = 'MOCK' LIMIT 1) AS account_id
            """;
    private static final String AUTH_LOOKUP_CONTEST_SQL = """
            SELECT
              EXISTS(SELECT 1 FROM trading.trading_account WHERE member_id = ? AND account_type = 'MOCK' AND status = 'WITHDRAWN') AS withdrawn,
              EXISTS(SELECT 1 FROM trading.member_suspension WHERE member_id = ? AND suspended = TRUE) AS suspended,
              (SELECT id FROM trading.trading_account WHERE member_id = ? AND account_type = 'CONTEST' AND contest_season_id = ? LIMIT 1) AS account_id
            """;

    private record AuthLookup(boolean withdrawn, boolean suspended, Long accountId) { }

    private final JwtDecoder decoder;
    private final TradingAccountRepository accounts;
    private final ObjectProvider<MemberSuspensionService> suspensions;
    private final JdbcTemplate jdbc;

    public MemberCredentials(@Qualifier("memberJwtDecoder") JwtDecoder decoder, TradingAccountRepository accounts) {
        this(decoder, accounts, null, null);
    }

    public MemberCredentials(
            @Qualifier("memberJwtDecoder") JwtDecoder decoder,
            TradingAccountRepository accounts,
            ObjectProvider<MemberSuspensionService> suspensions) {
        this(decoder, accounts, suspensions, null);
    }

    @Autowired
    public MemberCredentials(
            @Qualifier("memberJwtDecoder") JwtDecoder decoder,
            TradingAccountRepository accounts,
            ObjectProvider<MemberSuspensionService> suspensions,
            JdbcTemplate jdbc) {
        this.decoder = decoder;
        this.accounts = accounts;
        this.suspensions = suspensions;
        this.jdbc = jdbc;
    }

    public Optional<TradingPrincipal> authenticate(String token) {
        return authenticate(token, null);
    }

    /**
     * Verifies the RS256 Access JWT before touching PostgreSQL, then checks withdrawal,
     * suspension, and account ownership in a single lightweight JDBC read (no Hibernate overhead).
     */
    public Optional<TradingPrincipal> authenticate(String token, Long contestSeasonId) {
        Jwt jwt;
        try { jwt=decoder.decode(token); } catch(JwtException failure) { return Optional.empty(); }
        Long member=Long.valueOf(jwt.getSubject());
        Long account;
        if (jdbc != null) {
            AuthLookup lookup = (contestSeasonId != null && contestSeasonId > 0)
                    ? jdbc.queryForObject(AUTH_LOOKUP_CONTEST_SQL,
                            (rs, n) -> new AuthLookup(rs.getBoolean("withdrawn"), rs.getBoolean("suspended"), rs.getObject("account_id", Long.class)),
                            member, member, member, contestSeasonId)
                    : jdbc.queryForObject(AUTH_LOOKUP_MOCK_SQL,
                            (rs, n) -> new AuthLookup(rs.getBoolean("withdrawn"), rs.getBoolean("suspended"), rs.getObject("account_id", Long.class)),
                            member, member, member);
            if (lookup == null || lookup.withdrawn()) return Optional.empty();
            if (lookup.suspended()) throw new MemberSuspendedException(member);
            account = lookup.accountId();
        } else {
            if(accounts.existsByMemberIdAndStatus(member,com.yogimangchi.trading.tradingaccount.entity.TradingAccount.Status.WITHDRAWN)) return Optional.empty();
            MemberSuspensionService suspensionService = suspensions != null ? suspensions.getIfAvailable() : null;
            if (suspensionService != null && suspensionService.isSuspended(member)) {
                throw new MemberSuspendedException(member);
            }
            account = (contestSeasonId != null && contestSeasonId > 0)
                    ? accounts.findContestAccountId(member, contestSeasonId).orElse(null)
                    : accounts.findAccountIdByMemberId(member).orElse(null);
        }
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
