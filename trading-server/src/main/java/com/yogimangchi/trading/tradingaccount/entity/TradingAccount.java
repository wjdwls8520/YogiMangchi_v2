package com.yogimangchi.trading.tradingaccount.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.Objects;

@Entity
@Table(name = "trading_account")
public class TradingAccount {
    public enum Status { ACTIVE, BANKRUPT }
    public enum MarginTransitionStatus { COMPLETE, PENDING, REVIEW_REQUIRED }

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16)
    private Status status;
    @Column(nullable = false, updatable = false)
    private boolean guestAccount;
    @Column(nullable = false, length = 64, updatable = false)
    private String credentialHash;
    @Column(nullable = false, updatable = false)
    private Instant credentialExpiresAt;
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
    @Column(nullable = false)
    private Instant lastFinancialChangeAt;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private MarginTransitionStatus marginTransitionStatus;
    private Instant isolatedActivatedAt;

    protected TradingAccount() { }

    public static TradingAccount guest(String credentialHash, Instant expiresAt, Instant now) {
        if (credentialHash == null || !credentialHash.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid credential hash");
        if (!Objects.requireNonNull(expiresAt).isAfter(Objects.requireNonNull(now))) throw new IllegalArgumentException("Credential expiry must be in the future");
        TradingAccount result = new TradingAccount();
        result.status = Status.ACTIVE;
        result.guestAccount = true;
        result.credentialHash = credentialHash;
        result.credentialExpiresAt = expiresAt;
        result.createdAt = now;
        result.lastFinancialChangeAt = now;
        result.marginTransitionStatus = MarginTransitionStatus.COMPLETE;
        result.isolatedActivatedAt = now;
        return result;
    }

    public void recordFinancialChange(Instant priceVectorTime) {
        Objects.requireNonNull(priceVectorTime);
        if (priceVectorTime.isBefore(lastFinancialChangeAt)) throw new IllegalArgumentException("Financial time cannot move backwards");
        lastFinancialChangeAt = priceVectorTime;
    }

    public void declareBankrupt() { status = Status.BANKRUPT; }
    public boolean isIsolated() { return marginTransitionStatus == MarginTransitionStatus.COMPLETE; }
    public void requireMarginReview() {
        if (marginTransitionStatus != MarginTransitionStatus.PENDING) throw new IllegalStateException("Not awaiting margin transition");
        marginTransitionStatus = MarginTransitionStatus.REVIEW_REQUIRED;
    }
    public void activateIsolated(Instant now) {
        if (marginTransitionStatus != MarginTransitionStatus.PENDING) throw new IllegalStateException("Margin transition is not eligible");
        marginTransitionStatus = MarginTransitionStatus.COMPLETE;
        isolatedActivatedAt = Objects.requireNonNull(now);
        recordFinancialChange(now);
    }
    public String getMarginMode() { return isIsolated() ? "ISOLATED" : "LEGACY_CROSS"; }
    public MarginTransitionStatus getMarginTransitionStatus() { return marginTransitionStatus; }
    public Long getId() { return id; }
    public Status getStatus() { return status; }
    public boolean isGuestAccount() { return guestAccount; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getCredentialExpiresAt() { return credentialExpiresAt; }
    public Instant getLastFinancialChangeAt() { return lastFinancialChangeAt; }
}
