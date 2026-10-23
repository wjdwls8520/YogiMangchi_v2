package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import java.util.*;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
class OrderFeeMigrationTests {
    @Autowired DataSource source;
    @Autowired JdbcTemplate jdbc;

    @Test void pendingContractsAndCashArePreservedAndFeePolicyMigrationIsRepeatable() {
        String schema="fee_"+UUID.randomUUID().toString().replace("-","");
        try {
            Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).target("11").load().migrate();
            jdbc.update("insert into "+schema+".trading_account(id,status,credential_hash,credential_expires_at,created_at,last_financial_change_at,guest_account) values (1,'ACTIVE',repeat('f',64),now()+interval '7 days',now(),now(),true)");
            jdbc.update("insert into "+schema+".wallet(account_id,balance,used_margin,reserved_margin,realized_pnl) values (1,10000,0,99,0)");
            jdbc.update("insert into "+schema+".trading_order(account_id,trading_symbol_id,side,type,action,status,quantity,leverage,requested_leverage,limit_price,reserved_margin,idempotency_key,request_fingerprint,created_at) values (1,1,'LONG','LIMIT','OPEN','PENDING',1,10,10,990,99,'legacy-fee',repeat('a',64),now())");
            var walletBefore=jdbc.queryForList("select * from "+schema+".wallet");
            var orderBefore=jdbc.queryForList("select * from "+schema+".trading_order");
            var migration=Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).target("12").load();
            assertThat(migration.migrate().migrationsExecuted).isEqualTo(1);
            assertThat(jdbc.queryForList("select * from "+schema+".wallet")).isEqualTo(walletBefore);
            assertThat(jdbc.queryForList("select "+String.join(",",orderBefore.get(0).keySet())+" from "+schema+".trading_order")).isEqualTo(orderBefore);
            assertThat(jdbc.queryForObject("select fee_rate from "+schema+".trading_order",java.math.BigDecimal.class)).isZero();
            assertThat(migration.migrate().migrationsExecuted).isZero();
            assertThatThrownBy(() -> jdbc.update("update "+schema+".trading_order set fee_rate=0.02"))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        } finally { jdbc.execute("drop schema if exists "+schema+" cascade"); }
    }
}
