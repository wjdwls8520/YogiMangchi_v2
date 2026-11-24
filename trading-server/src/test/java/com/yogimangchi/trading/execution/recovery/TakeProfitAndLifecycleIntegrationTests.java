package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.AccountTriggerService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.notification.TradingNotificationService;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.dto.LimitCloseRequest;
import com.yogimangchi.trading.order.dto.OrderResponse;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.stoploss.StopLossRequest;
import com.yogimangchi.trading.stoploss.StopLossService;
import com.yogimangchi.trading.takeprofit.TakeProfitRequest;
import com.yogimangchi.trading.takeprofit.TakeProfitResponse;
import com.yogimangchi.trading.takeprofit.TakeProfitService;
import com.yogimangchi.trading.tradingaccount.service.MemberAccounts;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "trading.risk-journal.enabled=true",
        "trading.member-auth.enabled=true",
        "trading.trigger.enabled=false",
        "trading.reconciliation.enabled=false",
        "trading.guest-cleanup.enabled=false",
        "binance.mark-price.enabled=false",
        "binance.order-book.enabled=false"
})
@AutoConfigureMockMvc
@Import(DurableRiskIntegrationTests.Infrastructure.class)
class TakeProfitAndLifecycleIntegrationTests {

    @DynamicPropertySource
    static void jwt(DynamicPropertyRegistry settings) {
        MemberTradingSoakTests.jwt(settings);
    }

    private static final AtomicLong MEMBERS = new AtomicLong(96_000_000);

    @Autowired MemberAccounts members;
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired StopLossService stopLosses;
    @Autowired TakeProfitService takeProfits;
    @Autowired SymbolLeverageService leverages;
    @Autowired LatestPriceStore prices;
    @Autowired DurableRiskWorker worker;
    @Autowired RedisMarketDataBridge bridge;
    @Autowired TradingEngineGate gate;
    @Autowired AccountTriggerService trigger;
    @Autowired TradingEvents events;
    @Autowired TradingNotificationService notifications;
    @Autowired LedgerReconciler ledger;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired MockMvc mvc;

    private long account;
    private long member;
    private long btc;
    private long eth;
    private MemberTradingSoakTests.Actor actor;

    @BeforeEach
    void setup() throws Exception {
        member = MEMBERS.incrementAndGet();
        account = members.open(member).accountId();
        btc = jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'", Long.class);
        eth = jdbc.queryForObject("select id from trading.trading_symbol where symbol='ETH'", Long.class);
        actor = new MemberTradingSoakTests.Actor(member, btc);
        actor.id = account;
        prices.beginSubscription(Set.of(btc, eth));
        await().atMost(Duration.ofSeconds(12))
                .until(() -> bridge.health().state() == RedisMarketDataBridge.State.HEALTHY);
        mark(btc, "1000");
        mark(eth, "200");
        drain();
        leverages.change(account, btc, Position.Side.LONG, 10);
        leverages.change(account, btc, Position.Side.SHORT, 10);
        leverages.change(account, eth, Position.Side.LONG, 10);
        leverages.change(account, eth, Position.Side.SHORT, 10);
    }

    @AfterEach
    void tearDown() {
        prices.markUnavailable();
    }

    @ParameterizedTest
    @EnumSource(Position.Side.class)
    void takeProfitTriggerCancelsPendingClosesExecutesMarketCloseEmitsEventAndNotification(Position.Side side) throws Exception {
        OrderResponse opened = open(account, btc, side, "1");
        String tpPrice = side == Position.Side.LONG ? "1100" : "900";
        String crossingMark = side == Position.Side.LONG ? "1120" : "880";
        String limitClosePrice = side == Position.Side.LONG ? "1200" : "800";

        String tpKey = key();
        TakeProfitResponse configured = takeProfits.put(
                account, opened.positionId(), tpKey, new TakeProfitRequest(n(tpPrice), 0L));
        assertThat(configured.status()).isEqualTo("ACTIVE");
        assertThat(configured.version()).isEqualTo(1L);
        assertThat(new BigDecimal(configured.takeProfitPrice())).isEqualByComparingTo(tpPrice);

        // PositionResponse includes the configured takeProfit snapshot
        var positionsSnapshot = accounts.summary(account).positions();
        assertThat(positionsSnapshot).hasSize(1);
        assertThat(positionsSnapshot.get(0).takeProfit()).isNotNull();
        assertThat(positionsSnapshot.get(0).takeProfit().status()).isEqualTo("ACTIVE");
        assertThat(new BigDecimal(positionsSnapshot.get(0).takeProfit().takeProfitPrice())).isEqualByComparingTo(tpPrice);

        // Place a pending LIMIT CLOSE reservation that must be canceled when TP triggers
        OrderResponse pendingClose = orders.createLimitClose(
                account, opened.positionId(), key(), new LimitCloseRequest(n("0.4"), n(limitClosePrice)));

        // Cross take profit mark
        mark(btc, crossingMark);
        drain();

        TakeProfitResponse triggered = takeProfits.get(account, opened.positionId());
        assertThat(triggered.status()).isEqualTo("TRIGGERED");
        assertThat(triggered.version()).isEqualTo(2L);
        assertThat(triggered.reason()).isEqualTo("TAKE_PROFIT");
        assertThat(triggered.triggerOrderId()).isNotNull();
        assertThat(new BigDecimal(triggered.triggerPrice())).isEqualByComparingTo(crossingMark);

        // Triggered order has reason TAKE_PROFIT and full quantity 1; pending close was canceled with TAKE_PROFIT
        var history = orders.history(account, null, 20);
        OrderResponse tpOrder = history.stream()
                .filter(o -> o.orderId().equals(triggered.triggerOrderId()))
                .findFirst().orElseThrow();
        assertThat(tpOrder.action()).isEqualTo("CLOSE");
        assertThat(tpOrder.type()).isEqualTo("MARKET");
        assertThat(tpOrder.reason()).isEqualTo("TAKE_PROFIT");
        assertThat(new BigDecimal(tpOrder.quantity())).isEqualByComparingTo("1");
        assertThat(new BigDecimal(tpOrder.fill().price())).isEqualByComparingTo(crossingMark);
        assertThat(new BigDecimal(tpOrder.fill().realizedPnl())).isEqualByComparingTo("120");

        OrderResponse canceledClose = history.stream()
                .filter(o -> o.orderId().equals(pendingClose.orderId()))
                .findFirst().orElseThrow();
        assertThat(canceledClose.status()).isEqualTo("CANCELED");
        assertThat(canceledClose.reason()).isEqualTo("TAKE_PROFIT");

        // Idempotent replay of original PUT key returns original snapshot even after trigger
        assertThat(takeProfits.put(account, opened.positionId(), tpKey, new TakeProfitRequest(n(tpPrice), 0L)))
                .isEqualTo(configured);

        // Trading events contain both TAKE_PROFIT_CHANGED transitions
        var tpEvents = events.after(account, 0, 100).stream()
                .filter(e -> "TAKE_PROFIT_CHANGED".equals(e.type()))
                .toList();
        assertThat(tpEvents).hasSize(2);
        assertThat(tpEvents.get(0).order()).isNull();
        assertThat(tpEvents.get(0).takeProfit()).isEqualTo(configured);
        assertThat(tpEvents.get(1).takeProfit()).isEqualTo(triggered);

        // TradingNotificationService dispatched a TAKE_PROFIT_MARKET notification
        var notices = notifications.listNotifications(member, null, 20, "MOCK", null).content();
        assertThat(notices).anySatisfy(item -> {
            assertThat(item.type()).isEqualTo(TradingNotificationService.TYPE_ORDER_COMPLETED);
            assertThat(item.payload().path("orderType").asText()).isEqualTo("TAKE_PROFIT_MARKET");
            assertThat(item.payload().path("reason").asText()).isEqualTo("TAKE_PROFIT");
        });

        assertThat(ledger.reconcile(account).status()).isEqualTo("MATCHED");
    }

    @Test
    void takeProfitHttpCrudValidationAndAutoExpireOnManualCloseStopLossAndLiquidation() throws Exception {
        OrderResponse longPos = open(account, btc, Position.Side.LONG, "1");
        String path = "/api/v1/trading/account/positions/" + longPos.positionId() + "/take-profit";
        String bearer = "Bearer " + actor.token();

        // Initial GET returns NONE / version 0
        mvc.perform(get(path).header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(header().exists("X-Request-Id"))
                .andExpect(jsonPath("$.status").value("NONE"))
                .andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.takeProfitPrice").isEmpty());

        // LONG TP <= Mark (1000) rejected with 409 TAKE_PROFIT_NOT_PROFITABLE + ProblemDetail requestId
        mvc.perform(put(path)
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"takeProfitPrice\":\"1000\",\"expectedVersion\":0}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TAKE_PROFIT_NOT_PROFITABLE"))
                .andExpect(jsonPath("$.requestId").isNotEmpty());

        mvc.perform(put(path)
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"takeProfitPrice\":\"950\",\"expectedVersion\":0}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TAKE_PROFIT_NOT_PROFITABLE"));

        // Invalid price rejected with 400 INVALID_TAKE_PROFIT
        mvc.perform(put(path)
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"takeProfitPrice\":\"-5\",\"expectedVersion\":0}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_TAKE_PROFIT"));

        // Valid PUT succeeds -> version 1
        String putKey = key();
        mvc.perform(put(path)
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", putKey)
                        .contentType("application/json")
                        .content("{\"takeProfitPrice\":\"1150\",\"expectedVersion\":0}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.version").value(1));

        // Stale expectedVersion=0 rejected with 409 TAKE_PROFIT_VERSION_CONFLICT
        mvc.perform(put(path)
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"takeProfitPrice\":\"1200\",\"expectedVersion\":0}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TAKE_PROFIT_VERSION_CONFLICT"));

        // Different payload with same key -> 409 IDEMPOTENCY_CONFLICT
        assertThatThrownBy(() -> takeProfits.put(account, longPos.positionId(), putKey, new TakeProfitRequest(n("1180"), 0L)))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getCode())
                .isEqualTo(ErrorCode.IDEMPOTENCY_CONFLICT);

        // DELETE cancels TP -> version 2 CANCELED
        mvc.perform(delete(path)
                        .param("expectedVersion", "1")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELED"))
                .andExpect(jsonPath("$.version").value(2));

        // Re-arm TP and manually close position -> TP auto-expires with POSITION_CLOSED
        takeProfits.put(account, longPos.positionId(), key(), new TakeProfitRequest(n("1150"), 2L));
        orders.close(account, longPos.positionId(), key());
        TakeProfitResponse afterManualClose = takeProfits.get(account, longPos.positionId());
        assertThat(afterManualClose.status()).isEqualTo("EXPIRED");
        assertThat(afterManualClose.reason()).isEqualTo("POSITION_CLOSED");

        // Pre-arming tick must not trigger a newly set TP; Stop Loss trigger expires active TP
        OrderResponse second = open(account, btc, Position.Side.LONG, "1");
        LatestMarkPrice oldHighTick = mark(btc, "1200");
        drain();
        mark(btc, "1000");
        drain();
        takeProfits.put(account, second.positionId(), key(), new TakeProfitRequest(n("1150"), 0L));
        trigger.process(account, oldHighTick, Map.of(btc, oldHighTick));
        assertThat(takeProfits.get(account, second.positionId()).status()).isEqualTo("ACTIVE");

        stopLosses.put(account, second.positionId(), key(), new StopLossRequest(n("960"), 0L));
        mark(btc, "950");
        drain();
        assertThat(stopLosses.get(account, second.positionId()).status()).isEqualTo("TRIGGERED");
        assertThat(takeProfits.get(account, second.positionId()).status()).isEqualTo("EXPIRED");
        assertThat(takeProfits.get(account, second.positionId()).reason()).isEqualTo("STOP_LOSS");

        // Liquidation expires active TP with POSITION_LIQUIDATED
        mark(btc, "1000");
        drain();
        OrderResponse third = open(account, btc, Position.Side.LONG, "1");
        takeProfits.put(account, third.positionId(), key(), new TakeProfitRequest(n("1200"), 0L));
        mark(btc, "800");
        drain();
        assertThat(takeProfits.get(account, third.positionId()).status()).isEqualTo("EXPIRED");
        assertThat(takeProfits.get(account, third.positionId()).reason()).isEqualTo("POSITION_LIQUIDATED");

        assertThat(ledger.reconcile(account).status()).isEqualTo("MATCHED");
    }

    @Test
    void cancelAllAndCloseAllAtomicallyCleanPendingOrdersAndOpenPositionsWithMatchedLedger() throws Exception {
        String bearer = "Bearer " + actor.token();

        // Open 2 positions (BTC LONG, ETH SHORT) + create 2 pending LIMIT OPEN + 1 pending LIMIT CLOSE + active TP
        OrderResponse btcLong = open(account, btc, Position.Side.LONG, "1");
        OrderResponse ethShort = open(account, eth, Position.Side.SHORT, "5");
        orders.create(account, key(), new CreateOrderRequest(TradingOrder.Type.LIMIT, btc, Position.Side.LONG, n("0.5"), 10, n("900")));
        orders.create(account, key(), new CreateOrderRequest(TradingOrder.Type.LIMIT, eth, Position.Side.SHORT, n("2"), 10, n("250")));
        orders.createLimitClose(account, btcLong.positionId(), key(), new LimitCloseRequest(n("0.5"), n("1200")));
        takeProfits.put(account, btcLong.positionId(), key(), new TakeProfitRequest(n("1300"), 0L));

        assertThat(orders.pending(account)).hasSize(3);

        // 1. Cancel-All pending orders
        mvc.perform(post("/api/v1/trading/account/orders/cancel-all").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.canceledCount").value(3))
                .andExpect(jsonPath("$.orders.length()").value(3));

        assertThat(orders.pending(account)).isEmpty();
        assertThat(ledger.reconcile(account).status()).isEqualTo("MATCHED");

        // Calling cancel-all again returns 0 cleanly
        mvc.perform(post("/api/v1/trading/account/orders/cancel-all").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.canceledCount").value(0));

        // Add a fresh pending LIMIT CLOSE on ETH SHORT before close-all to verify close-all releases reservations too
        orders.createLimitClose(account, ethShort.positionId(), key(), new LimitCloseRequest(n("2"), n("150")));

        // 2. Close-All open positions
        mvc.perform(post("/api/v1/trading/account/positions/close-all").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.closedCount").value(2))
                .andExpect(jsonPath("$.orders.length()").value(2));

        assertThat(accounts.summary(account).positions()).isEmpty();
        assertThat(orders.pending(account)).isEmpty();
        assertThat(takeProfits.get(account, btcLong.positionId()).status()).isEqualTo("EXPIRED");
        assertThat(ledger.reconcile(account).status()).isEqualTo("MATCHED");

        // Calling close-all again returns 0 cleanly
        mvc.perform(post("/api/v1/trading/account/positions/close-all").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.closedCount").value(0));
    }

    @Test
    void eventsLatestParameterReturnsNewestEventsDescendingWhileDefaultPreservesAscendingReplay() throws Exception {
        String bearer = "Bearer " + actor.token();

        // Generate 5 distinct order events
        for (int i = 0; i < 5; i++) {
            OrderResponse limit = orders.create(
                    account, key(), new CreateOrderRequest(TradingOrder.Type.LIMIT, btc, Position.Side.LONG, n("0.1"), 10, n("900")));
            orders.cancel(account, limit.orderId());
        }
        // Now there are 10 events in total.

        // Default (latest=false) returns oldest 3 ascending
        String ascBody = mvc.perform(get("/api/v1/trading/account/events")
                        .header("Authorization", bearer)
                        .param("afterId", "0")
                        .param("limit", "3"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andReturn().getResponse().getContentAsString();
        var ascNodes = json.readTree(ascBody);
        long firstAscId = Long.parseLong(ascNodes.get(0).path("eventId").asText());
        long secondAscId = Long.parseLong(ascNodes.get(1).path("eventId").asText());
        long thirdAscId = Long.parseLong(ascNodes.get(2).path("eventId").asText());
        assertThat(firstAscId).isLessThan(secondAscId);
        assertThat(secondAscId).isLessThan(thirdAscId);

        // latest=true with afterId=0 returns newest 3 descending
        String descBody = mvc.perform(get("/api/v1/trading/account/events")
                        .header("Authorization", bearer)
                        .param("afterId", "0")
                        .param("limit", "3")
                        .param("latest", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andReturn().getResponse().getContentAsString();
        var descNodes = json.readTree(descBody);
        long firstDescId = Long.parseLong(descNodes.get(0).path("eventId").asText());
        long secondDescId = Long.parseLong(descNodes.get(1).path("eventId").asText());
        long thirdDescId = Long.parseLong(descNodes.get(2).path("eventId").asText());
        assertThat(firstDescId).isGreaterThan(secondDescId);
        assertThat(secondDescId).isGreaterThan(thirdDescId);
        assertThat(thirdDescId).isGreaterThan(thirdAscId);
    }

    private OrderResponse open(long accountId, long symbolId, Position.Side side, String qty) {
        return orders.create(accountId, key(), new CreateOrderRequest(
                TradingOrder.Type.MARKET, symbolId, side, n(qty), 10, null));
    }

    private LatestMarkPrice mark(long symbolId, String price) {
        Instant now = Instant.now();
        Instant event = prices.find(symbolId).latestPrice().map(LatestMarkPrice::eventTime)
                .filter(p -> !p.isBefore(now)).map(p -> p.plusMillis(1)).orElse(now);
        LatestMarkPrice tick = new LatestMarkPrice(symbolId, n(price), event, now);
        assertThat(prices.update(tick)).isTrue();
        return tick;
    }

    private void drain() {
        await().pollInSameThread().atMost(Duration.ofSeconds(12)).pollInterval(Duration.ofMillis(20)).until(() -> {
            worker.runOnce();
            return jdbc.queryForObject(
                    "select count(*) from trading.risk_account_work where account_id=? and status='PENDING'",
                    Long.class, account) == 0;
        });
    }

    private static BigDecimal n(String value) {
        return new BigDecimal(value);
    }

    private static String key() {
        return UUID.randomUUID().toString();
    }
}
