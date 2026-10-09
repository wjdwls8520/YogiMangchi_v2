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

    protected Wallet() { }

    public static Wallet open(Long accountId) {
        if (accountId == null || accountId <= 0) throw new IllegalArgumentException("Account ID must be positive");
        Wallet wallet = new Wallet();
        wallet.accountId = accountId;
        wallet.balance = TradingMath.amount(TradingMath.INITIAL_BALANCE);
        wallet.usedMargin = TradingMath.amount(BigDecimal.ZERO);
        wallet.reservedMargin = TradingMath.amount(BigDecimal.ZERO);
        wallet.realizedPnl = TradingMath.amount(BigDecimal.ZERO);
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
        BigDecimal value = positive(margin);
        requireCashCapacity(value);
        usedMargin = usedMargin.add(value);
    }

    /** Called only after account-wide fresh valuation and margin validation under the account DB lock. */
    public void settle(BigDecimal releasedMargin, BigDecimal pnl) {
        BigDecimal released = positive(releasedMargin);
        if (released.compareTo(usedMargin) > 0) throw new IllegalStateException("Used margin cannot become negative");
        BigDecimal delta = TradingMath.amount(pnl);
        BigDecimal newBalance = TradingMath.amount(balance.add(delta));
        BigDecimal newRealized = TradingMath.amount(realizedPnl.add(delta));
        usedMargin = usedMargin.subtract(released);
        balance = newBalance;
        realizedPnl = newRealized;
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
    public BigDecimal getBalance() { return balance; }
    public BigDecimal getUsedMargin() { return usedMargin; }
    public BigDecimal getReservedMargin() { return reservedMargin; }
    public BigDecimal getRealizedPnl() { return realizedPnl; }
}
