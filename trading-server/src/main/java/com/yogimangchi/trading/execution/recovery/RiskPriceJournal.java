package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.*;
import java.time.*;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Commit accepted event and per-account work before acknowledging the ingress callback. */
@Component
@ConditionalOnProperty(name="trading.risk-journal.enabled",havingValue="true",matchIfMissing=true)
public class RiskPriceJournal {
    private final JdbcTemplate jdbc;private final ObjectMapper json;private final RiskAdmission admission;private final TransactionTemplate tx;
    private boolean broken;
    private final Set<Long> unrecordedSymbols=new HashSet<>();
    private Instant lostSince;
    public RiskPriceJournal(JdbcTemplate jdbc,ObjectMapper json,RiskAdmission admission,PlatformTransactionManager transactions) {
        this.jdbc=jdbc;this.json=json;this.admission=admission;tx=new TransactionTemplate(transactions);tx.setPropagationBehavior(3);tx.setTimeout(2);
    }
    @EventListener @Order(-100)
    public synchronized void receive(MarketDataEvent event) {
        try {
            tx.executeWithoutResult(status -> {
                jdbc.execute("SET LOCAL lock_timeout='1s'");jdbc.execute("SET LOCAL statement_timeout='1500ms'");
                jdbc.queryForList("select pg_advisory_xact_lock(?)",RiskAdmission.INGRESS_LOCK);
                if(broken)recordGap(MarketDataEvent.state(MarketDataEvent.Type.UNAVAILABLE,Set.copyOf(unrecordedSymbols),lostSince),"INGRESS_GAP","POSTGRES_INGRESS_INTERRUPTED");
                if(event.type()==MarketDataEvent.Type.PRICE) {
                    var tick=event.price();
                    var previous=jdbc.queryForList("select received_at,event_time from trading.risk_price_head where trading_symbol_id=?",tick.tradingSymbolId());
                    if(!previous.isEmpty()) {
                        Instant time=((java.sql.Timestamp)previous.get(0).get("event_time")).toInstant();
                        if(!tick.eventTime().isAfter(time))return;
                        Instant received=((java.sql.Timestamp)previous.get(0).get("received_at")).toInstant();
                        if(tick.receivedAt().isAfter(received.plus(MarkPriceTimePolicy.FRESH_FOR))) recordGap(event,"INGRESS_GAP","UNOBSERVED_PRICE_INTERVAL");
                    }
                    long id=insert(event,event.type().name(),event.eventId());
                    jdbc.update("insert into trading.risk_price_head(trading_symbol_id,event_id,received_at,event_time) values(?,?,?,?) on conflict(trading_symbol_id) do update set event_id=excluded.event_id,received_at=excluded.received_at,event_time=excluded.event_time",tick.tradingSymbolId(),id,at(tick.receivedAt()),at(tick.eventTime()));
                    // All existing exposure and all pending orders, not just crossed orders: an earlier queued
                    // event can fill a pending entry before this event reaches that account.
                    jdbc.update("""
                        insert into trading.risk_account_work(event_id,account_id,round_id,guest_generation)
                        select ?,a.id,r.id,(select max(g.id) from trading.guest_retry g where g.account_id=a.id)
                        from trading.trading_account a left join trading.member_trading_round r on r.account_id=a.id and r.status='ACTIVE'
                        where a.status in ('ACTIVE','BANKRUPT') and a.id in (
                          select account_id from trading.position where status='OPEN' and trading_symbol_id=?
                          union select account_id from trading.trading_order where status='PENDING' and trading_symbol_id=?
                          union select account_id from trading.risk_hold h where resolved_at is null and trading_symbol_id=? and (%s))
                        on conflict do nothing
                        """.formatted(RiskGapRecovery.AUTOMATIC_HOLD),id,tick.tradingSymbolId(),tick.tradingSymbolId(),tick.tradingSymbolId());
                } else recordGap(event,event.type().name(),"PROVIDER_CONTINUITY_UNKNOWN");
            });
            broken=false;unrecordedSymbols.clear();lostSince=null;admission.recordedIngress();
        } catch(RuntimeException failure) {
            broken=true;unrecordedSymbols.addAll(event.tradingSymbolIds());
            if(lostSince==null||event.occurredAt().isBefore(lostSince))lostSince=event.occurredAt();
            admission.failedIngress();throw failure;
        }
    }
    private void recordGap(MarketDataEvent event,String kind,String reason) {
        long id=insert(event,kind,event.eventId()+":"+kind);
        for(long symbol:event.tradingSymbolIds())jdbc.update("""
            insert into trading.risk_hold(account_id,trading_symbol_id,event_id,reason,evidence)
            select a.id,?,?,?,jsonb_build_object('eventId',?,'occurredAt',?::text,'policy','OBSERVED_MARK_ONLY_V1','latestGapEventId',?::bigint)
            from trading.trading_account a where a.status='ACTIVE' and a.id in (
              select account_id from trading.position where status='OPEN' and trading_symbol_id=?
              union select account_id from trading.trading_order where status='PENDING' and trading_symbol_id=?)
            on conflict(account_id,(coalesce(trading_symbol_id,0)),reason) where resolved_at is null
            do update set evidence=risk_hold.evidence||jsonb_build_object(
              'latestGapEventId',excluded.event_id,'latestGapAt',excluded.evidence->>'occurredAt')
            """,symbol,id,reason,id,event.occurredAt().toString(),id,symbol,symbol);
    }
    private long insert(MarketDataEvent event,String kind,String key) {
        try {return jdbc.queryForObject("insert into trading.risk_price_event(event_key,kind,payload,occurred_at) values(?,?,?::jsonb,?) on conflict(event_key) do update set event_key=excluded.event_key returning id",Long.class,key,kind,json.writeValueAsString(event),at(event.occurredAt()));}
        catch(com.fasterxml.jackson.core.JsonProcessingException failure){throw new IllegalStateException("Risk event encoding failed",failure);}
    }
    private static OffsetDateTime at(Instant t){return t.atOffset(ZoneOffset.UTC);}
}
