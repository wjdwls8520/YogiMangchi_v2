package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.fill.repository.FillRepository;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.dto.OrderResponse;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.function.IntFunction;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = "binance.mark-price.enabled=false")
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class MarketOrderIntegrationTests {
    @Autowired MarketOrderService service;
    @Autowired TradingAccountService accounts;
    @Autowired LatestPriceStore prices;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @MockitoSpyBean FillRepository fills;
    GuestAccountResponse guest;
    long symbol;

    @BeforeEach void setup() {
        guest = accounts.createGuest();
        symbol = jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'", Long.class);
        prices.beginSubscription(Set.of(symbol));
        price("1000");
    }
    @AfterEach void cleanup() { reset(fills); prices.markUnavailable(); }

    @Test void longAndShortUseServerPriceAndCloseWithRealizedPnl() {
        OrderResponse longOrder = create("2", Position.Side.LONG, 10, key());
        OrderResponse shortOrder = create("1", Position.Side.SHORT, 5, key());
        assertThat(longOrder.fill().price()).isEqualTo("1000.000000000000000000");
        amount("used_margin", "400");
        price("1100");
        assertThat(accounts.summary(guest.accountId()).wallet().unrealizedPnl()).isEqualTo("100.000000000000000000");
        service.close(guest.accountId(), longOrder.positionId(), key());
        service.close(guest.accountId(), shortOrder.positionId(), key());
        amount("balance", "10100"); amount("realized_pnl", "100"); amount("used_margin", "0");
        assertThat(count("trading_order")).isEqualTo(4);
        assertThat(count("position")).isEqualTo(2);
        assertThat(service.history(guest.accountId(), null, 2)).hasSize(2);
    }

    @Test void replaySurvivesUnavailablePricesAndChangedPayloadConflicts() {
        String key = key();
        OrderResponse original = create("1", Position.Side.LONG, 2, key);
        prices.markUnavailable();
        assertThat(create("1.0", Position.Side.LONG, 2, key)).isEqualTo(original);
        rejects(() -> create("2", Position.Side.LONG, 2, key), ErrorCode.IDEMPOTENCY_CONFLICT);
        rejects(() -> create("1", Position.Side.LONG, 2, key()), ErrorCode.PRICE_NOT_FRESH);
        price("1001"); // A new subscription is required after disconnection.
        prices.beginSubscription(Set.of(symbol)); price("1002");
        String closeKey = key();
        OrderResponse close = service.close(guest.accountId(), original.positionId(), closeKey);
        prices.markUnavailable();
        assertThat(service.close(guest.accountId(), original.positionId(), closeKey)).isEqualTo(close);
    }

    @Test void stalePriceIsRejectedAndNoFinancialWritesRemain() {
        prices.beginSubscription(Set.of(symbol));
        // Existing data remains unavailable until a new accepted tick.
        rejects(() -> create("1", Position.Side.LONG, 2, key()), ErrorCode.PRICE_NOT_FRESH);
        assertThat(count("trading_order")).isZero(); amount("used_margin", "0");
    }

    @Test void unsupportedQuantityAndInactiveSymbolAreRejected() {
        rejects(() -> create("1E+100000", Position.Side.LONG, 1, key()), ErrorCode.INVALID_ORDER);
        jdbc.update("update trading.trading_symbol set status='INACTIVE' where id=?", symbol);
        try { rejects(() -> create("1", Position.Side.LONG, 1, key()), ErrorCode.SYMBOL_NOT_AVAILABLE); }
        finally { jdbc.update("update trading.trading_symbol set status='ACTIVE' where id=?", symbol); }
    }

    @Test void simultaneousOrdersCannotOverspendWallet() throws Exception {
        List<Object> results = concurrent(8, i -> create("5", Position.Side.LONG, 1, key()));
        assertThat(results.stream().filter(OrderResponse.class::isInstance)).hasSize(2);
        assertThat(results.stream().filter(BusinessException.class::isInstance).map(BusinessException.class::cast))
                .allMatch(e -> e.getCode() == ErrorCode.INSUFFICIENT_MARGIN);
        amount("used_margin", "10000"); amount("balance", "10000");
        assertThat(count("trading_order")).isEqualTo(2);
    }

    @Test void simultaneousDuplicateRequestsCreateExactlyOneFill() throws Exception {
        String key = key();
        List<Object> results = concurrent(8, i -> create("1", Position.Side.SHORT, 2, key));
        assertThat(results).allMatch(OrderResponse.class::isInstance);
        assertThat(results.stream().distinct()).hasSize(1);
        assertThat(count("trading_order")).isEqualTo(1); assertThat(count("position")).isEqualTo(1);
        assertThat(fillCount()).isEqualTo(1); amount("used_margin", "500");
    }

    @Test void simultaneousCloseAndOpenPreserveBothChanges() throws Exception {
        OrderResponse initial = create("1", Position.Side.LONG, 1, key());
        price("1100");
        assertThat(concurrent(2, i -> i == 0 ? service.close(guest.accountId(), initial.positionId(), key())
                : create("1", Position.Side.LONG, 1, key()))).allMatch(OrderResponse.class::isInstance);
        amount("balance", "10100"); amount("used_margin", "1100");
        assertThat(fillCount()).isEqualTo(3);
    }

    @Test void twoCloseRequestsDoNotRealizePnlTwice() throws Exception {
        OrderResponse initial = create("1", Position.Side.LONG, 1, key()); price("1100");
        List<Object> results = concurrent(2, i -> service.close(guest.accountId(), initial.positionId(), key()));
        assertThat(results.stream().filter(OrderResponse.class::isInstance)).hasSize(1);
        assertThat(results.stream().filter(BusinessException.class::isInstance).map(BusinessException.class::cast))
                .extracting(BusinessException::getCode).containsExactly(ErrorCode.POSITION_NOT_OPEN);
        amount("balance", "10100"); amount("used_margin", "0"); assertThat(fillCount()).isEqualTo(2);
    }

    @Test void failureAfterPositionAndOrderInsertRollsBackEveryFinancialChange() {
        doThrow(new IllegalStateException("injected fill write failure")).when(fills).save(any());
        assertThatThrownBy(() -> create("1", Position.Side.LONG, 2, key())).isInstanceOf(IllegalStateException.class);
        assertThat(count("position")).isZero(); assertThat(count("trading_order")).isZero(); assertThat(fillCount()).isZero();
        amount("balance", "10000"); amount("used_margin", "0");
    }

    @Test void apiRequiresCredentialAndHidesOtherAccountsAndProviderData() throws Exception {
        String body = "{\"type\":\"MARKET\",\"tradingSymbolId\":" + symbol + ",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":2,\"price\":1}";
        mvc.perform(post("/api/v1/trading/account/orders").header("Idempotency-Key", key()).contentType("application/json").content(body))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/trading/account/orders").header("Authorization", "Bearer " + guest.accessToken())
                        .header("Idempotency-Key", key()).contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.fill.price").value("1000.000000000000000000"))
                .andExpect(jsonPath("$.accountId").doesNotExist()).andExpect(jsonPath("$.providerSymbol").doesNotExist());
        long position = service.history(guest.accountId(), null, 1).get(0).positionId();
        var other = accounts.createGuest();
        mvc.perform(post("/api/v1/trading/account/positions/" + position + "/close").header("Authorization", "Bearer " + other.accessToken())
                        .header("Idempotency-Key", key())).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/trading/account/orders").header("Authorization", "Bearer " + other.accessToken()))
                .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
    }

    private OrderResponse create(String quantity, Position.Side side, int leverage, String key) {
        return service.create(guest.accountId(), key, new CreateOrderRequest(TradingOrder.Type.MARKET, symbol, side, new BigDecimal(quantity), leverage));
    }
    private void price(String price) { Instant now = Instant.now(); prices.update(new LatestMarkPrice(symbol, new BigDecimal(price), now, now)); }
    private static String key() { return UUID.randomUUID().toString(); }
    private long count(String table) { return jdbc.queryForObject("select count(*) from trading." + table + " where account_id=?", Long.class, guest.accountId()); }
    private long fillCount() { return jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?", Long.class, guest.accountId()); }
    private void amount(String column, String expected) {
        assertThat(jdbc.queryForObject("select " + column + " from trading.wallet where account_id=?", BigDecimal.class, guest.accountId()))
                .isEqualByComparingTo(expected);
    }
    private static void rejects(Runnable action, ErrorCode code) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getCode()).isEqualTo(code));
    }
    private static List<Object> concurrent(int count, IntFunction<Object> action) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(count);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Object>> futures = new ArrayList<>();
            for (int index = 0; index < count; index++) {
                int task = index;
                futures.add(pool.submit(() -> { start.await(); try { return action.apply(task); } catch (BusinessException e) { return e; } }));
            }
            start.countDown();
            List<Object> results = new ArrayList<>();
            for (Future<Object> future : futures) results.add(future.get(10, TimeUnit.SECONDS));
            return results;
        } finally { pool.shutdownNow(); }
    }
}
