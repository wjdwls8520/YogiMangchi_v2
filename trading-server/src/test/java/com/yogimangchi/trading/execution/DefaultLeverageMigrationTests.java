package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
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
class DefaultLeverageMigrationTests {
    @Autowired DataSource dataSource;
    @Autowired JdbcTemplate jdbc;

    @Test void preservesOnlyMissingActiveExposureSettingsWithoutChangingFinancialFacts() throws Exception {
        String schema=schema();
        try {
            flyway(schema,"21").migrate(); fixture(schema);
            position(schema,1,1,"LONG",10,"OPEN");
            pending(schema,1,1,"LONG",10);
            position(schema,2,1,"SHORT",7,"OPEN");
            jdbc.update("insert into "+schema+".symbol_leverage(account_id,trading_symbol_id,side,leverage,updated_at) values(1,1,'SHORT',7,now()),(1,3,'LONG',15,now())");
            pending(schema,2,2,"SHORT",15);
            position(schema,3,4,"LONG",10,"CLOSED");
            jdbc.update("insert into "+schema+".trading_order(id,account_id,position_id,trading_symbol_id,side,type,action,status,quantity,leverage,requested_leverage,filled_price,idempotency_key,request_fingerprint,created_at,completed_at) values(3,1,3,4,'LONG','MARKET','CLOSE','FILLED',1,10,10,1100,'historic-close',repeat('a',64),now(),now())");
            jdbc.update("insert into "+schema+".fill(order_id,price,quantity,price_event_time,executed_at,realized_pnl) values(3,1100,1,now(),now(),100)");
            var facts=facts(schema);
            var settings=jdbc.queryForList("select * from "+schema+".symbol_leverage order by id");
            var preflight=preflight(schema);
            assertThat(preflight).hasSize(2).allSatisfy(row -> assertThat(row.get("cutover_action")).isEqualTo("PRESERVE_EXPOSURE"));
            assertThat(flyway(schema,"22").migrate().migrationsExecuted).isEqualTo(1);
            assertThat(facts(schema)).isEqualTo(facts);
            assertThat(jdbc.queryForList("select * from "+schema+".symbol_leverage where id in (1,2) order by id")).isEqualTo(settings);
            assertThat(jdbc.queryForList("select trading_symbol_id,side,leverage from "+schema+".symbol_leverage order by trading_symbol_id,side"))
                    .containsExactly(Map.of("trading_symbol_id",1L,"side","LONG","leverage",10),
                            Map.of("trading_symbol_id",1L,"side","SHORT","leverage",7),
                            Map.of("trading_symbol_id",2L,"side","SHORT","leverage",15),
                            Map.of("trading_symbol_id",3L,"side","LONG","leverage",15));
            assertThat(preflight(schema)).isEmpty();
            assertThat(flyway(schema,"22").migrate().migrationsExecuted).isZero();
        } finally { jdbc.execute("drop schema if exists "+schema+" cascade"); }
    }

    @Test void conflictingMissingExposureRefusesCutoverAtomicallyAndPreflightExplainsScope() throws Exception {
        String schema=schema();
        try {
            flyway(schema,"21").migrate(); fixture(schema);
            position(schema,1,1,"LONG",10,"OPEN"); pending(schema,1,1,"LONG",20);
            pending(schema,2,2,"SHORT",7); // Must not be partially backfilled on failure.
            var before=facts(schema);
            assertThat(preflight(schema)).anySatisfy(row -> {
                assertThat(row.get("trading_symbol_id")).isEqualTo(1L);
                assertThat(row.get("side")).isEqualTo("LONG");
                assertThat(row.get("cutover_action")).isEqualTo("CONFLICT_REVIEW_REQUIRED");
            });
            assertThatThrownBy(() -> flyway(schema,"22").migrate()).hasStackTraceContaining("Conflicting unconfigured exposure leverage");
            assertThat(facts(schema)).isEqualTo(before);
            assertThat(jdbc.queryForObject("select count(*) from "+schema+".symbol_leverage",Long.class)).isZero();
            assertThat(jdbc.queryForObject("select count(*) from "+schema+".flyway_schema_history where version='22'",Long.class)).isZero();
        } finally { jdbc.execute("drop schema if exists "+schema+" cascade"); }
    }

    private void fixture(String schema) {
        jdbc.update("insert into "+schema+".trading_account(id,status,credential_hash,credential_expires_at,created_at,last_financial_change_at,guest_account) values(1,'ACTIVE',repeat('a',64),now()+interval '7 days',now(),now(),true)");
        jdbc.update("insert into "+schema+".wallet(account_id,balance,used_margin,reserved_margin,realized_pnl) values(1,10000,300,200,100)");
    }
    private void position(String schema,long id,long symbol,String side,int leverage,String status) {
        boolean open=status.equals("OPEN");
        jdbc.update("insert into "+schema+".position(id,account_id,trading_symbol_id,side,quantity,initial_quantity,reserved_close_quantity,entry_price,entry_notional,leverage,margin,initial_margin,status,realized_pnl,opened_at,closed_at,exit_price) values(?,1,?,?,?,1,0,1000,?,?,?,100,?,?,now(),?,?)",
                id,symbol,side,open?1:0,open?1000:0,leverage,open?100:0,status,open?0:100,
                open?null:java.sql.Timestamp.from(java.time.Instant.now()),open?null:1100);
    }
    private void pending(String schema,long id,long symbol,String side,int leverage) {
        jdbc.update("insert into "+schema+".trading_order(id,account_id,trading_symbol_id,side,type,action,status,quantity,leverage,requested_leverage,limit_price,reserved_margin,idempotency_key,request_fingerprint,created_at) values(?,1,?,?,'LIMIT','OPEN','PENDING',1,?,?,990,100,?,repeat('a',64),now())",id,symbol,side,leverage,leverage,"pending-"+id);
    }
    private List<List<Map<String,Object>>> facts(String schema) {
        return List.of("wallet","position","trading_order","fill").stream()
                .map(table -> jdbc.queryForList("select * from "+schema+"."+table+" order by 1")).toList();
    }
    private List<Map<String,Object>> preflight(String schema) throws Exception {
        return jdbc.queryForList(Files.readString(Path.of("scripts/check-default-leverage-cutover.sql")).replace("trading.",schema+"."));
    }
    private Flyway flyway(String schema,String target) {
        return Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target(target).load();
    }
    private String schema() { return "default_leverage_"+UUID.randomUUID().toString().replace("-",""); }
}
