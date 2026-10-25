package com.yogimangchi.trading.execution.recovery;

import com.yogimangchi.trading.error.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** PG admission fence orders ingress against financial commits, not accounts against each other. */
@Component
public class RiskAdmission {
    static final long INGRESS_LOCK=8947201901L;
    private final JdbcTemplate jdbc;
    private final boolean enabled;
    private volatile boolean ingressHealthy=true;
    public RiskAdmission(JdbcTemplate jdbc,@Value("${trading.risk-journal.enabled:true}") boolean enabled) {this.jdbc=jdbc;this.enabled=enabled;}
    public void enterTransaction() {
        if(!enabled)return;
        if(!TransactionSynchronizationManager.isActualTransactionActive())throw new IllegalStateException("Financial ingress fence requires transaction");
        jdbc.execute("SET LOCAL lock_timeout='250ms'");
        jdbc.queryForList("select pg_advisory_xact_lock_shared(?)",INGRESS_LOCK);
    }
    public void requireClear(Long accountId) {
        if(!enabled)return;
        if(!ingressHealthy)throw new BusinessException(ErrorCode.ENGINE_RECOVERING);
        var holds=jdbc.queryForList("select reason,trading_symbol_id,event_id from trading.risk_hold where account_id=? and resolved_at is null",accountId);
        if(!holds.isEmpty()) {
            boolean automatic=holds.stream().allMatch(h->RiskGapRecovery.automatic((String)h.get("reason"),(Long)h.get("trading_symbol_id"),(Long)h.get("event_id")));
            throw blocked(accountId,automatic?ErrorCode.ACCOUNT_RISK_PENDING:ErrorCode.ACCOUNT_RECOVERY_HELD);
        }
        boolean pending=Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from trading.risk_account_work where account_id=? and status in ('PENDING','HELD'))",Boolean.class,accountId));
        if(pending)throw blocked(accountId,ErrorCode.ACCOUNT_RISK_PENDING);
    }
    private RecoveryBlocked blocked(Long account,ErrorCode code) {
        var rows=jdbc.queryForList("select w.event_id,e.occurred_at from trading.risk_account_work w join trading.risk_price_event e on e.id=w.event_id where w.account_id=? and w.status in ('PENDING','HELD') order by w.event_id limit 1",account);
        if(rows.isEmpty()) {
            var holds=jdbc.queryForList("select h.event_id,coalesce(e.occurred_at,h.held_at) occurred_at from trading.risk_hold h left join trading.risk_price_event e on e.id=h.event_id where h.account_id=? and h.resolved_at is null order by h.id limit 1",account);
            if(holds.isEmpty())return new RecoveryBlocked(code,null,null);
            var hold=holds.get(0);return new RecoveryBlocked(code,hold.get("event_id")==null?null:((Number)hold.get("event_id")).longValue(),((java.sql.Timestamp)hold.get("occurred_at")).toInstant());
        }
        var first=rows.get(0);return new RecoveryBlocked(code,((Number)first.get("event_id")).longValue(),((java.sql.Timestamp)first.get("occurred_at")).toInstant());
    }
    /** Final administrative retirement preserves evidence while terminating work for a closed account. */
    public void retireWithdrawal(Long accountId) {
        if(!enabled)return;
        jdbc.update("update trading.risk_account_work set status='RETIRED',completed_at=clock_timestamp(),completion_reason='MEMBER_WITHDRAWAL' where account_id=? and status in ('PENDING','HELD')",accountId);
        jdbc.update("update trading.risk_hold set resolved_at=clock_timestamp(),resolution_reference='MEMBER_WITHDRAWAL: administrative retirement, not reconstructed execution' where account_id=? and resolved_at is null",accountId);
    }
    public void failedIngress(){ingressHealthy=false;}
    public void recordedIngress(){ingressHealthy=true;}
    public boolean healthy(){return !enabled||ingressHealthy;}
}
