package com.yogimangchi.trading.execution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.execution.trigger.AccountTriggerService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.order.dto.AmendOrderRequest;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.dto.LimitCloseRequest;
import com.yogimangchi.trading.order.dto.OrderResponse;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.support.LegacyLeverageFixtures;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"binance.mark-price.enabled=false", "binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class AmendOrderIntegrationTests {

    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired SymbolLeverageService leverages;
    @Autowired AccountTriggerService trigger;
    @Autowired LatestPriceStore prices;
    @Autowired LedgerReconciler reconciler;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @MockitoBean TradingEngineGate gate;

    GuestAccountResponse guest;
    long btc;

    @BeforeEach
    void setup() {
        guest = accounts.createGuest();
        btc = jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'", Long.class);
        prices.beginSubscription(Set.of(btc));
        mark("1000");
        LegacyLeverageFixtures.bothDirections(jdbc, guest.accountId(), btc); // 10x LONG & SHORT
    }

    @AfterEach
    void cleanup() {
        prices.markUnavailable();
    }

    @Test
    void amendPendingOpenReallocatesMarginAndFeeViaHttpAndExecutesAmendedValuesCleanly() throws Exception {
        // Initial: LONG 1 BTC @ 990, 10x -> margin 99 + fee 0.297 = 99.297
        OrderResponse pending = open(TradingOrder.Type.LIMIT, Position.Side.LONG, "1", "990");
        assertThat(n(accounts.wallet(guest.accountId()).reservedMargin())).isEqualByComparingTo("99.297");

        // Increase via POST /amend: LONG 2.5 BTC @ 980, 10x -> notional 2450, margin 245 + fee 0.735 = 245.735
        String body = json.writeValueAsString(new AmendOrderRequest(n("2.5"), n("980")));
        mvc.perform(post("/api/v1/trading/account/orders/{orderId}/amend", pending.orderId())
                        .header("Authorization", "Bearer " + guest.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orderId").value(pending.orderId()))
                .andExpect(jsonPath("$.quantity").value("2.50000000"))
                .andExpect(jsonPath("$.limitPrice").value("980.000000000000000000"))
                .andExpect(jsonPath("$.reservedMargin").value("245.735000000000000000"))
                .andExpect(jsonPath("$.reservedFee").value("0.735000000000000000"));

        assertThat(n(accounts.wallet(guest.accountId()).reservedMargin())).isEqualByComparingTo("245.735");
        assertThat(reconciler.check(guest.accountId()).status()).isEqualTo("MATCHED");

        // Decrease via PATCH /orders/{orderId}: LONG 1.5 BTC @ 975, 10x -> notional 1462.5, margin 146.25 + fee 0.43875 = 146.68875
        String patchBody = json.writeValueAsString(new AmendOrderRequest(n("1.5"), n("975")));
        mvc.perform(patch("/api/v1/trading/account/orders/{orderId}", pending.orderId())
                        .header("Authorization", "Bearer " + guest.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(patchBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.quantity").value("1.50000000"))
                .andExpect(jsonPath("$.limitPrice").value("975.000000000000000000"))
                .andExpect(jsonPath("$.reservedMargin").value("146.688750000000000000"));

        assertThat(n(accounts.wallet(guest.accountId()).reservedMargin())).isEqualByComparingTo("146.68875");

        // Mark at 978 must no longer fill (old 990/980 would have crossed, amended 975 does not!)
        var tick978 = mark("978");
        trigger.process(guest.accountId(), tick978, Map.of(btc, tick978));
        assertThat(orders.pending(guest.accountId())).hasSize(1);

        // Mark at 975 fills the amended 1.5 BTC order
        var tick975 = mark("975");
        trigger.process(guest.accountId(), tick975, Map.of(btc, tick975));
        assertThat(orders.pending(guest.accountId())).isEmpty();
        var summary = accounts.summary(guest.accountId());
        assertThat(summary.positions()).hasSize(1);
        assertThat(n(summary.positions().get(0).quantity())).isEqualByComparingTo("1.5");
        assertThat(n(summary.wallet().reservedMargin())).isZero();
        assertThat(reconciler.check(guest.accountId()).status()).isEqualTo("MATCHED");
    }

    @Test
    void amendRejectsCrossingInsufficientMarginMinimumAndNonPendingOrdersWithoutMutatingLedger() {
        // Reserve nearly entire 10,000 USDT wallet: LONG 90 BTC @ 990, 10x -> margin 8910 + fee 26.73 = 8936.73
        OrderResponse pending = open(TradingOrder.Type.LIMIT, Position.Side.LONG, "90", "990");
        BigDecimal initialReserved = n(accounts.wallet(guest.accountId()).reservedMargin());
        assertThat(initialReserved).isEqualByComparingTo("8936.73");

        // Re-using own 8936.73 reservation allows amending to 100 BTC @ 990 (margin 9900 + fee 29.7 = 9929.7 <= 10000)
        OrderResponse expanded = orders.amend(guest.accountId(), pending.orderId(), new AmendOrderRequest(n("100"), n("990")));
        assertThat(n(expanded.reservedMargin())).isEqualByComparingTo("9929.7");
        assertThat(n(accounts.wallet(guest.accountId()).reservedMargin())).isEqualByComparingTo("9929.7");

        // Exceeding 10,000 USDT total wallet (101 BTC @ 990 -> 9999 + 29.997 = 10028.997 > 10000) rejects cleanly
        assertThatThrownBy(() -> orders.amend(guest.accountId(), pending.orderId(), new AmendOrderRequest(n("101"), n("990"))))
                .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getCode()).isEqualTo(ErrorCode.INSUFFICIENT_MARGIN));
        assertThat(n(accounts.wallet(guest.accountId()).reservedMargin())).isEqualByComparingTo("9929.7");

        // Crossing limit price (>= 1000 Mark for LONG) rejects cleanly
        assertThatThrownBy(() -> orders.amend(guest.accountId(), pending.orderId(), new AmendOrderRequest(n("1"), n("1000"))))
                .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getCode()).isEqualTo(ErrorCode.MARKETABLE_LIMIT_NOT_ALLOWED));

        // Below 10 USDT notional rejects cleanly
        assertThatThrownBy(() -> orders.amend(guest.accountId(), pending.orderId(), new AmendOrderRequest(n("0.005"), n("990"))))
                .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getCode()).isEqualTo(ErrorCode.INVALID_ORDER));

        // Another account cannot see or amend this order
        GuestAccountResponse intruder = accounts.createGuest();
        assertThatThrownBy(() -> orders.amend(intruder.accountId(), pending.orderId(), new AmendOrderRequest(n("1"), n("980"))))
                .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getCode()).isEqualTo(ErrorCode.ORDER_NOT_FOUND));

        // Canceled order rejects amend with ORDER_NOT_PENDING
        orders.cancel(guest.accountId(), pending.orderId());
        assertThatThrownBy(() -> orders.amend(guest.accountId(), pending.orderId(), new AmendOrderRequest(n("1"), n("980"))))
                .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getCode()).isEqualTo(ErrorCode.ORDER_NOT_PENDING));
        assertThat(reconciler.check(guest.accountId()).status()).isEqualTo("MATCHED");
    }

    @Test
    void amendPendingCloseAdjustsReservedCloseQuantityAndRespectsSiblingCloseReservations() {
        OrderResponse opened = open(TradingOrder.Type.MARKET, Position.Side.LONG, "2", null);
        OrderResponse closeA = orders.createLimitClose(guest.accountId(), opened.positionId(), key(), new LimitCloseRequest(n("0.8"), n("1050")));
        OrderResponse closeB = orders.createLimitClose(guest.accountId(), opened.positionId(), key(), new LimitCloseRequest(n("0.7"), n("1080")));

        // Position has 2.0 total, 1.5 reserved (0.8 + 0.7), 0.5 free. closeA can amend up to 0.5 + 0.8 = 1.3, not 1.4!
        assertThatThrownBy(() -> orders.amend(guest.accountId(), closeA.orderId(), new AmendOrderRequest(n("1.4"), n("1060"))))
                .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getCode()).isEqualTo(ErrorCode.CLOSE_QUANTITY_EXCEEDED));

        // Crossing LONG CLOSE (<= 1000 Mark) is rejected
        assertThatThrownBy(() -> orders.amend(guest.accountId(), closeA.orderId(), new AmendOrderRequest(n("1.2"), n("1000"))))
                .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getCode()).isEqualTo(ErrorCode.MARKETABLE_LIMIT_NOT_ALLOWED));

        // Valid amend to 1.3 @ 1060 succeeds and updates position.reservedCloseQuantity to 1.3 + 0.7 = 2.0
        OrderResponse amended = orders.amend(guest.accountId(), closeA.orderId(), new AmendOrderRequest(n("1.3"), n("1060")));
        assertThat(n(amended.quantity())).isEqualByComparingTo("1.3");
        assertThat(n(amended.reservedCloseQuantity())).isEqualByComparingTo("1.3");
        var pos = accounts.summary(guest.accountId()).positions().get(0);
        assertThat(n(pos.reservedCloseQuantity())).isEqualByComparingTo("2.0");
        assertThat(n(pos.freeCloseQuantity())).isZero();
        assertThat(reconciler.check(guest.accountId()).status()).isEqualTo("MATCHED");

        // Decreasing closeB to 0.3 frees 0.4 close quantity
        orders.amend(guest.accountId(), closeB.orderId(), new AmendOrderRequest(n("0.3"), n("1090")));
        var posAfter = accounts.summary(guest.accountId()).positions().get(0);
        assertThat(n(posAfter.reservedCloseQuantity())).isEqualByComparingTo("1.6");
        assertThat(n(posAfter.freeCloseQuantity())).isEqualByComparingTo("0.4");
        assertThat(reconciler.check(guest.accountId()).status()).isEqualTo("MATCHED");
    }

    @Test
    void concurrentTriggerFillAndAmendSerializeUnderAccountLockWithoutLedgerCorruption() throws Exception {
        OrderResponse pending = open(TradingOrder.Type.LIMIT, Position.Side.LONG, "1", "990");
        LatestMarkPrice fillTick = mark("985"); // Crosses 990; amend to 970 is passive vs 985!

        var pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<String> triggerTask = pool.submit(() -> {
                ready.countDown();
                start.await(5, TimeUnit.SECONDS);
                trigger.process(guest.accountId(), fillTick, Map.of(btc, fillTick));
                return "TRIGGER_DONE";
            });
            Future<String> amendTask = pool.submit(() -> {
                ready.countDown();
                start.await(5, TimeUnit.SECONDS);
                try {
                    orders.amend(guest.accountId(), pending.orderId(), new AmendOrderRequest(n("2"), n("970")));
                    return "AMENDED";
                } catch (BusinessException ex) {
                    return ex.getCode().name();
                }
            });
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();

            String triggerOutcome = triggerTask.get(10, TimeUnit.SECONDS);
            String amendOutcome = amendTask.get(10, TimeUnit.SECONDS);
            assertThat(triggerOutcome).isEqualTo("TRIGGER_DONE");
            // Either trigger won the lock first (order FILLED -> amend gets ORDER_NOT_PENDING)
            // OR amend won the lock first (order amended to 970 -> 985 tick does not cross 970 -> order stays PENDING @ 970, qty 2)
            assertThat(amendOutcome).isIn("ORDER_NOT_PENDING", "AMENDED");
            if ("ORDER_NOT_PENDING".equals(amendOutcome)) {
                assertThat(orders.pending(guest.accountId())).isEmpty();
                assertThat(accounts.summary(guest.accountId()).positions()).hasSize(1);
                assertThat(n(accounts.summary(guest.accountId()).positions().get(0).quantity())).isEqualByComparingTo("1");
            } else {
                assertThat(orders.pending(guest.accountId())).hasSize(1);
                assertThat(n(orders.pending(guest.accountId()).get(0).quantity())).isEqualByComparingTo("2");
                assertThat(n(orders.pending(guest.accountId()).get(0).limitPrice())).isEqualByComparingTo("970");
                assertThat(accounts.summary(guest.accountId()).positions()).isEmpty();
            }
            var reconciliation = reconciler.check(guest.accountId());
            assertThat(reconciliation.status()).isEqualTo("MATCHED");
            assertThat(reconciliation.failedChecks()).isEmpty();
        } finally {
            pool.shutdownNow();
        }
    }

    private OrderResponse open(TradingOrder.Type type, Position.Side side, String quantity, String limit) {
        return orders.create(
                guest.accountId(),
                key(),
                new CreateOrderRequest(
                        type,
                        btc,
                        side,
                        n(quantity),
                        leverages.current(guest.accountId(), btc, side),
                        limit == null ? null : n(limit)));
    }

    private LatestMarkPrice mark(String amount) {
        Instant now = Instant.now();
        Instant event = prices.find(btc)
                .latestPrice()
                .map(LatestMarkPrice::eventTime)
                .filter(p -> !p.isBefore(now))
                .map(p -> p.plusNanos(1))
                .orElse(now);
        var tick = new LatestMarkPrice(btc, n(amount), event, now);
        assertThat(prices.update(tick)).isTrue();
        return tick;
    }

    private static BigDecimal n(String amount) {
        return new BigDecimal(amount);
    }

    private static String key() {
        return UUID.randomUUID().toString();
    }
}
