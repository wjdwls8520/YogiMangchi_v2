package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.execution.TradingMath;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Reclaims only disposable, never-used Guest accounts. Financial history is never deleted. */
@Service
public class UnusedGuestCleanupService {
    public static final Duration GRACE_PERIOD = Duration.ofDays(7);
    public static final int BATCH_SIZE = 100;
    private final JdbcTemplate jdbc;

    public UnusedGuestCleanupService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional
    public int cleanupBatch() {
        jdbc.execute("SET LOCAL statement_timeout = '5s'");
        jdbc.execute("SET LOCAL lock_timeout = '250ms'");
        var ids = jdbc.queryForList("""
                select a.id from trading.trading_account a
                where a.guest_account and a.last_financial_change_at = a.created_at
                    and a.credential_expires_at <= ?
                    and not exists (select 1 from trading.trading_order o where o.account_id = a.id)
                    and not exists (select 1 from trading.position p where p.account_id = a.id)
                    and exists (select 1 from trading.wallet w where w.account_id = a.id
                        and w.balance = ? and w.realized_pnl = 0 and w.used_margin = 0 and w.reserved_margin = 0)
                order by a.credential_expires_at, a.id
                limit ? for update of a skip locked
                """, Long.class, Timestamp.from(Instant.now().minus(GRACE_PERIOD)), TradingMath.INITIAL_BALANCE, BATCH_SIZE);
        int deleted = 0;
        for (long id : ids) {
            // Fresh statement snapshot after taking the same account row lock as Trading transactions.
            int wallet = jdbc.update("""
                    delete from trading.wallet w where w.account_id = ?
                        and w.balance = ? and w.realized_pnl = 0 and w.used_margin = 0 and w.reserved_margin = 0
                        and not exists (select 1 from trading.trading_order o where o.account_id = w.account_id)
                        and not exists (select 1 from trading.position p where p.account_id = w.account_id)
                    """, id, TradingMath.INITIAL_BALANCE);
            if (wallet == 0) continue;
            if (jdbc.update("delete from trading.trading_account where id = ? and guest_account", id) != 1) {
                throw new IllegalStateException("Unused Guest cleanup lost its locked account");
            }
            deleted++;
        }
        return deleted;
    }
}
