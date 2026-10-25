package com.yogimangchi.trading.execution.recovery;

import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import jakarta.persistence.EntityManager;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.*;

/** Simulation policy: replay observed prices, acknowledge missing history, never invent executions. */
@Component
@Transactional(propagation=Propagation.MANDATORY)
public class RiskGapRecovery {
    static final String REASONS="'PROVIDER_CONTINUITY_UNKNOWN','UNOBSERVED_PRICE_INTERVAL','POSTGRES_INGRESS_INTERRUPTED'";
    static final String AUTOMATIC_HOLD="h.reason in ("+REASONS+") and h.trading_symbol_id is not null and h.event_id is not null";
    private static final Set<String> AUTOMATIC_REASONS=Set.of("PROVIDER_CONTINUITY_UNKNOWN","UNOBSERVED_PRICE_INTERVAL","POSTGRES_INGRESS_INTERRUPTED");
    private final JdbcTemplate jdbc;
    private final EntityManager entities;
    private final LatestPriceStore prices;
    private final LedgerReconciler ledger;

    public RiskGapRecovery(JdbcTemplate jdbc,EntityManager entities,LatestPriceStore prices,LedgerReconciler ledger) {
        this.jdbc=jdbc;this.entities=entities;this.prices=prices;this.ledger=ledger;
    }
    public static boolean automatic(String reason,Long symbol,Long event) {
        return symbol!=null&&event!=null&&AUTOMATIC_REASONS.contains(reason);
    }
    public record Decision(boolean allowed,boolean continuity) { }
    private record Hold(long id,Long symbol,Long event,String reason,Long gap,Long validated) {
        boolean automatic(){return RiskGapRecovery.automatic(reason,symbol,event);}
    }
    private List<Hold> holds(long account) {
        return jdbc.query("""
            select id,trading_symbol_id,event_id,reason,
              coalesce((evidence->>'latestGapEventId')::bigint,event_id) gap,
              (evidence->>'replayValidatedGapEventId')::bigint validated
            from trading.risk_hold where account_id=? and resolved_at is null order by id
            """,(r,n)->new Hold(r.getLong(1),r.getObject(2,Long.class),r.getObject(3,Long.class),r.getString(4),r.getObject(5,Long.class),r.getObject(6,Long.class)),account);
    }
    /** The caller owns both the ingress fence and account lock. Failed reconciliation commits a hold. */
    public Decision beforeReplay(long account,long event) {
        var holds=holds(account);
        var blocking=holds.stream().filter(h->h.event()==null||h.event()<=event).toList();
        boolean continuity=holds.stream().anyMatch(Hold::automatic);
        if(blocking.stream().anyMatch(h->!h.automatic()))return new Decision(false,continuity);
        if(blocking.stream().anyMatch(h->!Objects.equals(h.gap(),h.validated()))) {
            if(!matched(account))return new Decision(false,continuity);
            for(var hold:blocking)jdbc.update("""
                update trading.risk_hold set evidence=evidence||jsonb_build_object(
                  'replayPolicy','OBSERVED_MARK_ONLY_V1','replayValidatedGapEventId',?::bigint)
                where id=? and resolved_at is null
                """,hold.gap(),hold.id());
        }
        return new Decision(true,continuity);
    }
    /** Resolving the hold, reconciliation, the final observed Fill and DONE share one commit. */
    public void finishIfDrained(long account) {
        var holds=holds(account);
        if(holds.isEmpty()||holds.stream().anyMatch(h->!h.automatic()))return;
        if(Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from trading.risk_account_work where account_id=? and status in ('PENDING','HELD'))",Boolean.class,account)))return;
        var snapshots=prices.findAll(holds.stream().map(Hold::symbol).toList());
        var heads=new HashMap<Long,Long>();
        for(var hold:holds) {
            var snapshot=snapshots.get(hold.symbol());
            if(snapshot.status()!=LatestPriceStore.Status.FRESH)return;
            var price=snapshot.latestPrice().orElseThrow();
            var rows=jdbc.queryForList("select event_id,event_time,received_at from trading.risk_price_head where trading_symbol_id=?",hold.symbol());
            if(rows.isEmpty())return;
            var head=rows.get(0);long id=((Number)head.get("event_id")).longValue();
            // The cache may be ahead of its ingress transaction. Only a committed matching head qualifies.
            if(id<=hold.gap()||!sameInstant((java.sql.Timestamp)head.get("event_time"),price.eventTime())
                ||!sameInstant((java.sql.Timestamp)head.get("received_at"),price.receivedAt()))return;
            heads.put(hold.symbol(),id);
        }
        if(!matched(account))return;
        for(var hold:holds)jdbc.update("""
            update trading.risk_hold set resolved_at=clock_timestamp(),resolution_reference=?,
              evidence=evidence||jsonb_build_object('resumePolicy','OBSERVED_MARK_ONLY_V1',
                'resumedThroughEventId',?::bigint,'ledgerStatus','MATCHED','unobservedCrossingsReconstructed',false)
            where id=? and resolved_at is null
            ""","AUTO_OBSERVED_MARK_V1:event="+heads.get(hold.symbol())+":ledger=MATCHED",heads.get(hold.symbol()),hold.id());
    }
    private boolean matched(long account) {
        entities.flush();
        var result=ledger.checkInTransaction(account);
        if(result.status().equals("MATCHED"))return true;
        if(result.status().equals("UNVERIFIED"))jdbc.update("""
            insert into trading.risk_hold(account_id,reason,evidence)
            values(?,'RECOVERY_LEDGER_UNVERIFIED','{"policy":"MANUAL_REVIEW_REQUIRED"}'::jsonb) on conflict do nothing
            """,account);
        return false;
    }
    private static boolean sameInstant(java.sql.Timestamp stored,java.time.Instant live) {
        // PostgreSQL rounds timestamptz to microseconds; the Java ingress clock has nanoseconds.
        return java.time.Duration.between(stored.toInstant(),live).abs().compareTo(java.time.Duration.ofNanos(1000))<0;
    }
}
