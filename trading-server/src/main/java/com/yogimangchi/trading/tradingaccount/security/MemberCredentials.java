package com.yogimangchi.trading.tradingaccount.security;

import com.yogimangchi.trading.tradingaccount.repository.TradingAccountRepository;
import java.util.Optional;
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
    public MemberCredentials(@Qualifier("memberJwtDecoder") JwtDecoder decoder,TradingAccountRepository accounts) { this.decoder=decoder; this.accounts=accounts; }
    @Transactional(readOnly=true,timeout=3)
    public Optional<TradingPrincipal> authenticate(String token) {
        Jwt jwt;
        try { jwt=decoder.decode(token); } catch(JwtException failure) { return Optional.empty(); }
        Long member=Long.valueOf(jwt.getSubject());
        Long account=accounts.findAccountIdByMemberId(member).orElse(null);
        return Optional.of(new TradingPrincipal(account,jwt.getExpiresAt(),member));
    }
}
