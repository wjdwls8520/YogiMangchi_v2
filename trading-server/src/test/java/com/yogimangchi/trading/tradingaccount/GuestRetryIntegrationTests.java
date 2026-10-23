package com.yogimangchi.trading.tradingaccount;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@AutoConfigureMockMvc @Import(PostgresTestConfiguration.class)
class GuestRetryIntegrationTests {
    static final String URL="/api/v1/trading/account/retry";
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired TradingAccountService accounts;
    @Autowired GuestRetryService retries;
    @Autowired TradingOrderService orders;
    @Autowired LatestPriceStore prices;
    @Autowired UnusedGuestCleanupService cleanup;
    @MockitoBean TradingEngineGate gate;
    GuestAccountResponse guest;
    long btc;
    @BeforeEach void setup() {
        guest=accounts.createGuest(); btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc)); price("1000");
    }
    @AfterEach void stop() { prices.markUnavailable(); }

    @Test void retryKeepsIdentityAndHistoryCancelsReservationsAndResetsCashWithoutPricesOrFees() throws Exception {
        var opened=orders.create(guest.accountId(),key(),open(TradingOrder.Type.MARKET,Position.Side.LONG,null));
        price("1050");
        orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(new BigDecimal("0.1")));
        orders.createLimitClose(guest.accountId(),opened.positionId(),key(),new LimitCloseRequest(new BigDecimal("0.7"),new BigDecimal("1100")));
        orders.create(guest.accountId(),key(),open(TradingOrder.Type.LIMIT,Position.Side.SHORT,new BigDecimal("1100")));
        var identity=jdbc.queryForMap("select id,created_at,credential_hash,credential_expires_at from trading.trading_account where id=?",guest.accountId());
        var ledger=jdbc.queryForMap("select realized_pnl,fees_paid,settlement_adjustment from trading.wallet where account_id=?",guest.accountId());
        long fills=jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,guest.accountId());
        prices.markUnavailable();
        mvc.perform(post(URL).header("Authorization",bearer()).header("Idempotency-Key",key())).andExpect(status().isOk())
                .andExpect(jsonPath("$.accountId").value(guest.accountId())).andExpect(jsonPath("$.balance").value("10000.000000000000000000"))
                .andExpect(jsonPath("$.canceledOrderCount").value(2)).andExpect(jsonPath("$.closedPositionCount").value(1))
                .andExpect(jsonPath("$.accessToken").doesNotExist());
        assertThat(jdbc.queryForMap("select id,created_at,credential_hash,credential_expires_at from trading.trading_account where id=?",guest.accountId())).isEqualTo(identity);
        assertThat(jdbc.queryForMap("select realized_pnl,fees_paid,settlement_adjustment from trading.wallet where account_id=?",guest.accountId())).isEqualTo(ledger);
        assertThat(jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,guest.accountId())).isEqualTo(fills);
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='CLOSED' and close_reason='GUEST_RETRY' and exit_price is null",Long.class,guest.accountId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='CANCELED' and reason='GUEST_RETRY'",Long.class,guest.accountId())).isEqualTo(2);
        assertThat(jdbc.queryForObject("select capital_adjustment from trading.guest_retry where account_id=?",BigDecimal.class,guest.accountId())).isNegative(); // Reset may remove profits, not just top up losses.
        assertThat(jdbc.queryForObject("select used_margin+reserved_margin from trading.wallet where account_id=?",BigDecimal.class,guest.accountId())).isZero();
        mvc.perform(get("/api/v1/trading/account/wallet").header("Authorization",bearer())).andExpect(status().isOk()).andExpect(jsonPath("$.balance").value("10000.000000000000000000"));
    }
    @Test void replayingTheSameKeyReturnsOriginalSnapshotWithoutResettingNewTrades() {
        String key=key(); var first=retries.retry(guest.accountId(),key);
        orders.create(guest.accountId(),key(),open(TradingOrder.Type.MARKET,Position.Side.LONG,null));
        BigDecimal afterTrade=amount("balance");
        assertThat(retries.retry(guest.accountId(),key)).isEqualTo(first);
        assertThat(amount("balance")).isEqualByComparingTo(afterTrade);
        assertThat(retries.retry(guest.accountId(),key()).retryId()).isNotEqualTo(first.retryId());
        assertThat(amount("balance")).isEqualByComparingTo("10000");
    }
    @Test void callerCannotChooseAnotherAccountOrBalanceAndKeysAreScopedToOwnAccount() throws Exception {
        var other=accounts.createGuest();
        jdbc.update("update trading.wallet set balance=123 where account_id=?",other.accountId());
        String key=key();
        mvc.perform(post(URL).header("Authorization",bearer()).header("Idempotency-Key",key).contentType("application/json")
                .content(json.writeValueAsString(Map.of("accountId",other.accountId(),"balance","999999"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.accountId").value(guest.accountId()));
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,other.accountId())).isEqualByComparingTo("123");
        var own=retries.retry(guest.accountId(),key); var theirs=retries.retry(other.accountId(),key);
        assertThat(own.retryId()).isNotEqualTo(theirs.retryId());
    }
    @Test void missingInvalidAndExpiredCredentialsAndMissingKeysNeverResetFunds() throws Exception {
        mvc.perform(post(URL).header("Idempotency-Key",key())).andExpect(status().isUnauthorized());
        mvc.perform(post(URL).header("Authorization","Bearer invalid").header("Idempotency-Key",key())).andExpect(status().isUnauthorized());
        mvc.perform(post(URL).header("Authorization",bearer())).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_IDEMPOTENCY_KEY"));
        mvc.perform(post(URL).header("Authorization",bearer()).header("Idempotency-Key","short")).andExpect(status().isBadRequest());
        jdbc.update("update trading.trading_account set credential_expires_at=now()-interval '1 second' where id=?",guest.accountId());
        mvc.perform(post(URL).header("Authorization",bearer()).header("Idempotency-Key",key())).andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("select count(*) from trading.guest_retry where account_id=?",Long.class,guest.accountId())).isZero();
    }
    @Test void bankruptAndLegacyHeldGuestsCanRetryWithoutChangingCredentialLifetime() {
        jdbc.update("update trading.trading_account set status='BANKRUPT',margin_transition_status='REVIEW_REQUIRED',isolated_activated_at=null where id=?",guest.accountId());
        jdbc.update("update trading.wallet set balance=0 where account_id=?",guest.accountId());
        var expiry=jdbc.queryForObject("select credential_expires_at from trading.trading_account where id=?",java.sql.Timestamp.class,guest.accountId());
        retries.retry(guest.accountId(),key());
        assertThat(jdbc.queryForObject("select status||'/'||margin_transition_status from trading.trading_account where id=?",String.class,guest.accountId())).isEqualTo("ACTIVE/COMPLETE");
        assertThat(amount("balance")).isEqualByComparingTo("10000");
        assertThat(jdbc.queryForObject("select credential_expires_at from trading.trading_account where id=?",java.sql.Timestamp.class,guest.accountId())).isEqualTo(expiry);
    }
    @Test void simultaneousDuplicateRequestsCreateExactlyOneDurableRetry() throws Exception {
        var start=new CountDownLatch(1); var pool=Executors.newFixedThreadPool(4); String key=key();
        try {
            var tasks=new ArrayList<Future<Long>>();
            for(int i=0;i<4;i++) tasks.add(pool.submit(() -> { start.await(); return retries.retry(guest.accountId(),key).retryId(); }));
            start.countDown(); var ids=new HashSet<Long>(); for(var task:tasks) ids.add(task.get(10,TimeUnit.SECONDS));
            assertThat(ids).hasSize(1);
            assertThat(jdbc.queryForObject("select count(*) from trading.guest_retry where account_id=?",Long.class,guest.accountId())).isEqualTo(1);
        } finally { start.countDown(); pool.shutdownNow(); }
    }
    @Test void inconsistentReservationsRollBackCashPositionOrdersEventsAndRetryRecord() {
        orders.create(guest.accountId(),key(),open(TradingOrder.Type.MARKET,Position.Side.LONG,null));
        orders.create(guest.accountId(),key(),open(TradingOrder.Type.LIMIT,Position.Side.LONG,new BigDecimal("900")));
        jdbc.update("update trading.wallet set used_margin=used_margin+1 where account_id=?",guest.accountId());
        var wallet=jdbc.queryForMap("select * from trading.wallet where account_id=?",guest.accountId());
        long events=jdbc.queryForObject("select count(*) from trading.trading_event where account_id=?",Long.class,guest.accountId());
        assertThatThrownBy(() -> retries.retry(guest.accountId(),key())).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForMap("select * from trading.wallet where account_id=?",guest.accountId())).isEqualTo(wallet);
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='OPEN'",Long.class,guest.accountId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'",Long.class,guest.accountId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_event where account_id=?",Long.class,guest.accountId())).isEqualTo(events);
        assertThat(jdbc.queryForObject("select count(*) from trading.guest_retry where account_id=?",Long.class,guest.accountId())).isZero();
    }
    @Test void concurrentOrderAndRetryRespectCommitOrderWithoutUnbackedReservations() throws Exception {
        var start=new CountDownLatch(1); var pool=Executors.newFixedThreadPool(2);
        try {
            var order=pool.submit(() -> { start.await(); return orders.create(guest.accountId(),key(),open(TradingOrder.Type.LIMIT,Position.Side.LONG,new BigDecimal("900"))); });
            var retry=pool.submit(() -> { start.await(); return retries.retry(guest.accountId(),key()); });
            start.countDown(); var placed=order.get(10,TimeUnit.SECONDS); var reset=retry.get(10,TimeUnit.SECONDS);
            String status=jdbc.queryForObject("select status from trading.trading_order where id=?",String.class,placed.orderId());
            if(status.equals("CANCELED")) { assertThat(reset.canceledOrderCount()).isEqualTo(1); assertThat(amount("reserved_margin")).isZero(); }
            else {
                assertThat(status).isEqualTo("PENDING"); assertThat(reset.canceledOrderCount()).isZero();
                assertThat(amount("reserved_margin")).isEqualByComparingTo(jdbc.queryForObject("select reserved_margin from trading.trading_order where id=?",BigDecimal.class,placed.orderId()));
            }
            assertThat(amount("balance")).isEqualByComparingTo("10000");
        } finally { start.countDown(); pool.shutdownNow(); }
    }
    @Test void cleanupNeverDeletesRetainedRetryHistoryAndDocsRequireGuestAndRequestKey() throws Exception {
        retries.retry(guest.accountId(),key());
        jdbc.update("update trading.trading_account set created_at=now()-interval '30 days',last_financial_change_at=now()-interval '30 days',credential_expires_at=now()-interval '15 days' where id=?",guest.accountId());
        cleanup.cleanupBatch();
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_account where id=?",Long.class,guest.accountId())).isEqualTo(1);
        var api=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var method=api.path("paths").path(URL).path("post");
        assertThat(method.path("security").toString()).contains("guestBearer").doesNotContain("memberBearer");
        assertThat(method.path("parameters").toString()).contains("Idempotency-Key","\"required\":true");
    }
    private CreateOrderRequest open(TradingOrder.Type type,Position.Side side,BigDecimal limit) { return new CreateOrderRequest(type,btc,side,BigDecimal.ONE,10,limit); }
    private void price(String value) { Instant at=Instant.now(); assertThat(prices.update(new LatestMarkPrice(btc,new BigDecimal(value),at,at))).isTrue(); }
    private String bearer() { return "Bearer "+guest.accessToken(); }
    private static String key() { return UUID.randomUUID().toString(); }
    private BigDecimal amount(String column) { return jdbc.queryForObject("select "+column+" from trading.wallet where account_id=?",BigDecimal.class,guest.accountId()); }
}
