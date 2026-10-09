package com.yogimangchi.trading.tradingaccount.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.Objects;

@Entity
@Table(name = "trading_account")
public class TradingAccount {
    public enum Status { ACTIVE, BANKRUPT }

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16)
    private Status status;
    @Column(nullable = false, length = 64, updatable = false)
    private String credentialHash;
    @Column(nullable = false, updatable = false)
    private Instant credentialExpiresAt;
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
    @Column(nullable = false)
    private Instant lastFinancialChangeAt;

    protected TradingAccount() { }

    public static TradingAccount guest(String credentialHash, Instant expiresAt, Instant now) {
        if (credentialHash == null || !credentialHash.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid credential hash");
        if (!Objects.requireNonNull(expiresAt).isAfter(Objects.requireNonNull(now))) throw new IllegalArgumentException("Credential expiry must be in the future");
        TradingAccount result = new TradingAccount();
        result.status = Status.ACTIVE;
        result.credentialHash = credentialHash;
        result.credentialExpiresAt = expiresAt;
        result.createdAt = now;
        result.lastFinancialChangeAt = now;
        return result;
    }

    public void recordFinancialChange(Instant priceVectorTime) {
        Objects.requireNonNull(priceVectorTime);
        if (priceVectorTime.isBefore(lastFinancialChangeAt)) throw new IllegalArgumentException("Financial time cannot move backwards");
        lastFinancialChangeAt = priceVectorTime;
    }

    public void declareBankrupt() { status = Status.BANKRUPT; }
    public Long getId() { return id; }
    public Status getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getCredentialExpiresAt() { return credentialExpiresAt; }
    public Instant getLastFinancialChangeAt() { return lastFinancialChangeAt; }
}
