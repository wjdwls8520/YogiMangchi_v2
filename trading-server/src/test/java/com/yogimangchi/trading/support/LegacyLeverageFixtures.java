package com.yogimangchi.trading.support;

import com.yogimangchi.trading.position.entity.Position;
import org.springframework.jdbc.core.JdbcTemplate;

/** Explicit 10x preferences for historical arithmetic/risk fixtures, independent of the product default. */
public final class LegacyLeverageFixtures {
    private LegacyLeverageFixtures() { }
    public static void tenTimes(JdbcTemplate jdbc,long account,long symbol,Position.Side side) {
        jdbc.update("insert into trading.symbol_leverage(account_id,trading_symbol_id,side,leverage,updated_at) "
                +"values(?,?,?,10,now()) on conflict(account_id,trading_symbol_id,side) do nothing",account,symbol,side.name());
    }
    public static void bothDirections(JdbcTemplate jdbc,long account,long symbol) {
        for(var side:Position.Side.values()) tenTimes(jdbc,account,symbol,side);
    }
}
