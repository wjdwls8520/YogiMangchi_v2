package com.yogimangchi.trading.execution.trigger;

import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class TriggerCandidates {
    private final JdbcTemplate jdbc;
    public TriggerCandidates(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    /** Keyset pagination and partial indexes restrict work to the tick's symbol and crossed limit ranges. */
    public List<Long> accounts(LatestMarkPrice price, long afterAccountId) {
        return jdbc.queryForList("""
                select account_id from (
                    select account_id from trading.position where status='OPEN' and trading_symbol_id=? and account_id>?
                    union
                    select account_id from trading.trading_order where status='PENDING' and trading_symbol_id=?
                        and action='OPEN' and side='LONG' and limit_price>=? and account_id>?
                    union
                    select account_id from trading.trading_order where status='PENDING' and trading_symbol_id=?
                        and action='OPEN' and side='SHORT' and limit_price<=? and account_id>?
                    union
                    select account_id from trading.trading_order where status='PENDING' and trading_symbol_id=?
                        and action='CLOSE' and side='LONG' and limit_price<=? and account_id>?
                    union
                    select account_id from trading.trading_order where status='PENDING' and trading_symbol_id=?
                        and action='CLOSE' and side='SHORT' and limit_price>=? and account_id>?
                ) candidates order by account_id limit 100
                """, Long.class, price.tradingSymbolId(), afterAccountId, price.tradingSymbolId(), price.domainMarkPrice(),
                afterAccountId, price.tradingSymbolId(), price.domainMarkPrice(), afterAccountId,
                price.tradingSymbolId(), price.domainMarkPrice(), afterAccountId,
                price.tradingSymbolId(), price.domainMarkPrice(), afterAccountId);
    }
}
