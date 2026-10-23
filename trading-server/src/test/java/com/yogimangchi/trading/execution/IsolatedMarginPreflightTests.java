package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/** Diagnostic SQL only: no Isolated implementation or migration is being tested here. */
@SpringBootTest(properties = {"binance.mark-price.enabled=false", "binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class IsolatedMarginPreflightTests {
    @Autowired DataSource dataSource;
    @Autowired JdbcTemplate jdbc;
    private String schema;

    @BeforeEach void prepareDisposableLedger() {
        schema = "preflight_" + UUID.randomUUID().toString().replace("-", "");
        Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("10").load().migrate();
        jdbc.update("insert into " + schema + ".trading_account(id,status,credential_hash,credential_expires_at,created_at,last_financial_change_at,guest_account) "
                + "values (1,'ACTIVE',repeat('a',64),now()+interval '7 days',now(),now(),true)");
        jdbc.update("insert into " + schema + ".wallet values (1,10000,150,20,0)");
        jdbc.update("insert into " + schema + ".symbol_leverage(account_id,trading_symbol_id,leverage,updated_at) values (1,1,10,now())");
        jdbc.update("insert into " + schema + ".position(id,account_id,trading_symbol_id,side,quantity,initial_quantity,entry_price,entry_notional,leverage,margin,initial_margin,status,realized_pnl,reserved_close_quantity,opened_at) values "
                + "(1,1,1,'LONG',1,1,1000,1000,10,100,100,'OPEN',0,0.2,now()),"
                + "(2,1,1,'SHORT',0.5,0.5,1000,500,10,50,50,'OPEN',0,0,now())");
        jdbc.update("insert into " + schema + ".trading_order(id,account_id,position_id,trading_symbol_id,side,type,action,status,quantity,leverage,requested_leverage,filled_price,idempotency_key,request_fingerprint,created_at,completed_at,limit_price,reserved_margin) values "
                + "(1,1,1,1,'LONG','MARKET','OPEN','FILLED',1,10,10,1000,'filled',repeat('b',64),now(),now(),null,0),"
                + "(2,1,null,1,'LONG','LIMIT','OPEN','PENDING',0.2,10,10,null,'pending-open',repeat('c',64),now(),null,1000,20),"
                + "(3,1,1,1,'LONG','LIMIT','CLOSE','PENDING',0.2,10,10,null,'pending-close',repeat('d',64),now(),null,1100,0)");
        jdbc.update("insert into " + schema + ".fill(order_id,price,quantity,price_event_time,executed_at,realized_pnl) values (1,1000,1,now(),now(),0)");
    }

    @AfterEach void discardOnlyThisTestSchema() {
        // Generated schema belongs exclusively to the disposable Testcontainers PostgreSQL.
        if (schema != null) jdbc.execute("drop schema if exists " + schema + " cascade");
    }

    @Test void inspectsHedgeAndBothReservationsInReadOnlySnapshotWithoutChangingAnyLedger() throws Exception {
        var before = ledger();
        var result = inspect();
        assertThat(result.get("inspection_read_only")).isEqualTo("on");
        assertThat(number(result, "schema_version")).isEqualTo(10);
        assertThat(number(result, "open_positions")).isEqualTo(2);
        assertThat(number(result, "pending_orders")).isEqualTo(2);
        for (String key : List.of("wallet_total_mismatches", "unfunded_wallets", "close_quantity_mismatches",
                "invalid_close_targets", "position_leverage_mismatches", "pending_leverage_mismatches",
                "missing_position_wallets", "missing_pending_wallets", "execution_fact_mismatches")) {
            assertThat(number(result, key)).as(key).isZero();
        }
        // A consistent structure must never claim that price risk or conversion approval passed.
        assertThat(result.get("scope")).isEqualTo("STRUCTURAL_CHECK_ONLY_NOT_MIGRATION_APPROVAL");
        assertThat(ledger()).isEqualTo(before);
    }

    @Test void detectsIncorrectUsedAndReservedMarginTotalsWithoutRepairingThem() throws Exception {
        jdbc.update("update " + schema + ".wallet set used_margin=149,reserved_margin=21");
        var before = ledger();
        assertThat(number(inspect(), "wallet_total_mismatches")).isEqualTo(1);
        assertThat(ledger()).isEqualTo(before);
    }

    @Test void detectsCrossWalletWhoseMarginIsNotFundedByCash() throws Exception {
        jdbc.update("update " + schema + ".wallet set balance=160");
        assertThat(number(inspect(), "unfunded_wallets")).isEqualTo(1);
    }

    @Test void detectsCloseReservationMismatch() throws Exception {
        jdbc.update("update " + schema + ".position set reserved_close_quantity=0.1 where id=1");
        assertThat(number(inspect(), "close_quantity_mismatches")).isEqualTo(1);
    }

    @Test void detectsPendingCloseForTheWrongHedgeSide() throws Exception {
        jdbc.update("update " + schema + ".trading_order set side='SHORT' where id=3");
        assertThat(number(inspect(), "invalid_close_targets")).isEqualTo(1);
    }

    @Test void detectsPositionAndPendingOpenLeverageDifferentFromSharedSetting() throws Exception {
        jdbc.update("update " + schema + ".symbol_leverage set leverage=14");
        var result = inspect();
        assertThat(number(result, "position_leverage_mismatches")).isEqualTo(2);
        assertThat(number(result, "pending_leverage_mismatches")).isEqualTo(1);
    }

    @Test void detectsMissingFinancialWalletEvenWhenAccountForeignKeysAreValid() throws Exception {
        jdbc.update("delete from " + schema + ".wallet");
        var result = inspect();
        assertThat(number(result, "missing_position_wallets")).isEqualTo(2);
        assertThat(number(result, "missing_pending_wallets")).isEqualTo(2);
    }

    @Test void detectsChangedFillFactWithoutRewritingHistoricalExecutions() throws Exception {
        jdbc.update("update " + schema + ".fill set price=999");
        var before = ledger();
        assertThat(number(inspect(), "execution_fact_mismatches")).isEqualTo(1);
        assertThat(ledger()).isEqualTo(before);
    }

    private Map<String, Object> inspect() throws Exception {
        String sql = Files.readString(Path.of("ops", "isolated-margin-preflight.sql"))
                .replace("SET LOCAL search_path = trading, pg_catalog;", "SET LOCAL search_path = " + schema + ", pg_catalog;");
        try (Connection connection = dataSource.getConnection(); var statement = connection.createStatement()) {
            Map<String, Object> report = new LinkedHashMap<>();
            boolean result = statement.execute(sql);
            while (true) {
                if (result) {
                    try (var rows = statement.getResultSet()) {
                        assertThat(rows.next()).isTrue();
                        for (int column = 1; column <= rows.getMetaData().getColumnCount(); column++) {
                            report.put(rows.getMetaData().getColumnLabel(column), rows.getObject(column));
                        }
                        assertThat(rows.next()).isFalse();
                    }
                } else if (statement.getUpdateCount() == -1) break;
                result = statement.getMoreResults();
            }
            assertThat(report).containsKey("scope");
            return report;
        }
    }

    private Map<String, Object> ledger() {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        for (String table : List.of("trading_account", "wallet", "position", "trading_order", "fill", "symbol_leverage", "flyway_schema_history")) {
            snapshot.put(table, jdbc.queryForList("select * from " + schema + "." + table + " order by 1"));
        }
        return snapshot;
    }

    private static long number(Map<String, Object> report, String key) {
        return ((Number) report.get(key)).longValue();
    }
}
