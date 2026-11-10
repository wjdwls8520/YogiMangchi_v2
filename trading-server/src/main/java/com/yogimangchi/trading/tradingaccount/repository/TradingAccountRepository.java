package com.yogimangchi.trading.tradingaccount.repository;

import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

public interface TradingAccountRepository extends Repository<TradingAccount, Long> {
    TradingAccount save(TradingAccount account);
    Optional<TradingAccount> findById(Long id);
    @Query("select a.id from TradingAccount a where a.memberId=:memberId and a.accountType=com.yogimangchi.trading.tradingaccount.entity.TradingAccount.AccountType.MOCK")
    Optional<Long> findAccountIdByMemberId(Long memberId);
    @Query("select a.id from TradingAccount a where a.memberId=:memberId and a.contestSeasonId=:contestSeasonId and a.accountType=com.yogimangchi.trading.tradingaccount.entity.TradingAccount.AccountType.CONTEST")
    Optional<Long> findContestAccountId(Long memberId, Long contestSeasonId);
    boolean existsByMemberIdAndAccountTypeAndStatus(Long memberId, TradingAccount.AccountType accountType, TradingAccount.Status status);
    default boolean existsByMemberIdAndStatus(Long memberId,TradingAccount.Status status) {
        return existsByMemberIdAndAccountTypeAndStatus(memberId, TradingAccount.AccountType.MOCK, status);
    }
    Optional<TradingAccount> findByCredentialHash(String credentialHash);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from TradingAccount a where a.id = :id")
    Optional<TradingAccount> lockById(Long id);
}
