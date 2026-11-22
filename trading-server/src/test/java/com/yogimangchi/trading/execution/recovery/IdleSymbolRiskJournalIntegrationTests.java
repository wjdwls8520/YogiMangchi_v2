package com.yogimangchi.trading.execution.recovery;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.order.dto.ClosePositionRequest;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.LegacyLeverageFixtures;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(properties = {
        "trading.risk-journal.enabled=true",
        "trading.risk-journal.skip-idle-symbols=true",
        "binance.mark-price.enabled=false",
        "binance.order-book.enabled=false",
        "trading.trigger.enabled=false",
        "trading.reconciliation.enabled=false",
        "trading.guest-cleanup.enabled=false",
        "trading.risk.retention.enabled=false"
})
@Import(DurableRiskIntegrationTests.Infrastructure.class)
class IdleSymbolRiskJournalIntegrationTests {

    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired LatestPriceStore prices;
    @Autowired DurableRiskWorker worker;
    @Autowired RiskJournalRetentionService retention;
    @Autowired TradingEngineGate gate;
    @Autowired RedisMarketDataBridge bridge;
    @Autowired JdbcTemplate jdbc;

    long accountId;
    long btc;
    long eth;

    @BeforeEach
    void setup() throws Exception {
        btc = symbol("BTC");
        eth = symbol("ETH");
        accountId = accounts.createGuest().accountId();
        prices.beginSubscription(Set.of(btc, eth));
        await().atMost(Duration.ofSeconds(12))
                .until(() -> bridge.health().state() == RedisMarketDataBridge.State.HEALTHY);
        worker.runOnce();
    }

    @AfterEach
    void tearDown() {
        prices.markUnavailable();
    }

    @Test
    void skipsUnexposedSymbolsPerSymbolWhileFullyJournalingExposedSymbols() throws Exception {
        long baselineEvents = countPriceEvents();

        // 1. Zero exposure on both BTC and ETH -> 0 DB risk_price_event inserts, yet gate stays caught up!
        tick(btc, "100");
        tick(eth, "200");
        try (var scope = RiskSqlCounter.start()) {
            tick(btc, "101");
            tick(eth, "201");
            assertThat(scope.count()).isZero();
        }
        assertThat(countPriceEvents()).isEqualTo(baselineEvents);
        assertThat(gate.status()).isEqualTo("READY");

        // Idle DurableRiskWorker.runOnce() must perform 0 DB writes (no redundant risk_dispatch_cursor UPDATE).
        try (var scope = RiskSqlCounter.start()) {
            worker.runOnce();
            assertThat(scope.count() - scope.selectCount()).isZero();
        }

        // 2. Open a BTC position ONLY -> BTC becomes exposed, ETH stays completely idle!
        LegacyLeverageFixtures.tenTimes(jdbc, accountId, btc, Position.Side.LONG);
        var opened = orders.create(
                accountId,
                "open-" + UUID.randomUUID(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, new BigDecimal("1"), 10, null));
        assertThat(opened.status()).isEqualTo("FILLED");

        long afterOpenEvents = countPriceEvents();
        tick(eth, "202");
        try (var scope = RiskSqlCounter.start()) {
            tick(eth, "203");
            // ETH is still unexposed -> 0 DB statements once exposure cache is refreshed!
            assertThat(scope.count()).isZero();
        }
        assertThat(countPriceEvents()).isEqualTo(afterOpenEvents);

        // BTC IS exposed -> journals into risk_price_event AND creates zero false UNOBSERVED_PRICE_INTERVAL hold!
        tick(btc, "102");
        worker.runOnce();
        assertThat(countPriceEvents()).isEqualTo(afterOpenEvents + 1);
        assertThat(jdbc.queryForObject(
                "select count(*) from trading.risk_hold where account_id = ? and resolved_at is null",
                Long.class, accountId)).isZero();

        // 3. Close BTC position -> BTC drops right back to idle (0 new DB inserts on subsequent ticks)!
        orders.close(accountId, opened.positionId(), "close-" + UUID.randomUUID(), new ClosePositionRequest(new BigDecimal("1")));
        long afterCloseEvents = countPriceEvents();
        tick(btc, "103");
        try (var scope = RiskSqlCounter.start()) {
            tick(btc, "104");
            tick(eth, "204");
            assertThat(scope.count()).isZero();
        }
        assertThat(countPriceEvents()).isEqualTo(afterCloseEvents);
    }

    @Test
    void idleSymbolPriceHeadDoesNotBlockRetentionPurgeOfActiveSymbolEvents() throws Exception {
        tick(btc, "100");
        tick(eth, "200");

        // Trade ETH briefly so ETH establishes an older risk_price_head, then close ETH so it goes idle.
        LegacyLeverageFixtures.tenTimes(jdbc, accountId, eth, Position.Side.LONG);
        var ethPos = orders.create(
                accountId,
                "eth-open-" + UUID.randomUUID(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, eth, Position.Side.LONG, new BigDecimal("1"), 10, null));
        tick(eth, "201");
        worker.runOnce();
        long ethHeadId = jdbc.queryForObject(
                "select event_id from trading.risk_price_head where trading_symbol_id = ?", Long.class, eth);
        orders.close(accountId, ethPos.positionId(), "eth-close-" + UUID.randomUUID(), new ClosePositionRequest(new BigDecimal("1")));

        // Trade BTC afterward so BTC generates newer journal events above ETH's frozen head.
        LegacyLeverageFixtures.tenTimes(jdbc, accountId, btc, Position.Side.LONG);
        var btcPos = orders.create(
                accountId,
                "btc-open-" + UUID.randomUUID(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, new BigDecimal("1"), 10, null));
        tick(btc, "101");
        worker.runOnce();
        long expiredBtcEventId = jdbc.queryForObject(
                "select event_id from trading.risk_price_head where trading_symbol_id = ?", Long.class, btc);
        tick(btc, "102");
        worker.runOnce();
        long latestBtcHeadId = jdbc.queryForObject(
                "select event_id from trading.risk_price_head where trading_symbol_id = ?", Long.class, btc);
        assertThat(expiredBtcEventId).isGreaterThan(ethHeadId);
        assertThat(latestBtcHeadId).isGreaterThan(expiredBtcEventId);

        // Age the older BTC event + work past retention cutoff, leaving ETH's frozen head intact.
        jdbc.update("update trading.risk_price_event set recorded_at = clock_timestamp() - interval '96 hours' where id <= ?", expiredBtcEventId);
        jdbc.update("update trading.risk_account_work set completed_at = clock_timestamp() - interval '96 hours' where event_id <= ? and status in ('DONE','RETIRED')", expiredBtcEventId);

        var purged = retention.purgeExpired(Instant.now());
        assertThat(purged.purgedEvents()).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_price_event where id = ?", Long.class, expiredBtcEventId)).isZero();
        // Both ETH's frozen head and BTC's active head MUST remain protected.
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_price_event where id = ?", Long.class, ethHeadId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.risk_price_event where id = ?", Long.class, latestBtcHeadId)).isEqualTo(1);

        orders.close(accountId, btcPos.positionId(), "btc-close-" + UUID.randomUUID(), new ClosePositionRequest(new BigDecimal("1")));
    }

    private void tick(long symbolId, String price) {
        Instant receivedAt = Instant.now();
        Instant eventTime = receivedAt.truncatedTo(ChronoUnit.MICROS);
        Instant previous = prices.find(symbolId).latestPrice().map(LatestMarkPrice::eventTime).orElse(Instant.MIN);
        if (!eventTime.isAfter(previous)) {
            eventTime = previous.truncatedTo(ChronoUnit.MICROS).plus(1, ChronoUnit.MICROS);
        }
        assertThat(prices.update(new LatestMarkPrice(symbolId, new BigDecimal(price), eventTime, receivedAt))).isTrue();
    }

    private long countPriceEvents() {
        Long count = jdbc.queryForObject("select count(*) from trading.risk_price_event where kind = 'PRICE'", Long.class);
        return count != null ? count : 0L;
    }

    private long symbol(String code) {
        return jdbc.queryForObject("select id from trading.trading_symbol where symbol = ?", Long.class, code);
    }
}
