package com.yogimangchi.trading.support;

import java.math.BigDecimal;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.assertThat;

/** Lifecycle/race scenarios express gross cash and collateral; reconcile trading fees separately.
 * Independent fixed-rate/amount tests verify fees in FuturesFeeIntegrationTests. */
public final class FeeLedgerAssertions {
    private FeeLedgerAssertions() { }
    public static BigDecimal expected(JdbcTemplate jdbc, long accountId, String column, String gross, BigDecimal fixtureFunding) {
        BigDecimal expected=new BigDecimal(gross);
        if (column.equals("balance")) {
            BigDecimal fees=jdbc.queryForObject("select coalesce(sum(f.fee),0) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=? and o.action<>'LIQUIDATE'",BigDecimal.class,accountId);
            // Phase 1 liquidation expectations already include liquidation fee/shortfall.
            expected=expected.add(fixtureFunding).subtract(fees);
        } else if (column.equals("reserved_margin")) {
            expected=expected.add(jdbc.queryForObject("select coalesce(sum(ceil(limit_price*quantity*fee_rate*1e18)/1e18),0) from trading.trading_order where account_id=? and status='PENDING' and action='OPEN'",BigDecimal.class,accountId));
        }
        BigDecimal allFees=jdbc.queryForObject("select coalesce(sum(f.fee),0) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",BigDecimal.class,accountId);
        assertThat(jdbc.queryForObject("select fees_paid from trading.wallet where account_id=?",BigDecimal.class,accountId)).isEqualByComparingTo(allFees);
        return expected;
    }
}
