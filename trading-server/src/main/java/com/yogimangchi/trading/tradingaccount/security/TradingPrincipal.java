package com.yogimangchi.trading.tradingaccount.security;

/** accountId is null only for an authenticated member who has not explicitly opened an account. */
public record TradingPrincipal(Long accountId, java.time.Instant expiresAt, Long memberId) {
    public TradingPrincipal(Long accountId,java.time.Instant expiresAt) { this(accountId,expiresAt,null); }
}
