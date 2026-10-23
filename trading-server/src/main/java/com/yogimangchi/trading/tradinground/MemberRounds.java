package com.yogimangchi.trading.tradinground;

import com.fasterxml.jackson.databind.*;
import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.tradingaccount.dto.AccountSummaryResponse;
import com.yogimangchi.trading.tradingaccount.entity.*;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.service.*;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.repository.TradingOrderRepository;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class MemberRounds {
    public record Round(Long roundId,int roundNumber,String status,String funding,String initialBalance,Instant startedAt,Instant endedAt,String endReason,JsonNode finalWallet,boolean currentRound) { }
    public record Page(List<Round> content,Long nextCursorId) { }
    public record Summary(Round round,AccountSummaryResponse currentAccount,boolean restartAvailable,Instant nextAvailableAt,String realizedPnl,String feesPaid,String settlementAdjustment) { }
    public record Restart(Long roundId,int roundNumber,String balance,Instant restartedAt,Instant nextAvailableAt,int canceledOrderCount,int closedPositionCount) { }
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final AccountLock locks;
    private final TradingAccountService summaries;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final TradingOrderRepository orders;
    private final TradingEvents events;
    private final EntityManager entities;
    public MemberRounds(JdbcTemplate jdbc,ObjectMapper mapper,AccountLock locks,TradingAccountService summaries,WalletRepository wallets,PositionRepository positions,TradingOrderRepository orders,TradingEvents events,EntityManager entities) {
        this.jdbc=jdbc;this.mapper=mapper;this.locks=locks;this.summaries=summaries;this.wallets=wallets;this.positions=positions;this.orders=orders;this.events=events;this.entities=entities;
    }
    @Transactional(propagation=Propagation.MANDATORY)
    public long begin(TradingAccount account,Wallet wallet,String funding,int number,Instant now) {
        return jdbc.queryForObject("insert into trading.member_trading_round(account_id,member_id,round_number,status,funding,initial_balance,started_at,start_realized_pnl,start_fees_paid,start_adjustment) values (?,?,?,'ACTIVE',?,10000,?,?,?,?) returning id",Long.class,
            account.getId(),account.getMemberId(),number,funding,at(now),wallet.getRealizedPnl(),wallet.getFeesPaid(),wallet.getSettlementAdjustment());
    }
    @Transactional(propagation=Propagation.MANDATORY)
    public void captureRetirement(Long accountId) {
        entities.flush();
        jdbc.update("insert into trading.member_round_retirement(position_id,round_id,remaining_quantity,remaining_entry_notional,released_margin) select id,round_id,quantity,entry_notional,margin from trading.position where account_id=? and status='OPEN' and round_id is not null on conflict(position_id) do nothing",accountId);
    }
    @Transactional(propagation=Propagation.MANDATORY)
    public void finish(Long accountId,Wallet wallet,String reason,Instant now) {
        entities.flush(); // Cancellation and position updates must commit in this same transaction.
        jdbc.update("update trading.member_trading_round set status='COMPLETED',ended_at=?,end_reason=?,final_wallet=jsonb_build_object('balance',?::text,'usedMargin',?::text,'reservedMargin',?::text,'realizedPnl',(?-start_realized_pnl)::text,'feesPaid',(?-start_fees_paid)::text,'settlementAdjustment',(?-start_adjustment)::text) where account_id=? and status='ACTIVE'",
            at(now),reason,wallet.getBalance().toPlainString(),wallet.getUsedMargin().toPlainString(),wallet.getReservedMargin().toPlainString(),wallet.getRealizedPnl(),wallet.getFeesPaid(),wallet.getSettlementAdjustment(),accountId);
    }
    @Transactional(timeout=10)
    public Restart restart(Long accountId,String key) {
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,100}")) throw new BusinessException(ErrorCode.INVALID_IDEMPOTENCY_KEY);
        var account=member(accountId);
        var previous=jdbc.query("select s.*,r.round_number from trading.member_restart s join trading.member_trading_round r on r.id=s.new_round_id where s.account_id=? and s.request_key=?",(r,n)->new Restart(r.getLong("new_round_id"),r.getInt("round_number"),"10000.000000000000000000",r.getTimestamp("restarted_at").toInstant(),r.getTimestamp("restarted_at").toInstant().plusSeconds(86400),r.getInt("canceled_order_count"),r.getInt("closed_position_count")),accountId,key);
        if(!previous.isEmpty()) return previous.get(0);
        Instant now=dbNow(),next=next(accountId);
        if(next!=null&&now.isBefore(next)) throw new RestartLimited(next);
        var old=currentRow(accountId);
        var wallet=wallets.findById(accountId).orElseThrow();
        BigDecimal before=wallet.getBalance(),released=BigDecimal.ZERO,reserved=BigDecimal.ZERO;
        var open=positions.findByAccountIdAndStatusOrderByIdAsc(accountId,Position.Status.OPEN);
        var byId=open.stream().collect(Collectors.toMap(Position::getId,p->p));
        var pending=orders.findByAccountIdAndStatusOrderByIdAsc(accountId,TradingOrder.Status.PENDING);
        for(var order:pending) {
            if(order.getAction()==TradingOrder.Action.OPEN) reserved=reserved.add(order.getReservedMargin());
            else byId.get(order.getPositionId()).releaseCloseReservation(order.getQuantity());
            order.cancelForMemberRestart(now);events.record(order,null);
        }
        captureRetirement(accountId);
        for(var position:open) released=released.add(position.closeForMemberRestart(now));
        wallet.releaseExposure(released,reserved);
        finish(accountId,wallet,"MEMBER_RESTART",now);
        wallet.restartMember();account.restartMember(now);
        long id=begin(account,wallet,"MEMBER_RESTART",old.roundNumber()+1,now);
        jdbc.update("insert into trading.member_restart(account_id,request_key,previous_round_id,new_round_id,balance_before,capital_adjustment,canceled_order_count,closed_position_count,restarted_at) values (?,?,?,?,?,?,?,?,?)",accountId,key,old.roundId(),id,before,new BigDecimal("10000").subtract(before),pending.size(),open.size(),at(now));
        return new Restart(id,old.roundNumber()+1,wallet.getBalance().toPlainString(),now,now.plusSeconds(86400),pending.size(),open.size());
    }
    @Transactional(timeout=5)
    public Summary current(Long accountId) {member(accountId);return summaryLocked(accountId,currentRow(accountId));}
    @Transactional(timeout=5)
    public Summary summary(Long accountId,Long roundId) {member(accountId);return summaryLocked(accountId,owned(accountId,roundId));}
    private Summary summaryLocked(Long accountId,Round round) {
        Instant next=next(accountId);boolean active=round.currentRound();
        var wallet=wallets.findById(accountId).orElseThrow();
        var baseline=jdbc.queryForMap("select start_realized_pnl,start_fees_paid,start_adjustment from trading.member_trading_round where id=?",round.roundId());
        return new Summary(round,active?summaries.summary(accountId):null,next==null||!dbNow().isBefore(next),next,
            active?wallet.getRealizedPnl().subtract((BigDecimal)baseline.get("start_realized_pnl")).toPlainString():round.finalWallet().path("realizedPnl").asText(),
            active?wallet.getFeesPaid().subtract((BigDecimal)baseline.get("start_fees_paid")).toPlainString():round.finalWallet().path("feesPaid").asText(),
            active?wallet.getSettlementAdjustment().subtract((BigDecimal)baseline.get("start_adjustment")).toPlainString():round.finalWallet().path("settlementAdjustment").asText());
    }
    @Transactional(timeout=5)
    public Page list(Long accountId,Long beforeId,int limit) {
        member(accountId);validate(beforeId,limit);
        var rows=rows("select * from trading.member_trading_round where account_id=? and id<? order by id desc limit ?",accountId,beforeId==null?Long.MAX_VALUE:beforeId,limit+1);
        var page=rows.stream().limit(limit).toList();return new Page(page,rows.size()>limit?page.get(page.size()-1).roundId():null);
    }
    @Transactional(timeout=5)
    public RoundLedger.Page<RoundLedger.Order> orders(Long accountId,Long roundId,Long beforeId,int limit) {return ledger(accountId,roundId,"orders",beforeId,limit,RoundLedger.Order.class);}
    @Transactional(timeout=5)
    public RoundLedger.Page<RoundLedger.Fill> fills(Long accountId,Long roundId,Long beforeId,int limit) {return ledger(accountId,roundId,"fills",beforeId,limit,RoundLedger.Fill.class);}
    @Transactional(timeout=5)
    public RoundLedger.Page<RoundLedger.Position> positions(Long accountId,Long roundId,Long beforeId,int limit) {return ledger(accountId,roundId,"positions",beforeId,limit,RoundLedger.Position.class);}
    private <T> RoundLedger.Page<T> ledger(Long accountId,Long roundId,String kind,Long beforeId,int limit,Class<T> type) {
        member(accountId);owned(accountId,roundId);validate(beforeId,limit);
        // All values remain decimal strings. No Entity/internal credential columns returned.
        String sql=switch(kind) {
            case "orders" -> "select id,round_id,position_id,trading_symbol_id,type,action,side,status,quantity::text,filled_price::text,limit_price::text,leverage,created_at,completed_at,reason from trading.trading_order where account_id=? and round_id=?";
            case "positions" -> "select p.id,p.round_id,p.trading_symbol_id,p.side,p.status,p.quantity::text,p.initial_quantity::text,p.entry_price::text,p.exit_price::text,p.realized_pnl::text,p.margin::text,p.leverage,p.opened_at,p.closed_at,p.close_reason,t.remaining_quantity::text retired_quantity,t.remaining_entry_notional::text retired_entry_notional,t.released_margin::text retired_margin from trading.position p left join trading.member_round_retirement t on t.position_id=p.id where p.account_id=? and p.round_id=?";
            case "fills" -> "select f.id,f.round_id,f.order_id,f.price::text,f.quantity::text,f.realized_pnl::text,f.fee::text,f.settlement_adjustment::text,f.executed_at from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=? and f.round_id=?";
            default -> throw new BusinessException(ErrorCode.INVALID_HISTORY_REQUEST);
        };
        String alias=kind.equals("fills")?"f.":kind.equals("positions")?"p.":"";
        var rows=jdbc.queryForList(sql+" and "+alias+"id<? order by "+alias+"id desc limit ?",accountId,roundId,beforeId==null?Long.MAX_VALUE:beforeId,limit+1);
        // Stable camelCase names and ISO timestamps are part of the API contract.
        var page=rows.stream().limit(limit).map(row->{Map<String,Object> item=new LinkedHashMap<>();row.forEach((k,v)->{
            StringBuilder name=new StringBuilder();boolean upper=false;for(char c:k.toCharArray()){if(c=='_')upper=true;else {name.append(upper?Character.toUpperCase(c):c);upper=false;}}
            item.put(name.toString(),v instanceof java.sql.Timestamp t?t.toInstant():v);
        });return item;}).toList();
        return new RoundLedger.Page<>(page.stream().map(row->mapper.convertValue(row,type)).toList(),rows.size()>limit?((Number)page.get(page.size()-1).get("id")).longValue():null);
    }
    private TradingAccount member(Long accountId) {
        var account=locks.lock(accountId);
        if(account.isGuestAccount()||account.getMemberId()==null) throw new BusinessException(ErrorCode.MEMBER_ACCOUNT_REQUIRED);
        return account;
    }
    private Round currentRow(Long accountId) {var rows=rows("select * from trading.member_trading_round where account_id=? and status='ACTIVE'",accountId);if(rows.isEmpty())throw new BusinessException(ErrorCode.ROUND_NOT_FOUND);return rows.get(0);}
    private Round owned(Long accountId,Long id) {var rows=rows("select * from trading.member_trading_round where account_id=? and id=?",accountId,id);if(rows.isEmpty())throw new BusinessException(ErrorCode.ROUND_NOT_FOUND);return rows.get(0);}
    private List<Round> rows(String sql,Object... args) {
        return jdbc.query(sql,(r,n)->{try{return new Round(r.getLong("id"),r.getInt("round_number"),r.getString("status"),r.getString("funding"),r.getString("initial_balance"),r.getTimestamp("started_at").toInstant(),r.getTimestamp("ended_at")==null?null:r.getTimestamp("ended_at").toInstant(),r.getString("end_reason"),r.getString("final_wallet")==null?null:mapper.readTree(r.getString("final_wallet")),r.getString("status").equals("ACTIVE"));}catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException("Invalid round snapshot",e);}},args);
    }
    private Instant next(Long id) {var time=jdbc.queryForObject("select max(restarted_at)+interval '24 hours' from trading.member_restart where account_id=?",java.sql.Timestamp.class,id);return time==null?null:time.toInstant();}
    private Instant dbNow() {return jdbc.queryForObject("select clock_timestamp()",java.sql.Timestamp.class).toInstant();}
    private static OffsetDateTime at(Instant value) {return value.atOffset(ZoneOffset.UTC);}
    private static void validate(Long before,int limit) {if(before!=null&&before<=0||limit<1||limit>100)throw new BusinessException(ErrorCode.INVALID_HISTORY_REQUEST);}
}
