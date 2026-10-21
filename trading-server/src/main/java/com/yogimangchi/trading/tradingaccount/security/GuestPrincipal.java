package com.yogimangchi.trading.tradingaccount.security;

public record GuestPrincipal(Long accountId, java.time.Instant expiresAt) { }
