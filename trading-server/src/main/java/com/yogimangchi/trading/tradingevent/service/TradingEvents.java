package com.yogimangchi.trading.tradingevent.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.fill.entity.Fill;
import com.yogimangchi.trading.order.dto.OrderResponse;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.tradingevent.dto.TradingEventResponse;
import java.time.*;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.transaction.support.*;

/** PostgreSQL is the event source. The in-process dirty flag only reduces polling latency. */
@Service
public class TradingEvents {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final Map<Long,AtomicBoolean> watchers=new ConcurrentHashMap<>();
    public TradingEvents(JdbcTemplate jdbc,ObjectMapper mapper) { this.jdbc=jdbc; this.mapper=mapper; }

    @Transactional(propagation=Propagation.MANDATORY)
    public void record(TradingOrder order,Fill fill) {
        String type=order.getAction()==TradingOrder.Action.LIQUIDATE ? "POSITION_LIQUIDATED" : switch(order.getStatus()) {
            case PENDING -> "ORDER_PENDING"; case FILLED -> "ORDER_FILLED";
            case CANCELED -> "ORDER_CANCELED"; case REJECTED -> "ORDER_REJECTED";
        };
        String payload;
        try { payload=mapper.writeValueAsString(OrderResponse.from(order,fill)); }
        catch(JsonProcessingException e) { throw new IllegalStateException("Cannot retain trading event snapshot",e); }
        Instant time=order.getCompletedAt()==null ? order.getCreatedAt() : order.getCompletedAt();
        jdbc.update("insert into trading.trading_event(account_id,order_id,order_status,event_type,payload,occurred_at) values (?,?,?,?,cast(? as jsonb),?) on conflict(order_id,order_status) do nothing",
                order.getAccountId(),order.getId(),order.getStatus().name(),type,payload,time.atOffset(ZoneOffset.UTC));
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                var signal=watchers.get(order.getAccountId());
                if(signal!=null) signal.set(true);
            }
        });
    }

    public void watch(long accountId) { watchers.computeIfAbsent(accountId,id -> new AtomicBoolean(true)); }
    public void unwatch(long accountId) { watchers.remove(accountId); }
    public boolean consumeDirty(long accountId) {
        var signal=watchers.get(accountId);
        return signal!=null && signal.getAndSet(false);
    }

    @Transactional(readOnly=true, timeout=3)
    public List<TradingEventResponse> after(long accountId,long afterId,int limit) {
        if(afterId<0 || limit<1 || limit>100) throw new BusinessException(ErrorCode.INVALID_HISTORY_REQUEST);
        if(Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from trading.trading_account where id=? and status='WITHDRAWN')",Boolean.class,accountId)))
            throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        return jdbc.query("select id,event_type,payload,occurred_at from trading.trading_event where account_id=? and id>? order by id limit ?",(r,row) -> {
            try { return new TradingEventResponse(Long.toString(r.getLong("id")),r.getString("event_type"),r.getTimestamp("occurred_at").toInstant(),mapper.readValue(r.getString("payload"),OrderResponse.class)); }
            catch(JsonProcessingException e) { throw new IllegalStateException("Invalid retained trading event snapshot",e); }
        },accountId,afterId,limit);
    }
}
