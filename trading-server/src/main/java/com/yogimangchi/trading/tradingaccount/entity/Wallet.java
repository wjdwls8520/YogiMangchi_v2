package com.yogimangchi.trading.tradingaccount.entity;

import com.yogimangchi.trading.execution.TradingMath;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.Objects;

@Entity
@Table(name = "wallet")
public class Wallet {
    @Id private Long accountId;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal balance;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal usedMargin;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal reservedMargin;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal realizedPnl;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal feesPaid;
    @Column(nullable = false, precision = 38, scale = 18) private BigDecimal settlementAdjustment;

    protected Wallet() { }

    public static Wallet open(Long accountId) {
        return initialize(accountId,TradingMath.INITIAL_BALANCE);
    }

    public static Wallet emptyMemberWallet(Long accountId) { return initialize(accountId,BigDecimal.ZERO); }

    private static Wallet initialize(Long accountId,BigDecimal initial) {
        if (accountId == null || accountId <= 0) throw new IllegalArgumentException("Account ID must be positive");
        Wallet wallet = new Wallet();
        wallet.accountId = accountId;
        wallet.balance = TradingMath.amount(initial);
        wallet.usedMargin = TradingMath.amount(BigDecimal.ZERO);
        wallet.reservedMargin = TradingMath.amount(BigDecimal.ZERO);
        wallet.realizedPnl = TradingMath.amount(BigDecimal.ZERO);
        wallet.feesPaid = TradingMath.amount(BigDecimal.ZERO);
        wallet.settlementAdjustment = TradingMath.amount(BigDecimal.ZERO);
        return wallet;
    }

    public void reserve(BigDecimal margin) {
        BigDecimal value = positive(margin);
        requireCashCapacity(value);
        reservedMargin = reservedMargin.add(value);
    }

    public void releaseReservation(BigDecimal margin) {
        BigDecimal value = positive(margin);
        if (value.compareTo(reservedMargin) > 0) throw new IllegalStateException("Reservation cannot become negative");
        reservedMargin = reservedMargin.subtract(value);
    }

    public void openMargin(BigDecimal margin) {
        openMargin(margin, BigDecimal.ZERO);
    }

    public void openMargin(BigDecimal margin, BigDecimal fee) {
        BigDecimal value = positive(margin);
        BigDecimal charged = TradingMath.amount(fee);
        if (charged.signum() < 0) throw new IllegalArgumentException("Fee cannot be negative");
        requireCashCapacity(value.add(charged));
        usedMargin = usedMargin.add(value);
        balance = TradingMath.amount(balance.subtract(charged));
        feesPaid = feesPaid.add(charged);
    }

    /** Validated account-wide under AccountLock; changes reservations and used margin atomically. */
    public void reallocateMargin(BigDecimal used, BigDecimal reserved) {
        BigDecimal newUsed = TradingMath.amount(used);
        BigDecimal newReserved = TradingMath.amount(reserved);
        if (newUsed.signum() < 0 || newReserved.signum() < 0
                || newUsed.add(newReserved).compareTo(balance) > 0) throw new IllegalStateException("Insufficient cash margin");
        usedMargin = newUsed;
        reservedMargin = newReserved;
    }

    /** The caller validates this position's fresh risk and holds the account DB lock. */
    public void settle(BigDecimal releasedMargin, BigDecimal pnl) {
        settle(releasedMargin, pnl, BigDecimal.ZERO, BigDecimal.ZERO);
    }

    public void settle(BigDecimal releasedMargin, BigDecimal pnl, BigDecimal fee, BigDecimal adjustment) {
        BigDecimal released = TradingMath.amount(releasedMargin);
        if (released.signum() < 0) throw new IllegalArgumentException("Released margin cannot be negative");
        if (released.compareTo(usedMargin) > 0) throw new IllegalStateException("Used margin cannot become negative");
        BigDecimal delta = TradingMath.amount(pnl);
        BigDecimal charged = TradingMath.amount(fee);
        BigDecimal shortfall = TradingMath.amount(adjustment);
        if (charged.signum() < 0 || shortfall.signum() < 0) throw new IllegalArgumentException("Costs cannot be negative");
        BigDecimal net = delta.subtract(charged).add(shortfall);
        if (net.compareTo(released.negate()) < 0)
            throw new IllegalStateException("Isolated loss cannot exceed released collateral");
        BigDecimal newBalance = TradingMath.amount(balance.add(net));
        if (newBalance.compareTo(usedMargin.subtract(released).add(reservedMargin)) < 0)
            throw new IllegalStateException("Isolated settlement cannot consume unrelated collateral or reservations");
        BigDecimal newRealized = TradingMath.amount(realizedPnl.add(delta));
        usedMargin = usedMargin.subtract(released);
        balance = newBalance;
        realizedPnl = newRealized;
        feesPaid = feesPaid.add(charged);
        settlementAdjustment = settlementAdjustment.add(shortfall);
    }

    private void requireCashCapacity(BigDecimal additional) {
        if (balance.subtract(usedMargin).subtract(reservedMargin).compareTo(additional) < 0) {
            throw new IllegalStateException("Insufficient cash margin");
        }
    }

    private static BigDecimal positive(BigDecimal value) {
        if (Objects.requireNonNull(value).signum() <= 0 || value.stripTrailingZeros().scale() > TradingMath.AMOUNT_SCALE) {
            throw new IllegalArgumentException("Margin must be positive with supported precision");
        }
        return TradingMath.amount(value);
    }

    public Long getAccountId() { return accountId; }
    /** Release exposure only; retirement is not a priced settlement and must not rewrite ledger totals. */
    public void releaseExposure(BigDecimal openMargins,BigDecimal pendingReservations) {
        if(usedMargin.compareTo(openMargins)!=0 || reservedMargin.compareTo(pendingReservations)!=0)
            throw new IllegalStateException("Withdrawal exposure does not match wallet reservations");
        usedMargin=TradingMath.amount(BigDecimal.ZERO); reservedMargin=TradingMath.amount(BigDecimal.ZERO);
    }
    public void restartGuest(BigDecimal openMargins,BigDecimal pendingReservations) {
        releaseExposure(openMargins,pendingReservations);
        balance=TradingMath.amount(TradingMath.INITIAL_BALANCE);
        // Lifetime Fill totals stay intact; the separate retry record explains the cash adjustment.
    }
    public BigDecimal getBalance() { return balance; }
    public BigDecimal getUsedMargin() { return usedMargin; }
    public BigDecimal getReservedMargin() { return reservedMargin; }
    public BigDecimal getRealizedPnl() { return realizedPnl; }
    public BigDecimal getFeesPaid() { return feesPaid; }
    public BigDecimal getSettlementAdjustment() { return settlementAdjustment; }
}
