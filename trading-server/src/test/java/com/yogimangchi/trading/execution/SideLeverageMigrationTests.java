package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import java.util.UUID;
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
class SideLeverageMigrationTests {
    @Autowired DataSource dataSource;
    @Autowired JdbcTemplate jdbc;

    @Test void copiesSharedValueToBothDirectionsWithoutChangingWalletAndRejectsDuplicateDirection() {
        String schema="side_leverage_"+UUID.randomUUID().toString().replace("-","");
        try {
            flyway(schema,"17").migrate();
            jdbc.update("insert into "+schema+".trading_account(id,status,credential_hash,credential_expires_at,created_at,last_financial_change_at,guest_account) values (1,'ACTIVE',repeat('a',64),now()+interval '7 days',now(),now(),true)");
            jdbc.update("insert into "+schema+".wallet(account_id,balance,used_margin,reserved_margin,realized_pnl) values(1,10000,0,0,0)");
            jdbc.update("insert into "+schema+".symbol_leverage(account_id,trading_symbol_id,leverage,updated_at) values(1,1,37,now())");
            var wallet=jdbc.queryForList("select * from "+schema+".wallet");
            var old=jdbc.queryForMap("select leverage,updated_at from "+schema+".symbol_leverage");
            assertThat(flyway(schema,"18").migrate().migrationsExecuted).isEqualTo(1);
            assertThat(jdbc.queryForList("select side from "+schema+".symbol_leverage order by side",String.class)).containsExactly("LONG","SHORT");
            assertThat(jdbc.queryForList("select leverage,updated_at from "+schema+".symbol_leverage")).containsExactly(old,old);
            assertThat(jdbc.queryForList("select * from "+schema+".wallet")).isEqualTo(wallet);
            assertThatThrownBy(() -> jdbc.update("insert into "+schema+".symbol_leverage(account_id,trading_symbol_id,side,leverage,updated_at) values(1,1,'LONG',2,now())"))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
            assertThat(flyway(schema,"18").migrate().migrationsExecuted).isZero();
        } finally { jdbc.execute("drop schema if exists "+schema+" cascade"); }
    }
    private Flyway flyway(String schema,String target) {
        return Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target(target).load();
    }
}
