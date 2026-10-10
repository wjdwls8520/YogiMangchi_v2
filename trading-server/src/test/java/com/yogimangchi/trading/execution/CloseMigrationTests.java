package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import java.math.BigDecimal;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties="binance.mark-price.enabled=false")
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class CloseMigrationTests {
    @Autowired DataSource dataSource;
    @Autowired JdbcTemplate jdbc;

    @Test void upgradesV6WithoutLosingOriginalLotsFinancialHistoryOrPendingOpenOrders() {
        String schema="close_upgrade_"+UUID.randomUUID().toString().replace("-","");
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("6").load().migrate();
            jdbc.update("insert into "+schema+".trading_account values (1,'ACTIVE',repeat('a',64),now()+interval '7 days',now(),now())");
            jdbc.update("insert into "+schema+".wallet values (1,9998,10,5,-2)");
            jdbc.update("insert into "+schema+".position(id,account_id,trading_symbol_id,side,quantity,entry_price,leverage,margin,status,realized_pnl,exit_price,opened_at,closed_at) values "
                    +"(1,1,1,'LONG',1,100,10,10,'OPEN',0,null,now(),null),"
                    +"(2,1,1,'LONG',1,100,10,10,'CLOSED',2,102,now(),now()),"
                    +"(3,1,1,'LONG',1,100,10,10,'LIQUIDATED',-4,96,now(),now())");
            jdbc.update("insert into "+schema+".trading_order(id,account_id,position_id,trading_symbol_id,side,type,action,status,quantity,leverage,filled_price,idempotency_key,request_fingerprint,created_at,completed_at) values "
                    +"(1,1,2,1,'LONG','MARKET','CLOSE','FILLED',1,10,102,'old-close',repeat('b',64),now(),now()),"
                    +"(2,1,3,1,'LONG','MARKET','LIQUIDATE','FILLED',1,10,96,'old-liquidation',repeat('c',64),now(),now())");
            jdbc.update("insert into "+schema+".fill(id,order_id,price,quantity,price_event_time,executed_at,realized_pnl) values (1,1,102,1,now(),now(),2),(2,2,96,1,now(),now(),-4)");
            jdbc.update("insert into "+schema+".trading_order(id,account_id,trading_symbol_id,side,type,action,status,quantity,leverage,limit_price,reserved_margin,idempotency_key,request_fingerprint,created_at) "
                    +"values (3,1,1,'LONG','LIMIT','OPEN','PENDING',1,10,50,5,'old-pending',repeat('d',64),now())");
            var ordersBefore=jdbc.queryForList("select * from "+schema+".trading_order order by id");
            var fillsBefore=jdbc.queryForList("select * from "+schema+".fill order by id");
            var walletBefore=jdbc.queryForList("select * from "+schema+".wallet");
            var flyway=Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load();
            assertThat(flyway.migrate().migrationsExecuted).isEqualTo(2);
            assertThat(jdbc.queryForList("select * from "+schema+".trading_order order by id")).isEqualTo(ordersBefore);
            assertThat(jdbc.queryForList("select * from "+schema+".fill order by id")).isEqualTo(fillsBefore);
            assertThat(jdbc.queryForList("select * from "+schema+".wallet")).isEqualTo(walletBefore);
            assertThat(jdbc.queryForList("select quantity from "+schema+".position order by id",BigDecimal.class))
                    .containsExactly(new BigDecimal("1.00000000"),new BigDecimal("0.00000000"),new BigDecimal("0.00000000"));
            assertThat(jdbc.queryForList("select initial_quantity from "+schema+".position",BigDecimal.class))
                    .allSatisfy(value -> assertThat(value).isEqualByComparingTo("1"));
            assertThat(jdbc.queryForList("select initial_margin from "+schema+".position",BigDecimal.class))
                    .allSatisfy(value -> assertThat(value).isEqualByComparingTo("10"));
            assertThat(jdbc.queryForList("select realized_pnl from "+schema+".position order by id",BigDecimal.class))
                    .containsExactly(new BigDecimal("0.000000000000000000"),new BigDecimal("2.000000000000000000"),new BigDecimal("-4.000000000000000000"));
            assertThatThrownBy(() -> jdbc.update("update "+schema+".position set reserved_close_quantity=1.1 where id=1"))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
            assertThatThrownBy(() -> jdbc.update("update "+schema+".position set reserved_close_quantity=0.1 where id=2"))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
            assertThat(flyway.migrate().migrationsExecuted).isZero();
        } finally {
            // Only this disposable Testcontainers schema; application data is never removed.
            jdbc.execute("drop schema if exists "+schema+" cascade");
        }
    }
}
