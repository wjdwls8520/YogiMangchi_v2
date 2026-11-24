package com.yogimangchi.trading.execution.recovery;

import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import java.nio.file.*;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties={"trading.risk-journal.enabled=true","trading.trigger.enabled=false","trading.reconciliation.enabled=false","trading.guest-cleanup.enabled=false","binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(DurableRiskIntegrationTests.Infrastructure.class)
class RiskBacklogIntegrationTests {
    @Autowired TradingAccountService accounts;
    @Autowired JdbcTemplate jdbc;
    @Test void heldHistoryDoesNotIncreaseHealthyHeadSelectionCost()throws Exception{
        seedHeldHistory();
        long first=accounts.createGuest().accountId(),second=accounts.createGuest().accountId();
        long event=jdbc.queryForObject("select max(id) from trading.risk_price_event",Long.class);
        jdbc.update("insert into trading.risk_account_work(account_id,event_id) values(?,?),(?,?)",first,event,second,event);
        String plan=jdbc.queryForObject("explain(analyze,buffers,format json) "+DurableRiskWorker.READY_WORK,String.class);
        Files.createDirectories(Path.of(".gradle"));Files.writeString(Path.of(".gradle/backlog-after-plan.json"),plan);
        assertThat(jdbc.queryForList(DurableRiskWorker.READY_WORK)).filteredOn(row->((Number)row.get("account_id")).longValue()==first||((Number)row.get("account_id")).longValue()==second).hasSize(2);
        assertThat(plan).contains("risk_work_unresolved_head");
        var document=new com.fasterxml.jackson.databind.ObjectMapper().readTree(plan).get(0);
        assertThat(document.path("Plan").path("Shared Hit Blocks").asLong()).isLessThan(1000);
        System.out.println("BACKLOG_AFTER heldPending=120000 healthyHeads=2 plan="+plan);
    }
    @Test void futureRetryOrHeldHeadCannotBeOvertakenByReadyLaterEvent(){
        long account=accounts.createGuest().accountId();long first=event(),second=event();
        jdbc.update("insert into trading.risk_account_work(account_id,event_id,next_attempt_at) values(?,?,clock_timestamp()+interval '1 hour'),(?,?,clock_timestamp())",account,first,account,second);
        assertThat(jdbc.queryForList(DurableRiskWorker.READY_WORK)).noneMatch(row->((Number)row.get("account_id")).longValue()==account);
        jdbc.update("update trading.risk_account_work set status='HELD' where account_id=? and event_id=?",account,first);
        assertThat(jdbc.queryForList(DurableRiskWorker.READY_WORK)).noneMatch(row->((Number)row.get("account_id")).longValue()==account);
        jdbc.update("update trading.risk_account_work set status='DONE' where account_id=? and event_id=?",account,first);
        assertThat(jdbc.queryForList(DurableRiskWorker.READY_WORK)).anyMatch(row->((Number)row.get("account_id")).longValue()==account&&((Number)row.get("event_id")).longValue()==second);
    }
    @Test void continuityHoldAllowsEarlierReceivedWorkButNotLaterWork(){
        long account=accounts.createGuest().accountId();long first=event(),gap=event(),second=event();
        jdbc.update("insert into trading.risk_account_work(account_id,event_id) values(?,?),(?,?)",account,first,account,second);
        jdbc.update("insert into trading.risk_hold(account_id,event_id,reason,evidence) values(?,?,'PROVIDER_CONTINUITY_UNKNOWN','{}')",account,gap);
        assertThat(jdbc.queryForList(DurableRiskWorker.READY_WORK)).anyMatch(row->((Number)row.get("account_id")).longValue()==account&&((Number)row.get("event_id")).longValue()==first);
        jdbc.update("update trading.risk_account_work set status='DONE' where account_id=? and event_id=?",account,first);
        assertThat(jdbc.queryForList(DurableRiskWorker.READY_WORK)).noneMatch(row->((Number)row.get("account_id")).longValue()==account);
    }
    private long event(){return jdbc.queryForObject("insert into trading.risk_price_event(event_key,kind,payload,occurred_at) values(?,'PRICE','{}',clock_timestamp()) returning id",Long.class,java.util.UUID.randomUUID().toString());}
    void seedHeldHistory(){
        jdbc.update("insert into trading.risk_price_event(event_key,kind,payload,occurred_at) select 'backlog-'||g,'PRICE','{}'::jsonb,clock_timestamp() from generate_series(1,20120) g");
        for(int i=0;i<6;i++){
            long id=accounts.createGuest().accountId();
            jdbc.update("insert into trading.risk_account_work(account_id,event_id,status) select ?,id,case when id<=(select min(id)+119 from trading.risk_price_event) then 'DONE' else 'PENDING' end from trading.risk_price_event where event_key like 'backlog-%'",id);
            jdbc.update("insert into trading.risk_hold(account_id,reason,evidence) values(?,'PROVIDER_CONTINUITY_UNKNOWN','{}')",id);
        }

    }
}
