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
class StopLossMigrationTests {
    @Autowired DataSource dataSource; @Autowired JdbcTemplate jdbc;
    @Test void additiveUpgradeKeepsAllExistingFinancialColumnsAndEventsAndHasNoInventedStops() {
        String schema="stop_loss_"+UUID.randomUUID().toString().replace("-","");
        try {
            flyway(schema,"22").migrate();
            jdbc.update("insert into "+schema+".trading_account(id,status,credential_hash,credential_expires_at,created_at,last_financial_change_at,guest_account) values(1,'ACTIVE',repeat('a',64),now()+interval '7 days',now(),now(),true)");
            jdbc.update("insert into "+schema+".wallet(account_id,balance,used_margin,reserved_margin,realized_pnl,fees_paid) values(1,9999.5,100,0,0,0.5)");
            jdbc.update("insert into "+schema+".position(id,account_id,trading_symbol_id,side,quantity,initial_quantity,reserved_close_quantity,entry_price,entry_notional,leverage,margin,initial_margin,status,realized_pnl,opened_at) values(1,1,1,'LONG',1,1,0,1000,1000,10,100,100,'OPEN',0,now())");
            jdbc.update("insert into "+schema+".trading_order(id,account_id,position_id,trading_symbol_id,side,type,action,status,quantity,leverage,requested_leverage,filled_price,idempotency_key,request_fingerprint,created_at,completed_at,fee_rate) values(1,1,1,1,'LONG','MARKET','OPEN','FILLED',1,10,10,1000,'old-order',repeat('a',64),now(),now(),0.0005)");
            jdbc.update("insert into "+schema+".fill(order_id,price,quantity,price_event_time,executed_at,realized_pnl,fee) values(1,1000,1,now(),now(),0,0.5)");
            jdbc.update("insert into "+schema+".trading_event(account_id,order_id,order_status,event_type,payload,occurred_at) values(1,1,'FILLED','ORDER_FILLED','{}',now())");
            var columns=new LinkedHashMap<String,String>();
            for(String table:List.of("trading_account","wallet","position","trading_order","fill","trading_event"))
                columns.put(table,String.join(",",jdbc.queryForList("select column_name from information_schema.columns where table_schema=? and table_name=? order by ordinal_position",String.class,schema,table)));
            var before=snapshot(schema,columns);
            assertThat(flyway(schema,"23").migrate().migrationsExecuted).isEqualTo(1);
            assertThat(snapshot(schema,columns)).isEqualTo(before);
            assertThat(jdbc.queryForMap("select stop_loss_status,stop_loss_version from "+schema+".position")).containsEntry("stop_loss_status","NONE").containsEntry("stop_loss_version",0L);
            assertThat(jdbc.queryForObject("select count(*) from "+schema+".position_stop_loss_command",Long.class)).isZero();
            assertThat(flyway(schema,"23").migrate().migrationsExecuted).isZero();
        }finally{jdbc.execute("drop schema if exists "+schema+" cascade");}
    }
    private List<List<Map<String,Object>>> snapshot(String schema,Map<String,String> columns) {
        return columns.entrySet().stream().map(entry->jdbc.queryForList("select "+entry.getValue()+" from "+schema+"."+entry.getKey()+" order by 1")).toList();
    }
    private Flyway flyway(String schema,String target){return Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target(target).load();}
}
