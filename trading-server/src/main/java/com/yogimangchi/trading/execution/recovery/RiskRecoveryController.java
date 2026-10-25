package com.yogimangchi.trading.execution.recovery;

import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/trading/account/recovery",produces="application/json")
@SecurityRequirement(name="guestBearer") @SecurityRequirement(name="memberBearer")
public class RiskRecoveryController {
    public record Hold(long holdId,Long tradingSymbolId,Long riskEventId,String reason,Instant heldAt) { }
    public record Status(String status,long pendingWork,long heldWork,Long oldestRiskEventId,Instant oldestReceivedAt,List<Hold> holds,Instant capturedAt) { }
    private final JdbcTemplate jdbc;private final AccountLock locks;
    public RiskRecoveryController(JdbcTemplate jdbc,AccountLock locks){this.jdbc=jdbc;this.locks=locks;}
    @GetMapping @Transactional(timeout=5)
    @Operation(summary="Read this account's persistent risk recovery state",
        description="CLEAR, PENDING or REVIEW_REQUIRED. Holds describe account/symbol scope, missing-price continuity or bounded processing failure; fresh prices alone do not clear a review hold. Pending received prices are replayed in account order. No balances are corrected here. No accountId input or release endpoint. 401 credential; 409 inactive/busy account. Public trading/status is global readiness, not this account's admission state.")
    public ResponseEntity<Status> get(@AuthenticationPrincipal TradingPrincipal principal) {
        long id=principal.accountId();locks.lock(id);
        var work=jdbc.queryForMap("select count(*) filter(where status='PENDING') pending,count(*) filter(where status='HELD') held,min(event_id) filter(where status in ('PENDING','HELD')) oldest from trading.risk_account_work where account_id=? and status in ('PENDING','HELD')",id);
        var holds=jdbc.query("select id,trading_symbol_id,event_id,reason,held_at from trading.risk_hold where account_id=? and resolved_at is null order by id limit 100",(r,n)->new Hold(r.getLong(1),r.getObject(2,Long.class),r.getObject(3,Long.class),r.getString(4),r.getTimestamp(5).toInstant()),id);
        long pending=((Number)work.get("pending")).longValue(),held=((Number)work.get("held")).longValue();
        Long oldest=work.get("oldest")==null?null:((Number)work.get("oldest")).longValue();
        Instant received=oldest==null?null:jdbc.queryForObject("select occurred_at from trading.risk_price_event where id=?",java.sql.Timestamp.class,oldest).toInstant();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Status(!holds.isEmpty()||held>0?"REVIEW_REQUIRED":pending>0?"PENDING":"CLEAR",pending,held,oldest,received,holds,Instant.now()));
    }
}
