package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.execution.trigger.AccountTriggerService;
import com.yogimangchi.trading.marketdata.MarketDataEvent;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RiskWorkRunner {
    private final JdbcTemplate jdbc;private final ObjectMapper json;private final AccountLock locks;
    private final AccountTriggerService trigger;private final RiskAdmission admission;private final RiskGapRecovery gaps;
    public RiskWorkRunner(JdbcTemplate jdbc,ObjectMapper json,AccountLock locks,AccountTriggerService trigger,RiskAdmission admission,RiskGapRecovery gaps) {
        this.jdbc=jdbc;this.json=json;this.locks=locks;this.trigger=trigger;this.admission=admission;this.gaps=gaps;
    }
    @Transactional(timeout=5)
    public boolean process(long accountId,long eventId) {return processPrefix(accountId,eventId,1)>0;}
    /** A bounded prefix shares loaded exposure and one commit; no price or work row is discarded. */
    @Transactional(timeout=5)
    public int processBatch(long accountId,long eventId) {return processPrefix(accountId,eventId,8);}
    private int processPrefix(long accountId,long eventId,int limit) {
        admission.enterTransaction();var account=locks.lockIncludingWithdrawn(accountId);
        var jobs=jdbc.queryForList("""
            select w.*,e.payload,w.next_attempt_at<=clock_timestamp() due
            from trading.risk_account_work w join trading.risk_price_event e on e.id=w.event_id
            where w.account_id=? and w.event_id>=? and w.status in ('PENDING','HELD')
            order by w.event_id limit ? for update of w
            """,accountId,eventId,limit);
        if(jobs.isEmpty()||((Number)jobs.get(0).get("event_id")).longValue()!=eventId)return 0;
        boolean earlier=Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from trading.risk_account_work where account_id=? and event_id<? and status in ('PENDING','HELD'))",Boolean.class,accountId,eventId));
        if(earlier)return 0;
        Long activeRound=jdbc.queryForObject("select max(id) from trading.member_trading_round where account_id=? and status='ACTIVE'",Long.class,accountId);
        Long generation=jdbc.queryForObject("select max(id) from trading.guest_retry where account_id=?",Long.class,accountId);
        var prices=new ArrayList<com.yogimangchi.trading.marketdata.LatestMarkPrice>();
        var completed=new ArrayList<Object[]>();int retired=0;boolean continuity=false;
        for(var job:jobs) {
            if(!"PENDING".equals(job.get("status"))||!Boolean.TRUE.equals(job.get("due")))break;
            long id=((Number)job.get("event_id")).longValue();
            if(account.getStatus()==TradingAccount.Status.WITHDRAWN) {complete(accountId,id,"RETIRED","MEMBER_WITHDRAWAL");retired++;continue;}
            if(!Objects.equals(activeRound,job.get("round_id"))||!Objects.equals(generation,job.get("guest_generation"))) {
                complete(accountId,id,"RETIRED","LIFECYCLE_CHANGED");retired++;continue;
            }
            var recovery=gaps.beforeReplay(accountId,id);
            if(!recovery.allowed())break;
            continuity|=recovery.continuity();
            try {prices.add(json.readValue(job.get("payload").toString(),MarketDataEvent.class).price());}
            catch(com.fasterxml.jackson.core.JsonProcessingException failure){throw new IllegalStateException("Invalid recorded risk event",failure);}
            completed.add(new Object[]{accountId,id});
        }
        if(!prices.isEmpty()) {
            trigger.processRecorded(new RiskReplayPermit(accountId,prices));
            jdbc.batchUpdate("update trading.risk_account_work set status='DONE',completed_at=clock_timestamp(),completion_reason='PROCESSED' where account_id=? and event_id=?",completed);
        }
        if(continuity)gaps.finishIfDrained(accountId);
        return retired+completed.size();
    }
    private void complete(long account,long event,String status,String reason) {
        jdbc.update("update trading.risk_account_work set status=?,completed_at=clock_timestamp(),completion_reason=? where account_id=? and event_id=?",status,reason,account,event);
    }
    /** Called after the financial transaction rolls back; its durable evidence must survive that rollback. */
    @Transactional(timeout=5)
    public void failed(long accountId,long eventId,String code) {
        jdbc.execute("SET LOCAL lock_timeout='250ms'");
        jdbc.execute("SET LOCAL statement_timeout='1s'");
        var rows=jdbc.queryForList("select attempts,retry_limit,status from trading.risk_account_work where account_id=? and event_id=? for update",accountId,eventId);
        if(rows.isEmpty()||!"PENDING".equals(rows.get(0).get("status")))return;
        int attempt=((Number)rows.get(0).get("attempts")).intValue()+1;
        int limit=((Number)rows.get(0).get("retry_limit")).intValue();
        jdbc.update("insert into trading.risk_work_attempt(account_id,event_id,attempt_number,error_code) values(?,?,?,?)",accountId,eventId,attempt,code);
        jdbc.update("update trading.risk_account_work set attempts=?,status=?,next_attempt_at=clock_timestamp()+make_interval(secs=>?) where account_id=? and event_id=?",attempt,attempt>=limit?"HELD":"PENDING",Math.min(30,1<<Math.min(attempt,4)),accountId,eventId);
        if(attempt>=limit)jdbc.update("""
            insert into trading.risk_hold(account_id,event_id,reason,evidence)
            values(?,?,'RISK_PROCESSING_FAILED',jsonb_build_object('eventId',?,'attempts',?,'code',?::text)) on conflict do nothing
            """,accountId,eventId,eventId,attempt,code);
    }
}
