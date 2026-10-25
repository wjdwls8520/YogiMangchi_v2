package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.*;
import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.*;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Journal dispatch and account progress are separate. A poison account never owns the global cursor. */
@Component
@ConditionalOnProperty(name="trading.risk-journal.enabled",havingValue="true",matchIfMissing=true)
public class DurableRiskWorker {
    // LATERAL LIMIT is per account, before status/due/hold filtering. A later job must never
    // overtake an earlier retry or HELD job. Materialization prevents a return to the full work scan.
    static final String READY_WORK="""
        with heads as materialized (
          select a.id account_id,w.event_id,w.status,w.next_attempt_at
          from trading.trading_account a cross join lateral (
            select event_id,status,next_attempt_at from trading.risk_account_work
            where account_id=a.id and status in ('PENDING','HELD') order by event_id limit 1
          ) w
        )
        select w.account_id,w.event_id,e.occurred_at,e.recorded_at
        from heads w join trading.risk_price_event e on e.id=w.event_id
        where w.status='PENDING' and w.next_attempt_at<=clock_timestamp()
          and not exists(select 1 from trading.risk_hold h where h.account_id=w.account_id and h.resolved_at is null and (h.event_id is null or h.event_id<=w.event_id) and not (%s))
        order by w.event_id,w.account_id limit 64
        """.formatted(RiskGapRecovery.AUTOMATIC_HOLD);
    private static final Logger log=LoggerFactory.getLogger(DurableRiskWorker.class);
    private final JdbcTemplate jdbc;private final ObjectMapper json;private final RiskWorkRunner runner;
    private final TradingEngineGate gate;private final RedisMarketDataBridge bridge;private final boolean enabled;
    private final ScheduledExecutorService executor=Executors.newSingleThreadScheduledExecutor(r -> {var t=new Thread(r,"durable-risk-worker");t.setDaemon(true);return t;});
    private boolean closed;
    private int failures;private long retryAfter;
    private long committedWork,maxReceiveCommitMs,maxWorkDelayMs,failedWork,lockTimeouts;
    private long readyQueries,readyQueryNanos,maxReadyQueryNanos,selectedWork;
    public record Measurements(long committedWork,long maxReceiveCommitMs,long maxWorkDelayMs,long failedWork,long lockTimeouts,long readyQueries,long readyQueryNanos,long maxReadyQueryNanos,long selectedWork) { }
    public synchronized Measurements measurements(){return new Measurements(committedWork,maxReceiveCommitMs,maxWorkDelayMs,failedWork,lockTimeouts,readyQueries,readyQueryNanos,maxReadyQueryNanos,selectedWork);}
    public DurableRiskWorker(JdbcTemplate jdbc,ObjectMapper json,RiskWorkRunner runner,TradingEngineGate gate,RedisMarketDataBridge bridge,@Value("${trading.trigger.enabled:true}")boolean enabled) {
        this.jdbc=jdbc;this.json=json;this.runner=runner;this.gate=gate;this.bridge=bridge;this.enabled=enabled;
    }
    @EventListener(ApplicationReadyEvent.class) public void start(){if(enabled)executor.scheduleWithFixedDelay(this::pump,0,50,TimeUnit.MILLISECONDS);}
    private void pump() {
        if(System.nanoTime()<retryAfter)return;
        try{runOnce();failures=0;}
        catch(Exception failure) {
            gate.recovering();failures=Math.min(6,failures+1);int seconds=Math.min(30,1<<(failures-1));
            retryAfter=System.nanoTime()+TimeUnit.SECONDS.toNanos(seconds);
            log.warn("[Risk worker] journal unavailable retrySeconds={} cause={}",seconds,failure.getClass().getSimpleName());
        }
    }
    public synchronized void runOnce() throws Exception {
        if(closed)return;
        var checkpoint=jdbc.queryForMap("select event_id,price_book from trading.risk_dispatch_cursor where id=1");
        long cursor=((Number)checkpoint.get("event_id")).longValue();
        Map<Long,LatestMarkPrice> book=json.readValue(checkpoint.get("price_book").toString(),new TypeReference<HashMap<Long,LatestMarkPrice>>(){});
        if(book==null)throw new IllegalStateException("Invalid risk checkpoint");
        var events=jdbc.queryForList("select id,kind,payload from trading.risk_price_event where id>? order by id limit 256",cursor);
        for(var row:events) {
            var event=json.readValue(row.get("payload").toString(),MarketDataEvent.class);
            if("PRICE".equals(row.get("kind")))book.put(event.price().tradingSymbolId(),event.price());else event.tradingSymbolIds().forEach(book::remove);
            cursor=((Number)row.get("id")).longValue();
        }
        jdbc.update("update trading.risk_dispatch_cursor set event_id=?,price_book=?::jsonb where id=1",cursor,json.writeValueAsString(book));
        gate.processed(book,bridge.health().gapSequence());
        long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(250);
        boolean progressed;
        do {
            long queryStarted=System.nanoTime();
            var jobs=jdbc.queryForList(READY_WORK);
            long queryNanos=System.nanoTime()-queryStarted;
            readyQueries++;readyQueryNanos+=queryNanos;maxReadyQueryNanos=Math.max(maxReadyQueryNanos,queryNanos);selectedWork+=jobs.size();
            progressed=false;
            for(var job:jobs) {
                long account=((Number)job.get("account_id")).longValue(),event=((Number)job.get("event_id")).longValue();
                try {
                    if(runner.process(account,event)) {
                        // The transactional proxy has returned: the financial transaction and DONE are committed.
                        var committed=java.time.Instant.now();committedWork++;progressed=true;
                        maxReceiveCommitMs=Math.max(maxReceiveCommitMs,java.time.Duration.between(((java.sql.Timestamp)job.get("occurred_at")).toInstant(),committed).toMillis());
                        maxWorkDelayMs=Math.max(maxWorkDelayMs,java.time.Duration.between(((java.sql.Timestamp)job.get("recorded_at")).toInstant(),committed).toMillis());
                    }
                } catch(Exception failure) {
                    progressed=true;failedWork++;if(failure instanceof org.springframework.dao.PessimisticLockingFailureException)lockTimeouts++;
                    String code=failure instanceof com.yogimangchi.trading.error.BusinessException b?b.getCode().name():failure instanceof org.springframework.dao.PessimisticLockingFailureException?"ACCOUNT_LOCK_TIMEOUT":"PROCESSING_FAILURE";
                    runner.failed(account,event,code);log.warn("[Risk worker] account={} event={} code={}",account,event,code);
                }
                if(System.nanoTime()>=deadline)break;
            }
        } while(progressed&&System.nanoTime()<deadline);
    }
    @PreDestroy public synchronized void close(){closed=true;gate.recovering();executor.shutdownNow();}
}
