package com.yogimangchi.trading.ops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.yogimangchi.trading.contest.ContestSettlementService;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.AccountTriggerService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.dto.OrderResponse;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.service.IsolatedMargin;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.stoploss.StopLossRequest;
import com.yogimangchi.trading.stoploss.StopLossService;
import com.yogimangchi.trading.support.LegacyLeverageFixtures;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.takeprofit.TakeProfitRequest;
import com.yogimangchi.trading.takeprofit.TakeProfitService;
import com.yogimangchi.trading.tradingaccount.service.MemberAccounts;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import com.yogimangchi.trading.tradinground.MemberRounds;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "binance.mark-price.enabled=false",
        "binance.order-book.enabled=false",
        "trading.member-auth.enabled=true",
        "trading.contest.auto-settlement-enabled=false",
        "trading.risk-journal.enabled=false"
})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class Pass2GapClosureIntegrationTests {

    private static final RSAKey KEY = generateKey();
    private static final Path PUBLIC_KEY = writePublicKeyFile();
    private static final JwtEncoder ENCODER = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(KEY)));
    private static final AtomicLong MEMBERS = new AtomicLong(98_000_000L);

    @DynamicPropertySource
    static void jwtSettings(DynamicPropertyRegistry registry) {
        registry.add("trading.member-auth.public-key-path", PUBLIC_KEY::toString);
        registry.add("trading.member-auth.issuer", () -> "https://content.test");
    }

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private MemberAccounts memberAccounts;
    @Autowired private MemberRounds memberRounds;
    @Autowired private TradingOrderService orderService;
    @Autowired private SymbolLeverageService leverageService;
    @Autowired private StopLossService stopLossService;
    @Autowired private TakeProfitService takeProfitService;
    @Autowired private AccountTriggerService accountTriggerService;
    @Autowired private ContestSettlementService settlementService;
    @Autowired private TradingEvents tradingEvents;
    @Autowired private LatestPriceStore prices;
    @Autowired private LedgerReconciler reconciler;
    @MockitoBean private TradingEngineGate gate;
    @MockitoSpyBean private IsolatedMargin isolatedMargin;

    private long btc;
    private long eth;

    @BeforeEach
    void setup() {
        Mockito.reset(isolatedMargin);
        btc = jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'", Long.class);
        eth = jdbc.queryForObject("select id from trading.trading_symbol where symbol='ETH'", Long.class);
        jdbc.update("update trading.trading_symbol set status = 'ACTIVE' where id in (?, ?)", btc, eth);
        prices.beginSubscription(Set.of(btc, eth));
        mark(btc, "1000");
        mark(eth, "200");
        Mockito.when(gate.status()).thenReturn("READY");
    }

    @AfterEach
    void cleanup() {
        Mockito.reset(isolatedMargin);
        jdbc.update("update trading.trading_symbol set status = 'ACTIVE' where id in (?, ?)", btc, eth);
        prices.markUnavailable();
    }

    @Test
    void t1_stopLossGapLeavingZeroBalanceDeclaresBankruptCleanly() throws Exception {
        // Part A: Exercises the post-SL/TP bankruptcy guard directly (exact zero balance settled by SL execution).
        long memberId = MEMBERS.incrementAndGet();
        long accountId = memberAccounts.open(memberId).accountId();
        leverageService.change(accountId, btc, Position.Side.LONG, 2);

        // entry=1999, qty=1, lev=2 -> margin=999.5, openFee=0.9995; seed exact wallet=1000.4995 so free cash=0
        mark(btc, "1999");
        jdbc.update("update trading.wallet set balance = 1000.4995 where account_id = ?", accountId);
        OrderResponse opened = orderService.create(accountId, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, new BigDecimal("1"), 2, null));
        stopLossService.put(accountId, opened.positionId(), key(), new StopLossRequest(new BigDecimal("1500"), 0L));

        Thread.sleep(5);
        // At gap mark=1000: pnl = -999, closeFee = 0.5, net = -999.5 -> wallet balance drops to exact 0.
        LatestMarkPrice gapTick = mark(btc, "1000");
        doReturn(new IsolatedMargin.Risk(
                new BigDecimal("-999"), new BigDecimal("10"), new BigDecimal("1"), new BigDecimal("0.5")))
                .when(isolatedMargin).risk(any(Position.class), argThat(m -> m != null && m.compareTo(new BigDecimal("1000")) == 0));
        try {
            accountTriggerService.process(accountId, gapTick, Map.of(btc, gapTick));
        } finally {
            Mockito.reset(isolatedMargin);
        }

        assertThat(stopLossService.get(accountId, opened.positionId()).status()).isEqualTo("TRIGGERED");
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id = ?", BigDecimal.class, accountId))
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id = ? and status = 'OPEN'", Long.class, accountId))
                .isZero();
        assertThat(jdbc.queryForObject("select status from trading.trading_account where id = ?", String.class, accountId))
                .isEqualTo("BANKRUPT");

        // Part B: Completely unmocked SL gap past liquidation also results in BANKRUPT with MATCHED ledger.
        long memberId2 = MEMBERS.incrementAndGet();
        long accountId2 = memberAccounts.open(memberId2).accountId();
        leverageService.change(accountId2, btc, Position.Side.LONG, 10);
        mark(btc, "1000");
        // Set exact initial balance via a real losing trade? Even simpler: open 100 BTC @ 1000, 10x -> margin=10000 impossible due to fee,
        // so open 99.5 BTC @ 1000, 10x -> margin=9950, openFee=49.75 -> total 9999.75; or set exact test fixture balance=100.5.
        jdbc.update("update trading.wallet set balance = 100.5 where account_id = ?", accountId2);
        OrderResponse opened2 = orderService.create(accountId2, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, new BigDecimal("1"), 10, null));
        stopLossService.put(accountId2, opened2.positionId(), key(), new StopLossRequest(new BigDecimal("960"), 0L));
        Thread.sleep(5);
        LatestMarkPrice crashTick = mark(btc, "850");
        accountTriggerService.process(accountId2, crashTick, Map.of(btc, crashTick));

        assertThat(jdbc.queryForObject("select status from trading.trading_account where id = ?", String.class, accountId2))
                .isEqualTo("BANKRUPT");
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id = ?", BigDecimal.class, accountId2))
                .isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    void t2_bankruptMemberRestartUsesFiveMinuteFloorAndMaxThreePer24HoursWhileActiveKeeps24hCooldown() throws Exception {
        long memberId = MEMBERS.incrementAndGet();
        String bearer = "Bearer " + memberToken(memberId);
        long accountId = memberAccounts.open(memberId).accountId();

        // 1. Voluntary restart while ACTIVE -> sets normal 24h cooldown
        memberRounds.restart(accountId, key());
        mvc.perform(get("/api/v1/trading/account/rounds/current").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.restartAvailable").value(false))
                .andExpect(jsonPath("$.nextAvailableAt").isNotEmpty());

        // Still ACTIVE -> cannot restart within 24h
        mvc.perform(post("/api/v1/trading/account/restart")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key()))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("MEMBER_RESTART_LIMITED"))
                .andExpect(jsonPath("$.nextAvailableAt").isNotEmpty());

        // 2. Account becomes BANKRUPT right away (within 5m of last restart) -> 5-minute anti-abuse floor applies!
        jdbc.update("update trading.wallet set balance = 0 where account_id = ?", accountId);
        jdbc.update("update trading.trading_account set status = 'BANKRUPT' where id = ?", accountId);

        String withinFloorBody = mvc.perform(get("/api/v1/trading/account/rounds/current").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.restartAvailable").value(false))
                .andReturn().getResponse().getContentAsString();
        Instant floorNext = Instant.parse(json.readTree(withinFloorBody).path("nextAvailableAt").asText());
        Instant lastRestart = jdbc.queryForObject(
                "select max(restarted_at) from trading.member_restart where account_id = ?",
                java.sql.Timestamp.class, accountId).toInstant();
        assertThat(floorNext).isEqualTo(lastRestart.plusSeconds(MemberRounds.BANKRUPT_RESTART_COOLDOWN_SECONDS));

        mvc.perform(post("/api/v1/trading/account/restart")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key()))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("MEMBER_RESTART_LIMITED"))
                .andExpect(jsonPath("$.nextAvailableAt").value(floorNext.toString()));

        // 3. After 5 minutes pass (well before 24h!), bankrupt restart #1 succeeds!
        jdbc.update("update trading.member_restart set restarted_at = clock_timestamp() - interval '6 minutes' where account_id = ?", accountId);
        mvc.perform(get("/api/v1/trading/account/rounds/current").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.restartAvailable").value(true));

        mvc.perform(post("/api/v1/trading/account/restart")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roundNumber").value(3));

        // 4. Bankrupt restart #2 (backdate prior restarts by 6 minutes so floor is cleared)
        jdbc.update("update trading.member_restart set restarted_at = restarted_at - interval '6 minutes' where account_id = ?", accountId);
        jdbc.update("update trading.wallet set balance = 0 where account_id = ?", accountId);
        jdbc.update("update trading.trading_account set status = 'BANKRUPT' where id = ?", accountId);
        mvc.perform(post("/api/v1/trading/account/restart")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roundNumber").value(4));

        // 5. Bankrupt restart #3 succeeds
        jdbc.update("update trading.member_restart set restarted_at = restarted_at - interval '6 minutes' where account_id = ?", accountId);
        jdbc.update("update trading.wallet set balance = 0 where account_id = ?", accountId);
        jdbc.update("update trading.trading_account set status = 'BANKRUPT' where id = ?", accountId);
        mvc.perform(post("/api/v1/trading/account/restart")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roundNumber").value(5));

        // 6. Bankrupt restart #4 within 24h is REJECTED even after 5 minutes elapse!
        jdbc.update("update trading.member_restart set restarted_at = restarted_at - interval '6 minutes' where account_id = ?", accountId);
        jdbc.update("update trading.wallet set balance = 0 where account_id = ?", accountId);
        jdbc.update("update trading.trading_account set status = 'BANKRUPT' where id = ?", accountId);

        Instant oldestOfThree = jdbc.queryForObject("""
                select min(restarted_at) from (
                    select restarted_at from trading.member_restart
                    where account_id = ? and balance_before <= 0
                    order by restarted_at desc limit 3
                ) t
                """, java.sql.Timestamp.class, accountId).toInstant();
        Instant expectedQuotaExpiry = oldestOfThree.plusSeconds(MemberRounds.NORMAL_RESTART_COOLDOWN_SECONDS);

        mvc.perform(get("/api/v1/trading/account/rounds/current").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.restartAvailable").value(false))
                .andExpect(jsonPath("$.nextAvailableAt").value(expectedQuotaExpiry.toString()));

        mvc.perform(post("/api/v1/trading/account/restart")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key()))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("MEMBER_RESTART_LIMITED"))
                .andExpect(jsonPath("$.nextAvailableAt").value(expectedQuotaExpiry.toString()));
    }

    @Test
    void t3_contestSeasonStatusGuardsRejectUncancelAndCancelingSettledSeason() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        String adminBearer = "Bearer " + adminToken(adminId);
        Instant now = Instant.now();

        // 1. Canceled season cannot be un-canceled
        long canceledSeasonId = createSeason(adminBearer, "취소복구금지 시즌", "10000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));

        mvc.perform(patch("/api/v1/trading/admin/contest/seasons/" + canceledSeasonId + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"isCanceled\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isCanceled").value(true));

        mvc.perform(patch("/api/v1/trading/admin/contest/seasons/" + canceledSeasonId + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"isCanceled\":false}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CONTEST_REQUEST"));

        // Toggling visibility (isPublic) without changing isCanceled remains allowed
        mvc.perform(patch("/api/v1/trading/admin/contest/seasons/" + canceledSeasonId + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"isPublic\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isPublic").value(false))
                .andExpect(jsonPath("$.isCanceled").value(true));

        // 2. Settled season cannot be canceled
        long settledSeasonId = createSeason(adminBearer, "정산완료취소금지 시즌", "10000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));
        settlementService.settleSeason(settledSeasonId, "ADMIN:" + adminId, true);

        mvc.perform(patch("/api/v1/trading/admin/contest/seasons/" + settledSeasonId + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"isCanceled\":true}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CONTEST_REQUEST"));

        assertThat(jdbc.queryForObject(
                "select is_canceled from trading.contest_season where id = ?", Boolean.class, settledSeasonId))
                .isFalse();
    }

    @Test
    void t5_t6_t7_authProblemHasRequestIdNotificationNotFoundDedicatedCodeAndCanceledTpDeleteSkipsRedundantEvent() throws Exception {
        // T-5: 401 from TradingTokenFilter and SecurityConfig includes requestId matching X-Request-Id
        mvc.perform(get("/api/v1/trading/account/wallet")
                        .header("X-Request-Id", "auth-req-11112222"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("X-Request-Id", "auth-req-11112222"))
                .andExpect(jsonPath("$.code").value("GUEST_CREDENTIAL_REQUIRED"))
                .andExpect(jsonPath("$.requestId").value("auth-req-11112222"));

        mvc.perform(get("/api/v1/trading/account/wallet")
                        .header("Authorization", "Bearer bad.jwt.value")
                        .header("X-Request-Id", "auth-req-33334444"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("X-Request-Id", "auth-req-33334444"))
                .andExpect(jsonPath("$.code").value("INVALID_ACCESS_TOKEN"))
                .andExpect(jsonPath("$.requestId").value("auth-req-33334444"));

        // T-6: Missing notification returns 404 NOTIFICATION_NOT_FOUND (never ORDER_NOT_FOUND)
        long memberId = MEMBERS.incrementAndGet();
        String memberBearer = "Bearer " + memberToken(memberId);
        long accountId = memberAccounts.open(memberId).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc, accountId, btc);

        mvc.perform(put("/api/v1/trading/notifications/999999999/read")
                        .header("Authorization", memberBearer))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOTIFICATION_NOT_FOUND"));

        mvc.perform(delete("/api/v1/trading/notifications/999999999")
                        .header("Authorization", memberBearer))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOTIFICATION_NOT_FOUND"));

        // T-7: Deleting an already-canceled TP with a new Idempotency-Key emits zero extra TAKE_PROFIT_CHANGED events
        OrderResponse opened = orderService.create(accountId, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, BigDecimal.ONE, 10, null));
        takeProfitService.put(accountId, opened.positionId(), key(), new TakeProfitRequest(new BigDecimal("1200"), 0L));
        takeProfitService.delete(accountId, opened.positionId(), key(), 1L);

        long tpEventsAfterFirstCancel = tradingEvents.after(accountId, 0, 100).stream()
                .filter(e -> "TAKE_PROFIT_CHANGED".equals(e.type()))
                .count();
        assertThat(tpEventsAfterFirstCancel).isEqualTo(2L);

        // Second DELETE on already-canceled TP (version 2) with a brand new key must succeed without emitting another event
        var secondCancel = takeProfitService.delete(accountId, opened.positionId(), key(), 2L);
        assertThat(secondCancel.status()).isEqualTo("CANCELED");
        assertThat(secondCancel.version()).isEqualTo(2L);

        long tpEventsAfterSecondCancel = tradingEvents.after(accountId, 0, 100).stream()
                .filter(e -> "TAKE_PROFIT_CHANGED".equals(e.type()))
                .count();
        assertThat(tpEventsAfterSecondCancel).isEqualTo(2L);
    }

    @Test
    void t8_adminSymbolHaltAndResumeEndpointControlsPublicListingAndNewOrderAdmission() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long memberId = MEMBERS.incrementAndGet();
        String adminBearer = "Bearer " + adminToken(adminId);
        String memberBearer = "Bearer " + memberToken(memberId);
        long accountId = memberAccounts.open(memberId).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc, accountId, btc);

        // Role enforcement: unauthenticated 401, non-admin 403
        mvc.perform(get("/api/v1/trading/admin/symbols")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/trading/admin/symbols").header("Authorization", memberBearer)).andExpect(status().isForbidden());
        mvc.perform(patch("/api/v1/trading/admin/symbols/" + btc + "/status")
                        .header("Authorization", memberBearer)
                        .contentType("application/json")
                        .content("{\"status\":\"HALTED\"}"))
                .andExpect(status().isForbidden());

        // Validation errors: invalid status -> 400 INVALID_SYMBOL_STATUS, missing symbol -> 404 TRADING_SYMBOL_NOT_FOUND
        mvc.perform(patch("/api/v1/trading/admin/symbols/" + btc + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"status\":\"DELETED\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SYMBOL_STATUS"));

        mvc.perform(patch("/api/v1/trading/admin/symbols/999999/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"status\":\"HALTED\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("TRADING_SYMBOL_NOT_FOUND"));

        // Open a position before halt to ensure trader can still close it during halt
        OrderResponse existing = orderService.create(accountId, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, BigDecimal.ONE, 10, null));

        // Halt BTC via admin endpoint
        mvc.perform(patch("/api/v1/trading/admin/symbols/" + btc + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"status\":\"HALTED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(btc))
                .andExpect(jsonPath("$.symbol").value("BTC"))
                .andExpect(jsonPath("$.status").value("HALTED"));

        // Public /api/v1/symbols excludes HALTED BTC, while admin /api/v1/trading/admin/symbols includes HALTED BTC
        mvc.perform(get("/api/v1/symbols"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.symbol == 'BTC')]").isEmpty());

        mvc.perform(get("/api/v1/trading/admin/symbols").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(12))
                .andExpect(jsonPath("$[?(@.symbol == 'BTC')].status").value(org.hamcrest.Matchers.contains("HALTED")));

        // New OPEN on HALTED BTC is rejected with 409 SYMBOL_NOT_AVAILABLE
        mvc.perform(post("/api/v1/trading/account/orders")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":10}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SYMBOL_NOT_AVAILABLE"));

        // Closing existing position on HALTED BTC still works safely
        mvc.perform(post("/api/v1/trading/account/positions/" + existing.positionId() + "/close")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", key()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FILLED"));

        // Resume BTC back to ACTIVE
        mvc.perform(patch("/api/v1/trading/admin/symbols/" + btc + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        mvc.perform(get("/api/v1/symbols"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.symbol == 'BTC')]").isNotEmpty());

        assertThat(reconciler.reconcile(accountId).status()).isEqualTo("MATCHED");
    }

    @Test
    void t9_cancelAllAndCloseAllSupportOptionalIdempotencyKeyReplayInMockAndContest() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long memberId = MEMBERS.incrementAndGet();
        String adminBearer = "Bearer " + adminToken(adminId);
        String memberBearer = "Bearer " + memberToken(memberId);
        long accountId = memberAccounts.open(memberId).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc, accountId, btc);

        // Invalid Idempotency-Key format rejected with 400 INVALID_IDEMPOTENCY_KEY
        mvc.perform(post("/api/v1/trading/account/orders/cancel-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", "bad"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_IDEMPOTENCY_KEY"));

        mvc.perform(post("/api/v1/trading/account/positions/close-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", "bad key!"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_IDEMPOTENCY_KEY"));

        // Mock cancel-all with Idempotency-Key
        orderService.create(accountId, key(),
                new CreateOrderRequest(TradingOrder.Type.LIMIT, btc, Position.Side.LONG, new BigDecimal("0.5"), 10, new BigDecimal("900")));
        String cancelKey = key();
        String firstCancelBody = mvc.perform(post("/api/v1/trading/account/orders/cancel-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", cancelKey))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.canceledCount").value(1))
                .andReturn().getResponse().getContentAsString();

        // Place a brand-new pending order; replaying cancelKey MUST return original response and NOT cancel the new order!
        OrderResponse freshPending = orderService.create(accountId, key(),
                new CreateOrderRequest(TradingOrder.Type.LIMIT, btc, Position.Side.LONG, new BigDecimal("0.4"), 10, new BigDecimal("880")));

        String replayCancelBody = mvc.perform(post("/api/v1/trading/account/orders/cancel-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", cancelKey))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.canceledCount").value(1))
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(replayCancelBody)).isEqualTo(json.readTree(firstCancelBody));
        assertThat(orderService.pending(accountId)).extracting(OrderResponse::orderId).containsExactly(freshPending.orderId());

        // Reusing cancelKey on close-all -> 409 IDEMPOTENCY_CONFLICT
        mvc.perform(post("/api/v1/trading/account/positions/close-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", cancelKey))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

        // Mock close-all with Idempotency-Key
        orderService.create(accountId, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, BigDecimal.ONE, 10, null));
        String closeKey = key();
        String firstCloseBody = mvc.perform(post("/api/v1/trading/account/positions/close-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", closeKey))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.closedCount").value(1))
                .andReturn().getResponse().getContentAsString();

        // Open a fresh position; replaying closeKey MUST return original response and NOT close the fresh position!
        OrderResponse freshOpen = orderService.create(accountId, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, new BigDecimal("0.5"), 10, null));

        String replayCloseBody = mvc.perform(post("/api/v1/trading/account/positions/close-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", closeKey))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.closedCount").value(1))
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(replayCloseBody)).isEqualTo(json.readTree(firstCloseBody));
        assertThat(jdbc.queryForObject("select status from trading.position where id = ?", String.class, freshOpen.positionId()))
                .isEqualTo("OPEN");

        // Contest cancel-all and close-all with Idempotency-Key
        Instant now = Instant.now();
        long seasonId = createSeason(adminBearer, "멱등성 대회 시즌", "10000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));
        long appId = applyForSeason(memberBearer, seasonId, "멱등트레이더");
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + seasonId + "/applicants/" + appId + "/approve")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk());
        Long contestAccountId = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id = ? and member_id = ?",
                Long.class, seasonId, memberId);
        LegacyLeverageFixtures.bothDirections(jdbc, contestAccountId, btc);

        orderService.create(contestAccountId, key(),
                new CreateOrderRequest(TradingOrder.Type.LIMIT, btc, Position.Side.LONG, new BigDecimal("0.5"), 10, new BigDecimal("900")));
        orderService.create(contestAccountId, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, BigDecimal.ONE, 10, null));

        String contestCancelKey = key();
        String contestCancelFirst = mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/orders/cancel-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", contestCancelKey))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.canceledCount").value(1))
                .andReturn().getResponse().getContentAsString();
        orderService.create(contestAccountId, key(),
                new CreateOrderRequest(TradingOrder.Type.LIMIT, btc, Position.Side.LONG, new BigDecimal("0.3"), 10, new BigDecimal("850")));
        String contestCancelReplay = mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/orders/cancel-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", contestCancelKey))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(contestCancelReplay)).isEqualTo(json.readTree(contestCancelFirst));
        assertThat(orderService.pending(contestAccountId)).hasSize(1);

        String contestCloseKey = key();
        String contestCloseFirst = mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/positions/close-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", contestCloseKey))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.closedCount").value(1))
                .andReturn().getResponse().getContentAsString();
        OrderResponse contestFreshOpen = orderService.create(contestAccountId, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, new BigDecimal("0.2"), 10, null));
        String contestCloseReplay = mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/positions/close-all")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", contestCloseKey))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(contestCloseReplay)).isEqualTo(json.readTree(contestCloseFirst));
        assertThat(jdbc.queryForObject("select status from trading.position where id = ?", String.class, contestFreshOpen.positionId()))
                .isEqualTo("OPEN");

        assertThat(reconciler.reconcile(accountId).status()).isEqualTo("MATCHED");
        assertThat(reconciler.reconcile(contestAccountId).status()).isEqualTo("MATCHED");
    }

    @Test
    void t10_healthEndpointNeverExposesInternalComponentsDetails() throws Exception {
        mvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components").doesNotExist());
    }

    private long createSeason(String adminBearer, String title, String seed,
            Instant recStart, Instant recEnd, Instant start, Instant end) throws Exception {
        String body = json.writeValueAsString(Map.of(
                "title", title,
                "description", "test season",
                "seedMoney", seed,
                "recruitmentStartAt", recStart.toString(),
                "recruitmentEndAt", recEnd.toString(),
                "contestStartAt", start.toString(),
                "contestEndAt", end.toString(),
                "isPublic", true));
        String res = mvc.perform(post("/api/v1/trading/admin/contest/seasons")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode node = json.readTree(res);
        return node.path("id").asLong();
    }

    private long applyForSeason(String memberBearer, long seasonId, String nickname) throws Exception {
        String res = mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/applications")
                        .header("Authorization", memberBearer)
                        .contentType("application/json")
                        .content("{\"nickname\":\"" + nickname + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(res).path("applicationId").asLong();
    }

    private LatestMarkPrice mark(long symbolId, String price) {
        Instant now = Instant.now();
        Instant event = prices.find(symbolId).latestPrice().map(LatestMarkPrice::eventTime)
                .filter(p -> !p.isBefore(now)).map(p -> p.plusMillis(1)).orElse(now);
        LatestMarkPrice tick = new LatestMarkPrice(symbolId, new BigDecimal(price), event, now);
        assertThat(prices.update(tick)).isTrue();
        return tick;
    }

    private static String memberToken(long memberId) {
        return encodeToken(memberId, List.of("MEMBER"));
    }

    private static String adminToken(long memberId) {
        return encodeToken(memberId, List.of("MEMBER", "ADMIN"));
    }

    private static String encodeToken(long memberId, List<String> roles) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("https://content.test")
                .subject(Long.toString(memberId))
                .issuedAt(now.minusSeconds(2))
                .expiresAt(now.plusSeconds(600))
                .audience(List.of("trading"))
                .claim("token_use", "access")
                .claim("roles", roles)
                .build();
        return ENCODER.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(), claims))
                .getTokenValue();
    }

    private static RSAKey generateKey() {
        try {
            return new RSAKeyGenerator(2048).keyID("pass2-test-key").generate();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static Path writePublicKeyFile() {
        try {
            byte[] encoded = KEY.toRSAPublicKey().getEncoded();
            String pem = "-----BEGIN PUBLIC KEY-----\n"
                    + Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(encoded)
                    + "\n-----END PUBLIC KEY-----\n";
            Path file = Files.createTempFile("trading-pass2-test-pub-", ".pem");
            Files.writeString(file, pem);
            file.toFile().deleteOnExit();
            return file;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String key() {
        return UUID.randomUUID().toString();
    }
}
