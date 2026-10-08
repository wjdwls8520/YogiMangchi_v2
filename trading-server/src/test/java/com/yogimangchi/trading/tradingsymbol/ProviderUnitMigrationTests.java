package com.yogimangchi.trading.tradingsymbol;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(properties = "binance.mark-price.enabled=false")
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
class ProviderUnitMigrationTests {
    @Autowired private DataSource dataSource;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void upgradesV2WithoutChangingIdentitiesStatusOrProviderMappings() {
        String schema = "unit_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("2").load().migrate();
            jdbc.update("update " + schema + ".trading_symbol set status = 'INACTIVE' where symbol = 'PEPE'");
            var before = jdbc.queryForList("select id, symbol, provider_symbol, status from " + schema + ".trading_symbol order by id");
            var flyway = Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load();
            assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
            assertThat(jdbc.queryForList("select id, symbol, provider_symbol, status from " + schema + ".trading_symbol order by id"))
                    .isEqualTo(before);
            assertThat(jdbc.queryForList("select provider_unit_multiplier from " + schema + ".trading_symbol order by id", Long.class))
                    .containsExactly(1L, 1L, 1L, 1L, 1L, 1L, 1L, 1L, 1L, 1L, 1000L, 1000L);
            assertThat(flyway.migrate().migrationsExecuted).isZero();
        } finally {
            // Isolated, disposable test schema in Testcontainers; never an application schema.
            jdbc.execute("drop schema if exists " + schema + " cascade");
        }
    }

    @Test
    void unknownLegacyMappingFailsAndRollsBackInsteadOfGuessingUnits() {
        String schema = "unit_unknown_" + UUID.randomUUID().toString().replace("-", "");
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("2").load().migrate();
            jdbc.update("update " + schema + ".trading_symbol set provider_symbol = 'NEWPEPEUSDT' where symbol = 'PEPE'");
            assertThatThrownBy(() -> Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load().migrate())
                    .isInstanceOf(FlywayException.class).hasStackTraceContaining("Unverified provider mapping");
            assertThat(jdbc.queryForObject("select count(*) from information_schema.columns where table_schema = ? and column_name = 'provider_unit_multiplier'", Long.class, schema))
                    .isZero();
            assertThat(jdbc.queryForObject("select count(*) from " + schema + ".trading_symbol", Long.class)).isEqualTo(12);
        } finally {
            jdbc.execute("drop schema if exists " + schema + " cascade");
        }
    }
}
