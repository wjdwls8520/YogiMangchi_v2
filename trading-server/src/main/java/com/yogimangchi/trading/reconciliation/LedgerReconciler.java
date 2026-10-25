package com.yogimangchi.trading.reconciliation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import java.math.BigDecimal;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** Financially read-only: evidence/holds are written, never balances, orders, positions or fills. */
@Service
public class LedgerReconciler {
    private final JdbcTemplate jdbc;
    private final AccountLock locks;
    private final ObjectMapper json;
    public LedgerReconciler(JdbcTemplate jdbc, AccountLock locks, ObjectMapper json) {
        this.jdbc = jdbc;
        this.locks = locks;
        this.json = json;
    }
    public record Result(long accountId,String status,List<String> failedChecks,Map<String,Object> evidence) { }

    static final String SNAPSHOT="""
        with owner as (select id,guest_account from trading.trading_account where id=?),
        latest_round as (
          select r.* from trading.member_trading_round r join owner a on a.id=r.account_id order by r.round_number desc limit 1
        ), facts as (
          select coalesce(sum(f.realized_pnl),0) gross,coalesce(sum(f.fee),0) fees,coalesce(sum(f.settlement_adjustment),0) adjustment,
            coalesce(sum(f.realized_pnl) filter(where f.round_id=(select id from latest_round)),0) round_gross,
            coalesce(sum(f.fee) filter(where f.round_id=(select id from latest_round)),0) round_fees,
            coalesce(sum(f.settlement_adjustment) filter(where f.round_id=(select id from latest_round)),0) round_adjustment
          from trading.fill f join trading.trading_order o on o.id=f.order_id join owner a on a.id=o.account_id
        ), exposure as (
          select coalesce(sum(p.margin),0) collateral from trading.position p join owner a on a.id=p.account_id where p.status='OPEN'
        ), reservations as (
          select coalesce(sum(o.reserved_margin),0) reserved from trading.trading_order o join owner a on a.id=o.account_id where o.status='PENDING' and o.action='OPEN'
        ), funding as (
          select coalesce(sum(capital_adjustment),0) capital from (
            select g.capital_adjustment from trading.guest_retry g join owner a on a.id=g.account_id
            union all select m.capital_adjustment from trading.member_restart m join owner a on a.id=m.account_id
          ) adjustments
        )
        select a.guest_account,w.account_id is not null wallet_present,
          w.balance,w.used_margin,w.reserved_margin,w.realized_pnl,w.fees_paid,w.settlement_adjustment,
          facts.gross expected_gross,facts.fees expected_fees,facts.adjustment expected_adjustment,facts.round_gross,facts.round_fees,facts.round_adjustment,
          exposure.collateral expected_collateral,reservations.reserved expected_reserved,funding.capital,
          latest_round.id latest_round_id,latest_round.initial_balance round_initial,
          latest_round.start_realized_pnl,latest_round.start_fees_paid,latest_round.start_adjustment
        from owner a left join trading.wallet w on w.account_id=a.id
        cross join facts cross join exposure cross join reservations cross join funding left join latest_round on true
        """;

    @Transactional(propagation=Propagation.REQUIRES_NEW,timeout=5)
    public Result check(long accountId) {
        return checkInTransaction(accountId);
    }

    /** Recovery already owns the account lock; never suspend it for another transaction. */
    @Transactional(propagation=Propagation.MANDATORY)
    public Result checkInTransaction(long accountId) {
        locks.lockIncludingWithdrawn(accountId);
        jdbc.execute("SET LOCAL statement_timeout='1s'");
        Map<String,Object> evidence=new LinkedHashMap<>(jdbc.queryForMap(SNAPSHOT,accountId));
        List<String> failed=new ArrayList<>();
        if(!Boolean.TRUE.equals(evidence.get("wallet_present")))failed.add("WALLET_MISSING");
        else {
            compare(evidence,failed,"used_margin","expected_collateral","OPEN_COLLATERAL");
            compare(evidence,failed,"reserved_margin","expected_reserved","OPEN_RESERVATION");
            compare(evidence,failed,"realized_pnl","expected_gross","FILL_GROSS_PNL");
            compare(evidence,failed,"fees_paid","expected_fees","FILL_FEES");
            compare(evidence,failed,"settlement_adjustment","expected_adjustment","FILL_ADJUSTMENT");
        }
        long invalidClose=jdbc.queryForObject("""
            select
              (select count(*) from trading.position p where p.account_id=? and p.status='OPEN'
                and p.reserved_close_quantity<>(select coalesce(sum(o.quantity),0) from trading.trading_order o where o.position_id=p.id and o.status='PENDING' and o.action='CLOSE'))
              +(select count(*) from trading.trading_order o left join trading.position p on p.id=o.position_id
                where o.account_id=? and o.status='PENDING' and o.action='CLOSE'
                and (p.id is null or p.status<>'OPEN' or p.account_id<>o.account_id or p.trading_symbol_id<>o.trading_symbol_id or p.side<>o.side))
            """,Long.class,accountId,accountId);
        evidence.put("invalid_close_reservations",invalidClose);if(invalidClose>0)failed.add("CLOSE_RESERVATION");
        long invalidRound=jdbc.queryForObject("""
            with amounts as (
              select f.round_id,sum(f.realized_pnl) gross,sum(f.fee) fees,sum(f.settlement_adjustment) adjustment
              from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=? and f.round_id is not null group by f.round_id
            ), ledger as (
              select r.*,coalesce(f.gross,0) gross,coalesce(f.fees,0) fees,coalesce(f.adjustment,0) adjustment,
                coalesce(sum(coalesce(f.gross,0)) over(order by r.round_number rows between unbounded preceding and 1 preceding),0) prior_gross,
                coalesce(sum(coalesce(f.fees,0)) over(order by r.round_number rows between unbounded preceding and 1 preceding),0) prior_fees,
                coalesce(sum(coalesce(f.adjustment,0)) over(order by r.round_number rows between unbounded preceding and 1 preceding),0) prior_adjustment
              from trading.member_trading_round r left join amounts f on f.round_id=r.id where r.account_id=?
            )
            select count(*) from ledger where start_realized_pnl<>prior_gross or start_fees_paid<>prior_fees or start_adjustment<>prior_adjustment
              or (status='COMPLETED' and (
                (final_wallet->>'realizedPnl')::numeric<>gross or (final_wallet->>'feesPaid')::numeric<>fees
                or (final_wallet->>'settlementAdjustment')::numeric<>adjustment
                or (initial_balance is not null and (final_wallet->>'balance')::numeric<>initial_balance+gross-fees+adjustment)))
            """,Long.class,accountId,accountId);
        evidence.put("invalid_round_ledgers",invalidRound);if(invalidRound>0)failed.add("ROUND_LEDGER");
        long invalidFunding=jdbc.queryForObject("""
            select count(*) from trading.member_restart m
              join trading.member_trading_round previous on previous.id=m.previous_round_id
              join trading.member_trading_round following on following.id=m.new_round_id
            where m.account_id=? and (previous.account_id<>m.account_id or following.account_id<>m.account_id
              or m.balance_before<>(previous.final_wallet->>'balance')::numeric
              or m.capital_adjustment<>following.initial_balance-m.balance_before
              or following.round_number<>previous.round_number+1
              or m.restarted_at<>previous.ended_at or m.restarted_at<>following.started_at)
            """,Long.class,accountId);
        evidence.put("invalid_restart_capital_records",invalidFunding);if(invalidFunding>0)failed.add("RESTART_CAPITAL_RECORD");
        BigDecimal expectedBalance=null;
        if(Boolean.TRUE.equals(evidence.get("guest_account"))) {
            expectedBalance=new BigDecimal("10000").add(number(evidence,"expected_gross")).subtract(number(evidence,"expected_fees"))
                    .add(number(evidence,"expected_adjustment")).add(number(evidence,"capital"));
            evidence.put("capital_basis","GUEST_INITIAL_PLUS_RETRY_ADJUSTMENTS");
        } else if(evidence.get("round_initial")!=null&&Boolean.TRUE.equals(evidence.get("wallet_present"))) {
            // Latest verified round resets cash before its baseline. Previous lifetime capital is not guessed.
            expectedBalance=number(evidence,"round_initial").add(number(evidence,"round_gross"))
                .subtract(number(evidence,"round_fees")).add(number(evidence,"round_adjustment"));
            evidence.put("capital_basis","VERIFIED_LATEST_ROUND");
        } else evidence.put("capital_basis","LEGACY_UNVERIFIED");
        evidence.put("expected_balance",expectedBalance);
        if(expectedBalance!=null&&evidence.get("balance")!=null&&expectedBalance.compareTo(number(evidence,"balance"))!=0)failed.add("CASH_CAPITAL_RECONCILIATION");
        String status=!failed.isEmpty()?"MISMATCH":expectedBalance==null?"UNVERIFIED":"MATCHED";
        String encoded=encode(evidence),checks=encode(failed);
        jdbc.update("insert into trading.ledger_reconciliation(account_id,checked_at,status,failed_checks,evidence) values(?,clock_timestamp(),?,?::jsonb,?::jsonb) on conflict(account_id) do update set checked_at=excluded.checked_at,status=excluded.status,failed_checks=excluded.failed_checks,evidence=excluded.evidence",accountId,status,checks,encoded);
        if(!failed.isEmpty())jdbc.update("""
            insert into trading.risk_hold(account_id,reason,evidence)
            values(?,'LEDGER_MISMATCH',jsonb_build_object('failedChecks',?::jsonb,'snapshot',?::jsonb)) on conflict do nothing
            """,accountId,checks,encoded);
        return new Result(accountId,status,List.copyOf(failed),Collections.unmodifiableMap(evidence));
    }
    private static void compare(Map<String,Object> data,List<String> failed,String actual,String expected,String code) {
        if(number(data,actual).compareTo(number(data,expected))!=0)failed.add(code);
    }
    private static BigDecimal number(Map<String,Object> data,String key) {
        return (BigDecimal)data.get(key);
    }
    private String encode(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch(JsonProcessingException failure) {
            throw new IllegalStateException("Ledger evidence encoding failed", failure);
        }
    }
}
