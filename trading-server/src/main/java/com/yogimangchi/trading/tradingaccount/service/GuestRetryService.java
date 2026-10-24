package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.repository.TradingOrderRepository;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.tradingaccount.dto.GuestRetryResponse;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GuestRetryService {
    private final com.yogimangchi.trading.execution.recovery.RiskAdmission risk;
    private final AccountLock locks;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final TradingOrderRepository orders;
    private final TradingEvents events;
    private final JdbcTemplate jdbc;
    public GuestRetryService(AccountLock locks,WalletRepository wallets,PositionRepository positions,
            TradingOrderRepository orders,TradingEvents events,JdbcTemplate jdbc,com.yogimangchi.trading.execution.recovery.RiskAdmission risk) {
        this.risk=risk;
        this.locks=locks; this.wallets=wallets; this.positions=positions; this.orders=orders; this.events=events; this.jdbc=jdbc;
    }
    @Transactional(timeout=10)
    public GuestRetryResponse retry(Long accountId,String key) {
        risk.enterTransaction();
        if(key==null || !key.matches("[A-Za-z0-9_-]{8,100}")) throw new BusinessException(ErrorCode.INVALID_IDEMPOTENCY_KEY);
        var account=locks.lock(accountId);
        if(!account.isGuestAccount() || account.getMemberId()!=null) throw new BusinessException(ErrorCode.GUEST_ACCOUNT_REQUIRED);
        Instant now=Instant.now().truncatedTo(ChronoUnit.MICROS);
        if(!account.getCredentialExpiresAt().isAfter(now)) throw new BusinessException(ErrorCode.GUEST_CREDENTIAL_EXPIRED);
        var previous=jdbc.query("select id,balance_after,canceled_order_count,closed_position_count,reset_at from trading.guest_retry where account_id=? and request_key=?",
                (r,n) -> response(r.getLong("id"),accountId,r.getBigDecimal("balance_after"),r.getInt("canceled_order_count"),r.getInt("closed_position_count"),r.getTimestamp("reset_at").toInstant()),accountId,key);
        if(!previous.isEmpty()) return previous.get(0);
        risk.requireClear(accountId);
        var wallet=wallets.findById(accountId).orElseThrow();
        BigDecimal before=wallet.getBalance(),released=BigDecimal.ZERO,reserved=BigDecimal.ZERO;
        var open=positions.findByAccountIdAndStatusOrderByIdAsc(accountId,Position.Status.OPEN);
        var byId=open.stream().collect(Collectors.toMap(Position::getId,Function.identity()));
        var pending=orders.findByAccountIdAndStatusOrderByIdAsc(accountId,TradingOrder.Status.PENDING);
        for(var order:pending) {
            if(order.getAction()==TradingOrder.Action.OPEN) reserved=reserved.add(order.getReservedMargin());
            else byId.get(order.getPositionId()).releaseCloseReservation(order.getQuantity());
            order.cancelForGuestRetry(now); events.record(order,null);
        }
        for(var position:open) released=released.add(position.closeForGuestRetry(now));
        wallet.restartGuest(released,reserved);
        account.restartGuest(now);
        Long id=jdbc.queryForObject("insert into trading.guest_retry(account_id,request_key,balance_before,balance_after,capital_adjustment,canceled_order_count,closed_position_count,reset_at) values (?,?,?,?,?,?,?,?) returning id",
                Long.class,accountId,key,before,wallet.getBalance(),wallet.getBalance().subtract(before),pending.size(),open.size(),Timestamp.from(now));
        return response(id,accountId,wallet.getBalance(),pending.size(),open.size(),now);
    }
    private static GuestRetryResponse response(Long id,Long accountId,BigDecimal balance,int canceled,int closed,Instant at) {
        return new GuestRetryResponse(id,accountId,"ACTIVE","USDT",balance.setScale(TradingMath.AMOUNT_SCALE).toPlainString(),canceled,closed,at);
    }
}
