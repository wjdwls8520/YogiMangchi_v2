package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.tradingaccount.entity.*;
import com.yogimangchi.trading.tradingaccount.repository.*;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.repository.TradingOrderRepository;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MemberWithdrawal {
    private final EntityManager entities;
    private final TradingAccountRepository accounts;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final TradingOrderRepository orders;
    private final AccountLock locks;
    private final TradingEvents events;
    public MemberWithdrawal(EntityManager entities,TradingAccountRepository accounts,WalletRepository wallets,
            PositionRepository positions,TradingOrderRepository orders,AccountLock locks,TradingEvents events) {
        this.entities=entities; this.accounts=accounts; this.wallets=wallets; this.positions=positions;
        this.orders=orders; this.locks=locks; this.events=events;
    }
    @Transactional(timeout=10)
    public void withdraw(Long memberId) {
        if(memberId==null || memberId<=0) throw new IllegalArgumentException("Positive member ID required");
        entities.createNativeQuery("SET LOCAL lock_timeout = '2s'").executeUpdate();
        // Same provisioning lock prevents a still-valid Access JWT from creating an account after withdrawal.
        entities.createNativeQuery("select pg_advisory_xact_lock(hashtextextended(:scope,0))")
                .setParameter("scope","trading-member-account:"+memberId).getSingleResult();
        Instant createdAt=Instant.now().truncatedTo(ChronoUnit.MICROS);
        Long id=accounts.findAccountIdByMemberId(memberId).orElseGet(() -> {
            var created=accounts.save(TradingAccount.member(memberId,createdAt));
            wallets.save(Wallet.emptyMemberWallet(created.getId())); return created.getId();
        });
        var account=locks.lockIncludingWithdrawn(id);
        if(account.getStatus()==TradingAccount.Status.WITHDRAWN) return;
        // A concurrent order may commit while this request waits for the account lock.
        Instant now=Instant.now().truncatedTo(ChronoUnit.MICROS);
        var wallet=wallets.findById(id).orElseThrow();
        var open=positions.findByAccountIdAndStatusOrderByIdAsc(id,Position.Status.OPEN);
        var byId=open.stream().collect(Collectors.toMap(Position::getId,Function.identity()));
        BigDecimal released=BigDecimal.ZERO,reserved=BigDecimal.ZERO;
        for(var order:orders.findByAccountIdAndStatusOrderByIdAsc(id,TradingOrder.Status.PENDING)) {
            if(order.getAction()==TradingOrder.Action.OPEN) reserved=reserved.add(order.getReservedMargin());
            else byId.get(order.getPositionId()).releaseCloseReservation(order.getQuantity());
            order.cancelForWithdrawal(now); events.record(order,null);
        }
        for(var position:open) released=released.add(position.closeForWithdrawal(now));
        wallet.releaseForWithdrawal(released,reserved);
        if(wallet.getUsedMargin().signum()!=0 || wallet.getReservedMargin().signum()!=0)
            throw new IllegalStateException("Withdrawal found inconsistent reservations");
        account.withdraw(now);
    }
}
