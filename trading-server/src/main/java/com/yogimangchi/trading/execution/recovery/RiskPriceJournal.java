package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
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
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(RiskPriceJournal.class);
    private static final long EXPOSURE_SAFETY_REFRESH_NANOS = TimeUnit.SECONDS.toNanos(15);
    private static final String EXPOSED_SYMBOLS_SQL = """
        select distinct trading_symbol_id from (
            select p.trading_symbol_id
            from trading.position p
            join trading.trading_account a on a.id = p.account_id
            where p.status = 'OPEN'
              and a.status = 'ACTIVE'
              and (not a.guest_account or a.credential_expires_at > clock_timestamp())
            union
            select o.trading_symbol_id
            from trading.trading_order o
            join trading.trading_account a on a.id = o.account_id
            where o.status = 'PENDING'
              and a.status = 'ACTIVE'
              and (not a.guest_account or a.credential_expires_at > clock_timestamp())
            union
            select h.trading_symbol_id
            from trading.risk_hold h
            join trading.trading_account a on a.id = h.account_id
            where h.resolved_at is null
              and h.trading_symbol_id is not null
              and a.status = 'ACTIVE'
              and (not a.guest_account or a.credential_expires_at > clock_timestamp())
        ) exposed
        """;

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final RiskAdmission admission;
    private final TransactionTemplate tx;
    private final DurableRiskWorker worker;
    private final TradingEngineGate gate;
    private final RedisMarketDataBridge bridge;
    private final boolean skipIdleSymbols;
    private boolean broken;
    private final Set<Long> unrecordedSymbols=new HashSet<>();
    private Instant lostSince;
    private volatile Set<Long> activeExposedSymbols = Set.of();
    private volatile long lastExposureRefreshNanos = 0L;
    private final ConcurrentHashMap<Long, Instant> observedReceivedAt = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Long, Instant> observedEventTime = new ConcurrentHashMap<>();

    public RiskPriceJournal(JdbcTemplate jdbc,ObjectMapper json,RiskAdmission admission,PlatformTransactionManager transactions) {
        this(jdbc,json,admission,transactions,null,null,null,false);
    }
    public RiskPriceJournal(JdbcTemplate jdbc,ObjectMapper json,RiskAdmission admission,PlatformTransactionManager transactions,@org.springframework.lang.Nullable DurableRiskWorker worker) {
        this(jdbc,json,admission,transactions,worker,null,null,false);
    }
    @org.springframework.beans.factory.annotation.Autowired
    public RiskPriceJournal(
            JdbcTemplate jdbc,
            ObjectMapper json,
            RiskAdmission admission,
            PlatformTransactionManager transactions,
            @org.springframework.lang.Nullable DurableRiskWorker worker,
            @org.springframework.lang.Nullable TradingEngineGate gate,
            @org.springframework.lang.Nullable RedisMarketDataBridge bridge,
            @Value("${trading.risk-journal.skip-idle-symbols:true}") boolean skipIdleSymbols) {
        this.jdbc=jdbc;this.json=json;this.admission=admission;this.worker=worker;
        this.gate=gate;this.bridge=bridge;
        // Per-symbol idle skip requires gate+bridge to keep requireCaughtUp coherent without DB writes.
        this.skipIdleSymbols = skipIdleSymbols && gate != null && bridge != null;
        tx=new TransactionTemplate(transactions);tx.setPropagationBehavior(3);tx.setTimeout(2);
    }

    @EventListener @Order(-100)
    public synchronized void receive(MarketDataEvent event) {
        try {
            if (skipIdleSymbols && !broken && event.type() == MarketDataEvent.Type.PRICE) {
                var tick = event.price();
                long symbolId = tick.tradingSymbolId();
                Instant prevObservedEvent = observedEventTime.get(symbolId);
                if (prevObservedEvent != null && !tick.eventTime().isAfter(prevObservedEvent)) {
                    return;
                }
                if (!isSymbolExposed(symbolId)) {
                    observedReceivedAt.put(symbolId, tick.receivedAt());
                    observedEventTime.put(symbolId, tick.eventTime());
                    gate.markIdleSymbolProcessed(tick, bridge.health().gapSequence());
                    admission.recordedIngress();
                    return;
                }
                gate.clearIdleSymbol(symbolId);
            }

            tx.executeWithoutResult(status -> {
                jdbc.execute("SET LOCAL lock_timeout='1s'");jdbc.execute("SET LOCAL statement_timeout='1500ms'");
                jdbc.queryForList("select pg_advisory_xact_lock(?)",RiskAdmission.INGRESS_LOCK);
                if(broken) {
                    observedReceivedAt.clear();
                    observedEventTime.clear();
                    recordGap(MarketDataEvent.state(MarketDataEvent.Type.UNAVAILABLE,Set.copyOf(unrecordedSymbols),lostSince),"INGRESS_GAP","POSTGRES_INGRESS_INTERRUPTED");
                }
                if(event.type()==MarketDataEvent.Type.PRICE) {
                    var tick=event.price();
                    long symbolId = tick.tradingSymbolId();
                    var previous=jdbc.queryForList("select received_at,event_time from trading.risk_price_head where trading_symbol_id=?",symbolId);
                    if(!previous.isEmpty()) {
                        Instant time=((java.sql.Timestamp)previous.get(0).get("event_time")).toInstant();
                        if(!tick.eventTime().isAfter(time))return;
                        Instant dbReceived=((java.sql.Timestamp)previous.get(0).get("received_at")).toInstant();
                        Instant memReceived = skipIdleSymbols ? observedReceivedAt.get(symbolId) : null;
                        Instant latestContinuousReceived = (memReceived != null && memReceived.isAfter(dbReceived))
                                ? memReceived : dbReceived;
                        if(tick.receivedAt().isAfter(latestContinuousReceived.plus(MarkPriceTimePolicy.FRESH_FOR))) {
                            recordGap(event,"INGRESS_GAP","UNOBSERVED_PRICE_INTERVAL");
                        }
                    }
                    long id=insert(event,event.type().name(),event.eventId());
                    jdbc.update("insert into trading.risk_price_head(trading_symbol_id,event_id,received_at,event_time) values(?,?,?,?) on conflict(trading_symbol_id) do update set event_id=excluded.event_id,received_at=excluded.received_at,event_time=excluded.event_time",symbolId,id,at(tick.receivedAt()),at(tick.eventTime()));
                    // All existing exposure and all pending orders, not just crossed orders: an earlier queued
                    // event can fill a pending entry before this event reaches that account.
                    jdbc.update("""
                        insert into trading.risk_account_work(event_id,account_id,round_id,guest_generation)
                        select ?,a.id,r.id,(select max(g.id) from trading.guest_retry g where g.account_id=a.id)
                        from trading.trading_account a left join trading.member_trading_round r on r.account_id=a.id and r.status='ACTIVE'
                        where a.status='ACTIVE'
                          and (not a.guest_account or a.credential_expires_at > clock_timestamp())
                          and a.id in (
                          select account_id from trading.position where status='OPEN' and trading_symbol_id=?
                          union select account_id from trading.trading_order where status='PENDING' and trading_symbol_id=?
                          union select account_id from trading.risk_hold h where resolved_at is null and trading_symbol_id=? and (%s))
                        on conflict do nothing
                        """.formatted(RiskGapRecovery.AUTOMATIC_HOLD),id,symbolId,symbolId,symbolId);
                    observedReceivedAt.put(symbolId, tick.receivedAt());
                    observedEventTime.put(symbolId, tick.eventTime());
                } else {
                    for (Long sym : event.tradingSymbolIds()) {
                        observedReceivedAt.remove(sym);
                        observedEventTime.remove(sym);
                    }
                    admission.markExposureDirty();
                    recordGap(event,event.type().name(),"PROVIDER_CONTINUITY_UNKNOWN");
                }
            });
            broken=false;unrecordedSymbols.clear();lostSince=null;admission.recordedIngress();if(worker!=null)worker.nudge();
        } catch(RuntimeException failure) {
            broken=true;unrecordedSymbols.addAll(event.tradingSymbolIds());
            observedReceivedAt.clear();
            observedEventTime.clear();
            if(lostSince==null||event.occurredAt().isBefore(lostSince))lostSince=event.occurredAt();
            admission.failedIngress();log.warn("[Risk journal] ingress failed type={} cause={} sqlState={}",event.type(),failure.getClass().getSimpleName(),RiskAdmission.sqlState(failure));throw failure;
        }
    }

    /**
     * Checks per-symbol exposure with zero DB write I/O on idle symbols.
     * Refreshes inside a short shared ingress fence whenever any trading transaction mutated state
     * or every 15s as a safety sweep, guaranteeing a newly opened position/order is never missed.
     */
    private boolean isSymbolExposed(long symbolId) {
        long now = System.nanoTime();
        boolean stale = lastExposureRefreshNanos == 0L || (now - lastExposureRefreshNanos) >= EXPOSURE_SAFETY_REFRESH_NANOS;
        if (admission.isExposureDirty() || stale) {
            refreshExposedSymbols();
        }
        return activeExposedSymbols.contains(symbolId);
    }

    private void refreshExposedSymbols() {
        Set<Long> refreshed = tx.execute(status -> {
            jdbc.execute("SET LOCAL lock_timeout='1s'");
            jdbc.execute("SET LOCAL statement_timeout='1500ms'");
            // Exclusive ingress fence waits for any in-flight trading transaction to commit before reading exposure.
            jdbc.queryForList("select pg_advisory_xact_lock(?)", RiskAdmission.INGRESS_LOCK);
            admission.consumeExposureDirty();
            List<Long> ids = jdbc.query(EXPOSED_SYMBOLS_SQL, (rs, n) -> rs.getLong(1));
            return ids.isEmpty() ? Set.<Long>of() : Set.copyOf(ids);
        });
        activeExposedSymbols = refreshed != null ? refreshed : Set.of();
        lastExposureRefreshNanos = System.nanoTime();
    }
    private void recordGap(MarketDataEvent event,String kind,String reason) {
        long id=insert(event,kind,event.eventId()+":"+kind);
        for(long symbol:event.tradingSymbolIds())jdbc.update("""
            insert into trading.risk_hold(account_id,trading_symbol_id,event_id,reason,evidence)
            select a.id,?,?,?,jsonb_build_object('eventId',?,'occurredAt',?::text,'policy','OBSERVED_MARK_ONLY_V1','latestGapEventId',?::bigint)
            from trading.trading_account a where a.status='ACTIVE'
              and (not a.guest_account or a.credential_expires_at > clock_timestamp())
              and a.id in (
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
