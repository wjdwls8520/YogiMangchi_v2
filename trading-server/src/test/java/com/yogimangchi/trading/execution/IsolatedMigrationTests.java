package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import java.util.*;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class IsolatedMigrationTests {
    @Autowired DataSource dataSource;
    @Autowired JdbcTemplate jdbc;
    String schema;

    @BeforeEach void legacy() {
        schema="isolated_"+UUID.randomUUID().toString().replace("-","");
        Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("10").load().migrate();
        jdbc.update("insert into "+schema+".trading_account(id,status,credential_hash,credential_expires_at,created_at,last_financial_change_at,guest_account) values "
                +"(1,'ACTIVE',repeat('a',64),now()+interval '7 days',now(),now(),true),"
                +"(2,'ACTIVE',repeat('b',64),now()+interval '7 days',now(),now(),true)");
        jdbc.update("insert into "+schema+".wallet values (1,10000,150,20,0),(2,10000,0,0,0)");
        jdbc.update("insert into "+schema+".symbol_leverage(account_id,trading_symbol_id,leverage,updated_at) values (1,1,10,now())");
        jdbc.update("insert into "+schema+".position(id,account_id,trading_symbol_id,side,quantity,initial_quantity,entry_price,entry_notional,leverage,margin,initial_margin,status,realized_pnl,reserved_close_quantity,opened_at) values "
                +"(1,1,1,'LONG',1,1,1000,1000,10,100,100,'OPEN',0,0.2,now()),"
                +"(2,1,1,'SHORT',0.5,0.5,1000,500,10,50,50,'OPEN',0,0,now())");
        jdbc.update("insert into "+schema+".trading_order(id,account_id,position_id,trading_symbol_id,side,type,action,status,quantity,leverage,requested_leverage,filled_price,idempotency_key,request_fingerprint,created_at,completed_at,limit_price,reserved_margin) values "
                +"(1,1,1,1,'LONG','MARKET','OPEN','FILLED',1,10,10,1000,'legacy-fill',repeat('c',64),now(),now(),null,0),"
                +"(2,1,null,1,'LONG','LIMIT','OPEN','PENDING',0.2,10,10,null,'legacy-open',repeat('d',64),now(),null,1000,20),"
                +"(3,1,1,1,'LONG','LIMIT','CLOSE','PENDING',0.2,10,10,null,'legacy-close',repeat('e',64),now(),null,1100,0)");
        jdbc.update("insert into "+schema+".fill(order_id,price,quantity,price_event_time,executed_at,realized_pnl) values (1,1000,1,now(),now(),0)");
    }

    @AfterEach void discardOnlyDisposableSchema() { jdbc.execute("drop schema if exists "+schema+" cascade"); }

    @Test void preservesEveryLegacyFinancialColumnAndKeepsOpenExposureOnHoldUntilPriceRiskValidation() {
        Map<String,List<Map<String,Object>>> before=ledger();
        assertThat(migrate().migrationsExecuted).isEqualTo(1);
        for (var table:before.entrySet()) {
            String columns=String.join(",",table.getValue().get(0).keySet());
            assertThat(jdbc.queryForList("select "+columns+" from "+schema+"."+table.getKey()+" order by 1")).isEqualTo(table.getValue());
        }
        assertThat(jdbc.queryForObject("select margin_transition_status from "+schema+".trading_account where id=1",String.class)).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("select isolated_activated_at from "+schema+".trading_account where id=1",Object.class)).isNull();
        assertThat(jdbc.queryForObject("select margin_transition_status from "+schema+".trading_account where id=2",String.class)).isEqualTo("COMPLETE");
        assertThat(jdbc.queryForList("select opened_margin_mode from "+schema+".position",String.class)).containsOnly("CROSS");
        assertThat(jdbc.queryForObject("select margin_mode from "+schema+".fill",String.class)).isEqualTo("CROSS");
        assertThat(jdbc.queryForList("select submitted_margin_mode from "+schema+".trading_order",String.class)).containsOnly("CROSS");
        assertThat(migrate().migrationsExecuted).isZero();
    }

    @ParameterizedTest @ValueSource(strings={
            "update wallet set used_margin=149 where account_id=1",
            "update wallet set balance=160 where account_id=1",
            "update position set reserved_close_quantity=0.1 where id=1",
            "update trading_order set side='SHORT' where id=3",
            "update symbol_leverage set leverage=14 where account_id=1",
            "update fill set price=999"})
    void inconsistentLegacyDataRollsBackWithoutPartialDdlOrMoneyChanges(String mutation) {
        String[] sql=mutation.split(" ",3);
        jdbc.update(sql[0]+" "+schema+"."+sql[1]+" "+sql[2]);
        var before=ledger();
        assertThatThrownBy(this::migrate).hasStackTraceContaining("inconsistent or unfunded legacy ledger");
        assertThat(ledger()).isEqualTo(before);
        assertThat(jdbc.queryForObject("select max(version::integer) from "+schema+".flyway_schema_history where success",Integer.class)).isEqualTo(10);
        assertThat(jdbc.queryForObject("select count(*) from information_schema.columns where table_schema=? and table_name='trading_account' and column_name='margin_transition_status'",Integer.class,schema)).isZero();
    }

    private org.flywaydb.core.api.output.MigrateResult migrate() {
        return Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("11").load().migrate();
    }
    private Map<String,List<Map<String,Object>>> ledger() {
        Map<String,List<Map<String,Object>>> result=new LinkedHashMap<>();
        for(String table:List.of("trading_account","wallet","position","trading_order","fill","symbol_leverage"))
            result.put(table,jdbc.queryForList("select * from "+schema+"."+table+" order by 1"));
        return result;
    }
}
