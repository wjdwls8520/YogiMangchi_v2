package com.yogimangchi.trading.tradingaccount.security;

import java.time.Instant;
import java.util.List;

/** accountId is null only for an authenticated member who has not explicitly opened an account. */
public record TradingPrincipal(Long accountId, Instant expiresAt, Long memberId, List<String> roles) {
    public TradingPrincipal {
        roles = roles == null ? List.of() : List.copyOf(roles);
    }

    public TradingPrincipal(Long accountId, Instant expiresAt, Long memberId) {
        this(accountId, expiresAt, memberId, memberId != null ? List.of("MEMBER") : List.of());
    }

    public TradingPrincipal(Long accountId, Instant expiresAt) {
        this(accountId, expiresAt, null, List.of());
    }

    public boolean isAdmin() {
        return roles != null && (roles.contains("ADMIN") || roles.contains("ROLE_ADMIN"));
    }
}
