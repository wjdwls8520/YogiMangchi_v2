package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.repository.TradingAccountRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Every financial read/write takes this row lock before wallet, positions and orders, in that order. */
@Component
public class AccountLock {
    private final EntityManager entityManager;
    private final TradingAccountRepository accounts;

    public AccountLock(EntityManager entityManager, TradingAccountRepository accounts) {
        this.entityManager = entityManager;
        this.accounts = accounts;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public TradingAccount lock(Long accountId) {
        entityManager.createNativeQuery("SET LOCAL lock_timeout = '2s'").executeUpdate();
        return accounts.lockById(accountId).orElseThrow(() -> new BusinessException(ErrorCode.ACCOUNT_NOT_FOUND));
    }
}
