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

@SpringBootTest(properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class HedgeMigrationTests {
    @Autowired DataSource dataSource;
    @Autowired JdbcTemplate jdbc;

    @Test void migratesMixedLeverageLotsWithoutRewritingCompletedExecutionFacts() {
        String schema=schema();
        try {
            prepare(schema);
            var completed=jdbc.queryForList("select * from "+schema+".trading_order where status='FILLED' order by id");
            var fills=jdbc.queryForList("select * from "+schema+".fill order by id");
            var closed=jdbc.queryForList("select * from "+schema+".position where id=4");
            assertThat(migrate(schema).migrationsExecuted).isEqualTo(1);
            assertThat(jdbc.queryForObject("select count(*) from "+schema+".position where status='OPEN'",Long.class)).isEqualTo(2);
            assertThat(jdbc.queryForObject("select leverage from "+schema+".symbol_leverage where account_id=1 and trading_symbol_id=1",Integer.class)).isEqualTo(14);
            amount(schema,"position","quantity","id=1","0.25");
            amount(schema,"position","entry_notional","id=1","21000");
            amount(schema,"position","entry_price","id=1","84000");
            amount(schema,"position","initial_quantity","id=1","0.3");
            amount(schema,"position","realized_pnl","id=1","100");
            amount(schema,"position","reserved_close_quantity","id=1","0.05");
            amount(schema,"position","margin","id=1","1500");
            assertThat(jdbc.queryForObject("select status from "+schema+".position where id=2",String.class)).isEqualTo("MERGED");
            assertThat(jdbc.queryForObject("select merged_into_position_id from "+schema+".position where id=2",Long.class)).isEqualTo(1);
            amount(schema,"position","quantity","id=2","0.2"); // Donor snapshot retained.
            assertThat(jdbc.queryForObject("select position_id from "+schema+".trading_order where id=3",Long.class)).isEqualTo(1);
            assertThat(jdbc.queryForObject("select original_position_id from "+schema+".trading_order where id=3",Long.class)).isEqualTo(2);
            assertThat(jdbc.queryForObject("select requested_leverage from "+schema+".trading_order where id=4",Integer.class)).isEqualTo(10);
            assertThat(jdbc.queryForObject("select leverage from "+schema+".trading_order where id=4",Integer.class)).isEqualTo(14);
            BigDecimal shortMargin=TradingMath.basisMargin(new BigDecimal("8200"),14);
            amount(schema,"wallet","used_margin","account_id=1",new BigDecimal("1500").add(shortMargin).toPlainString());
            amount(schema,"wallet","balance","account_id=1","10100");
            amount(schema,"wallet","realized_pnl","account_id=1","100");
            amount(schema,"wallet","reserved_margin","account_id=1","50");
            // Compare all original columns, excluding only newly introduced metadata.
            String orderColumns=String.join(",",completed.get(0).keySet());
            assertThat(jdbc.queryForList("select "+orderColumns+" from "+schema+".trading_order where status='FILLED' order by id")).isEqualTo(completed);
            String positionColumns=String.join(",",closed.get(0).keySet());
            assertThat(jdbc.queryForList("select "+positionColumns+" from "+schema+".position where id=4")).isEqualTo(closed);
            assertThat(jdbc.queryForList("select * from "+schema+".fill order by id")).isEqualTo(fills);
            assertThat(migrate(schema).migrationsExecuted).isZero();
            assertThatThrownBy(() -> jdbc.update("insert into "+schema+".position(account_id,trading_symbol_id,side,quantity,initial_quantity,reserved_close_quantity,entry_price,entry_notional,leverage,margin,initial_margin,status,realized_pnl,opened_at) values (1,1,'LONG',1,1,0,1,1,100,0.01,0.01,'OPEN',0,now())"))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        } finally { drop(schema); }
    }

    @Test void inconsistentWalletFailsWithoutPartialDdlOrLedgerChanges() {
        String schema=schema();
        try {
            prepare(schema); jdbc.update("update "+schema+".wallet set used_margin=1 where account_id=1");
            var before=jdbc.queryForList("select * from "+schema+".position order by id");
            assertThatThrownBy(() -> migrate(schema)).hasStackTraceContaining("inconsistent wallet");
            assertThat(jdbc.queryForList("select * from "+schema+".position order by id")).isEqualTo(before);
            assertThat(jdbc.queryForObject("select count(*) from information_schema.tables where table_schema=? and table_name='symbol_leverage'",Integer.class,schema)).isZero();
            assertThat(jdbc.queryForObject("select max(version::integer) from "+schema+".flyway_schema_history",Integer.class)).isEqualTo(9);
        } finally { drop(schema); }
    }

    @Test void excessiveLegacyAggregateRequiresExplicitRiskReductionAndRollsBack() {
        String schema=schema();
        try {
            prepare(schema);
            jdbc.update("update "+schema+".position set entry_price=10000000 where id in (1,2)");
            assertThatThrownBy(() -> migrate(schema)).hasStackTraceContaining("aggregate position exceeds");
            assertThat(jdbc.queryForObject("select count(*) from "+schema+".position where status='OPEN'",Long.class)).isEqualTo(3);
        } finally { drop(schema); }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({
            "100,101,1,1,100.5",
            "1.000000000000000000,1.000000000000000001,1,1,1.000000000000000000",
            "1.000000000000000001,1.000000000000000002,1,1,1.000000000000000002",
            "80000,85000,0.1,0.2,83333.333333333333333333"})
    void migrationUsesSameHalfEvenAverageAsJava(String first,String second,String firstQty,String secondQty,String expected) {
        String schema=schema();
        try {
            prepare(schema);
            for(int id=1;id<=2;id++) {
                BigDecimal price=new BigDecimal(id==1?first:second);
                BigDecimal quantity=new BigDecimal(id==1?firstQty:secondQty);
                BigDecimal margin=TradingMath.margin(price,quantity,10);
                jdbc.update("update "+schema+".position set quantity=?,initial_quantity=?,entry_price=?,leverage=10,margin=?,initial_margin=? where id=?",quantity,quantity,price,margin,margin,id);
            }
            jdbc.update("update "+schema+".wallet set used_margin=(select sum(margin) from "+schema+".position where status='OPEN') where account_id=1");
            migrate(schema);
            amount(schema,"position","entry_price","id=1",expected);
            amount(schema,"position","entry_notional","id=1",new BigDecimal(first).multiply(new BigDecimal(firstQty)).add(new BigDecimal(second).multiply(new BigDecimal(secondQty))).toPlainString());
        } finally { drop(schema); }
    }

    @Test void inconsistentCloseReservationsAbortBeforeAnyTransformation() {
        String schema=schema();
        try {
            prepare(schema); jdbc.update("update "+schema+".position set reserved_close_quantity=0 where id=2");
            assertThatThrownBy(() -> migrate(schema)).hasStackTraceContaining("inconsistent wallet or CLOSE reservations");
            assertThat(jdbc.queryForObject("select count(*) from "+schema+".position where status='OPEN'",Integer.class)).isEqualTo(3);
        } finally { drop(schema); }
    }

    private void prepare(String s) {
        Flyway.configure().dataSource(dataSource).schemas(s).defaultSchema(s).target("9").load().migrate();
        jdbc.update("insert into "+s+".trading_account(id,status,credential_hash,credential_expires_at,created_at,last_financial_change_at,guest_account) values (1,'ACTIVE',repeat('a',64),now()+interval '7 days',now(),now(),true)");
        jdbc.update("insert into "+s+".wallet values (1,10100,2434.285714285714285715,70,100)");
        jdbc.update("insert into "+s+".position(id,account_id,trading_symbol_id,side,quantity,initial_quantity,entry_price,leverage,margin,initial_margin,status,realized_pnl,reserved_close_quantity,opened_at,closed_at,exit_price) values "
                +"(1,1,1,'LONG',0.05,0.1,80000,10,400,800,'OPEN',100,0,now()-interval '2 days',null,null),"
                +"(2,1,1,'LONG',0.2,0.2,85000,14,1214.285714285714285715,1214.285714285714285715,'OPEN',0,0.05,now()-interval '1 day',null,null),"
                +"(3,1,1,'SHORT',0.1,0.1,82000,10,820,820,'OPEN',0,0,now(),null,null),"
                +"(4,1,1,'SHORT',0,0.1,80000,10,0,800,'CLOSED',10,0,now()-interval '3 days',now()-interval '2 days',79900)");
        jdbc.update("insert into "+s+".trading_order(id,account_id,position_id,trading_symbol_id,side,type,action,status,quantity,leverage,filled_price,idempotency_key,request_fingerprint,created_at,completed_at,limit_price,reserved_margin) values "
                +"(1,1,1,1,'LONG','MARKET','OPEN','FILLED',0.1,10,80000,'legacy-open',repeat('b',64),now()-interval '2 days',now()-interval '2 days',null,0),"
                +"(2,1,2,1,'LONG','MARKET','OPEN','FILLED',0.2,14,85000,'legacy-second',repeat('c',64),now()-interval '1 day',now()-interval '1 day',null,0),"
                +"(3,1,2,1,'LONG','LIMIT','CLOSE','PENDING',0.05,14,null,'legacy-close',repeat('d',64),now(),null,90000,0),"
                +"(4,1,null,1,'LONG','LIMIT','OPEN','PENDING',0.01,10,null,'legacy-pending',repeat('e',64),now(),null,70000,70)");
        jdbc.update("insert into "+s+".fill(order_id,price,quantity,price_event_time,executed_at,realized_pnl) values (1,80000,0.1,now()-interval '2 days',now()-interval '2 days',0),(2,85000,0.2,now()-interval '1 day',now()-interval '1 day',0)");
    }
    private org.flywaydb.core.api.output.MigrateResult migrate(String s) { return Flyway.configure().dataSource(dataSource).schemas(s).defaultSchema(s).target("10").load().migrate(); }
    private void amount(String s,String table,String column,String where,String expected) { assertThat(jdbc.queryForObject("select "+column+" from "+s+"."+table+" where "+where,BigDecimal.class)).isEqualByComparingTo(expected); }
    private static String schema() { return "hedge_"+UUID.randomUUID().toString().replace("-",""); }
    private void drop(String s) { jdbc.execute("drop schema if exists "+s+" cascade"); }
}
