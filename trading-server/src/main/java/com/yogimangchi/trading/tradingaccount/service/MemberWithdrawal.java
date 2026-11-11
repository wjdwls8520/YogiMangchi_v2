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
    private final com.yogimangchi.trading.execution.recovery.RiskAdmission risk;
    private final EntityManager entities;
    private final TradingAccountRepository accounts;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final TradingOrderRepository orders;
    private final AccountLock locks;
    private final TradingEvents events;
    private final com.yogimangchi.trading.tradinground.MemberRounds rounds;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;
    private final org.springframework.beans.factory.ObjectProvider<com.yogimangchi.trading.contest.RedisContestLeaderboardStore> leaderboardStores;
    private final org.springframework.beans.factory.ObjectProvider<com.yogimangchi.trading.tradingevent.websocket.TradingEventWebSocketHandler> wsHandlers;
    public MemberWithdrawal(EntityManager entities,TradingAccountRepository accounts,WalletRepository wallets,
            PositionRepository positions,TradingOrderRepository orders,AccountLock locks,TradingEvents events,
            com.yogimangchi.trading.tradinground.MemberRounds rounds,
            com.yogimangchi.trading.execution.recovery.RiskAdmission risk,
            org.springframework.jdbc.core.JdbcTemplate jdbc,
            org.springframework.beans.factory.ObjectProvider<com.yogimangchi.trading.contest.RedisContestLeaderboardStore> leaderboardStores,
            org.springframework.beans.factory.ObjectProvider<com.yogimangchi.trading.tradingevent.websocket.TradingEventWebSocketHandler> wsHandlers) {
        this.risk=risk;
        this.entities=entities; this.accounts=accounts; this.wallets=wallets; this.positions=positions;
        this.orders=orders; this.locks=locks; this.events=events;this.rounds=rounds;
        this.jdbc=jdbc; this.leaderboardStores=leaderboardStores; this.wsHandlers=wsHandlers;
    }
    @Transactional(timeout=10)
    public void withdraw(Long memberId) {
        risk.enterTransaction();
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
        if(account.getStatus()!=TradingAccount.Status.WITHDRAWN) {
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
            rounds.captureRetirement(id);
            for(var position:open) {released=released.add(position.closeForWithdrawal(now));events.recordStopLoss(position);}
            wallet.releaseExposure(released,reserved);
            if(wallet.getUsedMargin().signum()!=0 || wallet.getReservedMargin().signum()!=0)
                throw new IllegalStateException("Withdrawal found inconsistent reservations");
            rounds.finish(id,wallet,"MEMBER_WITHDRAWAL",now);
            account.withdraw(now);
            risk.retireWithdrawal(id);
        }

        for(Long contestId:accounts.findNonWithdrawnContestAccountIdsByMemberId(memberId)) {
            var contestAccount=locks.lockIncludingWithdrawn(contestId);
            if(contestAccount.getStatus()==TradingAccount.Status.WITHDRAWN) continue;
            Instant now=Instant.now().truncatedTo(ChronoUnit.MICROS);
            var contestWallet=wallets.findById(contestId).orElseThrow();
            var open=positions.findByAccountIdAndStatusOrderByIdAsc(contestId,Position.Status.OPEN);
            var byId=open.stream().collect(Collectors.toMap(Position::getId,Function.identity()));
            BigDecimal released=BigDecimal.ZERO,reserved=BigDecimal.ZERO;
            for(var order:orders.findByAccountIdAndStatusOrderByIdAsc(contestId,TradingOrder.Status.PENDING)) {
                if(order.getAction()==TradingOrder.Action.OPEN) reserved=reserved.add(order.getReservedMargin());
                else byId.get(order.getPositionId()).releaseCloseReservation(order.getQuantity());
                order.cancelForWithdrawal(now); events.record(order,null);
            }
            for(var position:open) {released=released.add(position.closeForWithdrawal(now));events.recordStopLoss(position);}
            contestWallet.releaseExposure(released,reserved);
            if(contestWallet.getUsedMargin().signum()!=0 || contestWallet.getReservedMargin().signum()!=0)
                throw new IllegalStateException("Contest withdrawal found inconsistent reservations");
            contestAccount.withdraw(now);
            risk.retireWithdrawal(contestId);
        }

        java.time.OffsetDateTime tsNow=Instant.now().truncatedTo(ChronoUnit.MICROS).atOffset(java.time.ZoneOffset.UTC);
        java.util.Set<Long> affectedSeasonIds=new java.util.LinkedHashSet<>();
        affectedSeasonIds.addAll(jdbc.queryForList(
                "SELECT DISTINCT contest_season_id FROM trading.contest_participant WHERE member_id = ?",
                Long.class,memberId));
        affectedSeasonIds.addAll(jdbc.queryForList(
                "SELECT DISTINCT contest_season_id FROM trading.contest_application WHERE member_id = ?",
                Long.class,memberId));

        jdbc.update("""
                UPDATE trading.contest_application
                SET status = CASE WHEN status = 'PENDING' THEN 'CANCELED' ELSE status END,
                    reject_reason = CASE WHEN status = 'PENDING' THEN '회원 탈퇴로 자동 취소됨' ELSE reject_reason END,
                    processed_at = CASE WHEN status = 'PENDING' THEN ? ELSE processed_at END,
                    nickname = '탈퇴한회원'
                WHERE member_id = ?
                  AND (status = 'PENDING' OR nickname <> '탈퇴한회원')
                """,tsNow,memberId);

        jdbc.update("""
                UPDATE trading.contest_participant
                SET nickname = '탈퇴한회원'
                WHERE member_id = ?
                  AND nickname <> '탈퇴한회원'
                """,memberId);

        var leaderboardStore=leaderboardStores.getIfAvailable();
        if(leaderboardStore!=null) {
            if(affectedSeasonIds.isEmpty()) leaderboardStore.evictPublicSeasons();
            else affectedSeasonIds.forEach(leaderboardStore::evictSeason);
        }

        var wsHandler=wsHandlers.getIfAvailable();
        if(wsHandler!=null) {
            wsHandler.disconnectMember(memberId);
            if(org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
                org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                        new org.springframework.transaction.support.TransactionSynchronization() {
                            @Override public void afterCommit() {
                                wsHandler.disconnectMember(memberId);
                            }
                        });
            }
        }
    }
}
