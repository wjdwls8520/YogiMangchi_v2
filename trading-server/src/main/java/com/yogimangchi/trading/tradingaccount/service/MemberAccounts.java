package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.tradingaccount.dto.MemberAccountResponse;
import com.yogimangchi.trading.tradingaccount.entity.*;
import com.yogimangchi.trading.tradingaccount.repository.*;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MemberAccounts {
    private final EntityManager entities;
    private final TradingAccountRepository accounts;
    private final WalletRepository wallets;
    private final AccountLock locks;
    private final com.yogimangchi.trading.tradinground.MemberRounds rounds;
    public MemberAccounts(EntityManager entities,TradingAccountRepository accounts,WalletRepository wallets,AccountLock locks,com.yogimangchi.trading.tradinground.MemberRounds rounds) {
        this.entities=entities; this.accounts=accounts; this.wallets=wallets; this.locks=locks;this.rounds=rounds;
    }
    @Transactional(timeout=5)
    public MemberAccountResponse open(Long memberId) {
        if(memberId==null || memberId<=0) throw new IllegalArgumentException("Authenticated member ID required");
        entities.createNativeQuery("SET LOCAL lock_timeout = '2s'").executeUpdate();
        // No row exists to lock on first creation. A transaction-scoped PostgreSQL lock serializes just this member.
        // Hash collisions only serialize unrelated provisioning; member_id UNIQUE remains the ownership invariant.
        entities.createNativeQuery("select pg_advisory_xact_lock(hashtextextended(:scope,0))")
                .setParameter("scope","trading-member-account:"+memberId).getSingleResult();
        Long accountId=accounts.findAccountIdByMemberId(memberId).orElseGet(() -> {
            var created=accounts.save(TradingAccount.member(memberId,Instant.now()));
            var wallet=wallets.save(Wallet.open(created.getId()));
            entities.flush();
            rounds.begin(created,wallet,"INITIAL_GRANT",1,created.getCreatedAt());return created.getId();
        });
        // Load state only after acquiring the financial row lock (avoid a pre-lock managed stale Account).
        var account=locks.lock(accountId);
        var wallet=wallets.findById(account.getId()).orElseThrow(() -> new IllegalStateException("Member wallet missing"));
        return new MemberAccountResponse(account.getId(),memberId,account.getStatus().name(),"USDT",wallet.getBalance().toPlainString());
    }
}
