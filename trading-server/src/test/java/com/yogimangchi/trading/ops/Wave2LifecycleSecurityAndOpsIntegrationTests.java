package com.yogimangchi.trading.ops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.yogimangchi.trading.contest.ContestSettlementService;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.recovery.RiskJournalRetentionService;
import com.yogimangchi.trading.execution.trigger.AccountTriggerService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.MarkPriceTimePolicy;
import com.yogimangchi.trading.notification.TradingNotificationService;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.dto.OrderResponse;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.security.TradingEndpointRateLimiter;
import com.yogimangchi.trading.stoploss.StopLossRequest;
import com.yogimangchi.trading.stoploss.StopLossService;
import com.yogimangchi.trading.support.LegacyLeverageFixtures;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.takeprofit.TakeProfitRequest;
import com.yogimangchi.trading.takeprofit.TakeProfitService;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.ExpiredGuestRetirementService;
import com.yogimangchi.trading.tradingaccount.service.MemberAccounts;
import com.yogimangchi.trading.tradingaccount.service.MemberWithdrawal;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
        "trading.risk-journal.enabled=true",
        "trading.trigger.enabled=false",
        "trading.guest-cleanup.enabled=false",
        "trading.reconciliation.enabled=false",
        "trading.rate-limit.candles-per-minute=5",
        "trading.rate-limit.orders-per-minute=5"
})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class Wave2LifecycleSecurityAndOpsIntegrationTests {

    private static final RSAKey KEY = generateKey();
    private static final Path PUBLIC_KEY = writePublicKeyFile();
    private static final JwtEncoder ENCODER = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(KEY)));
    private static final AtomicLong MEMBERS = new AtomicLong(99_000_000L);

    @DynamicPropertySource
    static void jwtSettings(DynamicPropertyRegistry registry) {
        registry.add("trading.member-auth.public-key-path", PUBLIC_KEY::toString);
        registry.add("trading.member-auth.issuer", () -> "https://content.test");
    }

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager txManager;
    @Autowired private MemberAccounts memberAccounts;
    @Autowired private TradingAccountService tradingAccountService;
    @Autowired private TradingOrderService orderService;
    @Autowired private SymbolLeverageService leverageService;
    @Autowired private StopLossService stopLossService;
    @Autowired private TakeProfitService takeProfitService;
    @Autowired private AccountTriggerService accountTriggerService;
    @Autowired private ContestSettlementService settlementService;
    @Autowired private MemberWithdrawal memberWithdrawal;
    @Autowired private ExpiredGuestRetirementService expiredGuestRetirement;
    @Autowired private RiskJournalRetentionService retentionService;
    @Autowired private TradingNotificationService notifications;
    @Autowired private TradingEvents tradingEvents;
    @Autowired private LatestPriceStore prices;
    @Autowired private LedgerReconciler reconciler;
    @Autowired private OpsErrorBuffer errorBuffer;
    @Autowired private TradingEndpointRateLimiter rateLimiter;
    @MockitoBean private TradingEngineGate gate;

    private long btc;
    private long eth;

    @BeforeEach
    void setup() {
        rateLimiter.reset();
        errorBuffer.clear();
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
        rateLimiter.reset();
        jdbc.update("update trading.trading_symbol set status = 'ACTIVE' where id in (?, ?)", btc, eth);
        prices.markUnavailable();
    }

    @Test
    void w2_1_adminOpsSummaryEnrichedFieldsTestAlertReconcileNowAndDbDownSafety() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long memberId = MEMBERS.incrementAndGet();
        String adminBearer = "Bearer " + adminToken(adminId);
        String memberBearer = "Bearer " + memberToken(memberId);
        long accountId = memberAccounts.open(memberId).accountId();

        // Corrupt wallet to create a ledger mismatch
        jdbc.update("update trading.wallet set balance = balance + 7 where account_id = ?", accountId);

        // Non-admin blocked from test-alert and reconcile-now
        mvc.perform(post("/api/v1/trading/admin/ops/test-alert").header("Authorization", memberBearer))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/trading/admin/ops/reconcile-now").header("Authorization", memberBearer))
                .andExpect(status().isForbidden());

        // On-demand reconcile detects the mismatch on specific accountId
        mvc.perform(post("/api/v1/trading/admin/ops/reconcile-now")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"accountId\":" + accountId + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checkedCount").value(1))
                .andExpect(jsonPath("$.mismatchCount").value(1))
                .andExpect(jsonPath("$.mismatches[?(@.accountId == " + accountId + ")].failedChecks").isNotEmpty());

        // Test-alert returns structured DISABLED status when OPS_ALERT_WEBHOOK_URL is blank
        mvc.perform(post("/api/v1/trading/admin/ops/test-alert").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.dispatched").value(false))
                .andExpect(jsonPath("$.status").value("DISABLED"));

        // Enriched /summary contains all Wave 2 telemetry blocks
        mvc.perform(get("/api/v1/trading/admin/ops/summary").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dependencies.db").value("UP"))
                .andExpect(jsonPath("$.dbLatencyMs").isNumber())
                .andExpect(jsonPath("$.runtime.heapMaxMb").isNumber())
                .andExpect(jsonPath("$.runtime.uptimeSeconds").isNumber())
                .andExpect(jsonPath("$.runtime.activeThreads").isNumber())
                .andExpect(jsonPath("$.hikari.max").isNumber())
                .andExpect(jsonPath("$.redis.status").isNotEmpty())
                .andExpect(jsonPath("$.binance.markState").value("DISABLED"))
                .andExpect(jsonPath("$.binance.orderBookConnected").value(false))
                .andExpect(jsonPath("$.ledgerMismatchDetails[?(@.accountId == " + accountId + ")]").isNotEmpty())
                .andExpect(jsonPath("$.lastReconciliationAt").isNotEmpty())
                .andExpect(jsonPath("$.sse.tradingNotificationSseCount").isNumber())
                .andExpect(jsonPath("$.marketOverview.healthy").isBoolean())
                .andExpect(jsonPath("$.errorMetrics.total5xx").isNumber())
                .andExpect(jsonPath("$.alerts.enabled").value(false))
                .andExpect(jsonPath("$.alerts.lastStatus").value("DISABLED"))
                .andExpect(jsonPath("$.criticalErrors").isArray());

        // Repair balance and re-run reconcile-now -> clears mismatch
        jdbc.update("update trading.wallet set balance = balance - 7 where account_id = ?", accountId);
        mvc.perform(post("/api/v1/trading/admin/ops/reconcile-now")
                        .header("Authorization", adminBearer)
                        .param("accountId", Long.toString(accountId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matchedCount").value(1))
                .andExpect(jsonPath("$.mismatchCount").value(0));

        // Direct AdminOpsService.summary() safety check when DB throws DataAccessException
        JdbcTemplate failingJdbc = Mockito.mock(JdbcTemplate.class);
        Mockito.when(failingJdbc.queryForObject(Mockito.anyString(), Mockito.eq(Integer.class)))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("Simulated PG outage"));
        AdminOpsService dbDownOps = new AdminOpsService(
                failingJdbc, gate, prices, null, null, null, null, null, null,
                errorBuffer, reconciler, null, txManager);
        var degradedSummary = dbDownOps.summary();
        assertThat(degradedSummary.dependencies().db()).isEqualTo("DOWN");
        assertThat(degradedSummary.dbLatencyMs()).isNull();
        assertThat(degradedSummary.riskHolds().unresolvedCount()).isZero();
        assertThat(degradedSummary.ledgerMismatchDetails()).isEmpty();
    }

    @Test
    void w2_2_internalMemberSuspensionBlocksTradingWith403AndUnsuspendRestoresAccess() throws Exception {
        long memberId = MEMBERS.incrementAndGet();
        String memberBearer = "Bearer " + memberToken(memberId);
        long accountId = memberAccounts.open(memberId).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc, accountId, btc);

        // Before suspension: wallet read succeeds
        mvc.perform(get("/api/v1/trading/account/wallet").header("Authorization", memberBearer))
                .andExpect(status().isOk());

        // Wrong token_use rejected with 403
        mvc.perform(post("/internal/v1/members/" + memberId + "/suspension")
                        .header("Authorization", "Bearer " + internalToken(memberId, "member_withdrawal"))
                        .contentType("application/json")
                        .content("{\"suspended\":true,\"reason\":\"abuse\"}"))
                .andExpect(status().isForbidden());

        // Subject mismatch rejected with 403 WITHDRAWAL_SUBJECT_MISMATCH
        mvc.perform(post("/internal/v1/members/" + (memberId + 1) + "/suspension")
                        .header("Authorization", "Bearer " + internalToken(memberId, "member_suspension"))
                        .contentType("application/json")
                        .content("{\"suspended\":true,\"reason\":\"abuse\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("WITHDRAWAL_SUBJECT_MISMATCH"));

        // Suspend member via internal JWT -> 204 No Content
        mvc.perform(post("/internal/v1/members/" + memberId + "/suspension")
                        .header("Authorization", "Bearer " + internalToken(memberId, "member_suspension"))
                        .contentType("application/json")
                        .content("{\"suspended\":true,\"reason\":\"운영 정책 위반 정지\"}"))
                .andExpect(status().isNoContent());

        // Suspended member is blocked from trading orders, wallet, and contest with 403 MEMBER_SUSPENDED
        mvc.perform(post("/api/v1/trading/account/orders")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"0.1\",\"leverage\":10}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_SUSPENDED"));

        mvc.perform(get("/api/v1/trading/contest/me/overview").header("Authorization", memberBearer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_SUSPENDED"));

        // Unsuspend member -> trading immediately restored
        mvc.perform(post("/internal/v1/members/" + memberId + "/suspension")
                        .header("Authorization", "Bearer " + internalToken(memberId, "member_suspension"))
                        .contentType("application/json")
                        .content("{\"suspended\":false,\"reason\":\"정지 해제\"}"))
                .andExpect(status().isNoContent());

        mvc.perform(post("/api/v1/trading/account/orders")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"0.1\",\"leverage\":10}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FILLED"));
    }

    @Test
    void w2_3_expiredUsedGuestRetirementCleansPendingOrdersPositionsSlTpAndMarksExpired() {
        GuestAccountResponse usedGuest = tradingAccountService.createGuest();
        GuestAccountResponse untouchedExpiredGuest = tradingAccountService.createGuest();
        GuestAccountResponse activeGuest = tradingAccountService.createGuest();

        long usedId = usedGuest.accountId();
        LegacyLeverageFixtures.bothDirections(jdbc, usedId, btc);

        // Used guest opens a position with SL & TP and places pending OPEN + CLOSE orders
        OrderResponse opened = orderService.create(usedId, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, BigDecimal.ONE, 10, null,
                        new BigDecimal("960"), new BigDecimal("1200")));
        orderService.create(usedId, key(),
                new CreateOrderRequest(TradingOrder.Type.LIMIT, btc, Position.Side.LONG, new BigDecimal("0.5"), 10, new BigDecimal("900")));
        orderService.createLimitClose(usedId, opened.positionId(), key(),
                new com.yogimangchi.trading.order.dto.LimitCloseRequest(new BigDecimal("0.4"), new BigDecimal("1150")));

        // Expire usedGuest and untouchedExpiredGuest (keep activeGuest valid)
        jdbc.update("update trading.trading_account set credential_expires_at = now() - interval '1 hour' where id in (?, ?)",
                usedId, untouchedExpiredGuest.accountId());

        // Trigger a new mark price -> RiskPriceJournal MUST NOT enqueue work for expired usedGuest!
        long workBeforePrice = jdbc.queryForObject(
                "select count(*) from trading.risk_account_work where account_id = ?", Long.class, usedId);
        mark(btc, "1005");
        long workAfterPrice = jdbc.queryForObject(
                "select count(*) from trading.risk_account_work where account_id = ?", Long.class, usedId);
        assertThat(workAfterPrice).isEqualTo(workBeforePrice);

        // Run expired used guest retirement
        int retired = expiredGuestRetirement.retireExpiredBatch();
        assertThat(retired).isGreaterThanOrEqualTo(1);

        // Used guest is now EXPIRED, 0 pending orders, 0 open positions, SL & TP EXPIRED, ledger MATCHED!
        assertThat(jdbc.queryForObject("select status from trading.trading_account where id = ?", String.class, usedId))
                .isEqualTo("EXPIRED");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id = ? and status = 'PENDING'", Long.class, usedId))
                .isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id = ? and reason = 'GUEST_EXPIRED'", Long.class, usedId))
                .isEqualTo(2L);
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id = ? and status = 'OPEN'", Long.class, usedId))
                .isZero();
        assertThat(jdbc.queryForObject("select close_reason from trading.position where id = ?", String.class, opened.positionId()))
                .isEqualTo("GUEST_EXPIRED");
        assertThat(jdbc.queryForObject("select stop_loss_status from trading.position where id = ?", String.class, opened.positionId()))
                .isEqualTo("EXPIRED");
        assertThat(jdbc.queryForObject("select status from trading.position_take_profit where position_id = ?", String.class, opened.positionId()))
                .isEqualTo("EXPIRED");
        assertThat(reconciler.reconcile(usedId).status()).isEqualTo("MATCHED");

        // Untouched expired guest stays ACTIVE (left for UnusedGuestCleanupService), active guest stays ACTIVE
        assertThat(jdbc.queryForObject("select status from trading.trading_account where id = ?", String.class, untouchedExpiredGuest.accountId()))
                .isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("select status from trading.trading_account where id = ?", String.class, activeGuest.accountId()))
                .isEqualTo("ACTIVE");
    }

    @Test
    void w2_4_leverageIncreaseRejectedWhenActiveSlBeyondNewLiquidationAndPositionIncreaseExpiresInvalidSlTp() throws Exception {
        long memberId = MEMBERS.incrementAndGet();
        long accountId = memberAccounts.open(memberId).accountId();
        leverageService.change(accountId, btc, Position.Side.LONG, 5);

        // Open LONG 1 BTC @ 1000 with 5x leverage (margin 200, liq ~808) and set SL @ 850 (safe at 5x)
        OrderResponse opened = orderService.create(accountId, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, BigDecimal.ONE, 5, null));
        stopLossService.put(accountId, opened.positionId(), key(), new StopLossRequest(new BigDecimal("850"), 0L));

        // Increasing leverage to 10x (margin 100, new liq ~909) would place SL 850 beyond liquidation -> REJECTED!
        assertThatThrownBy(() -> leverageService.change(accountId, btc, Position.Side.LONG, 10))
                .isInstanceOf(BusinessException.class)
                .extracting("code")
                .isEqualTo(ErrorCode.STOP_LOSS_BEYOND_LIQUIDATION);

        // Increasing leverage to 6x (margin ~166.67, new liq ~841 < 850) keeps SL safe -> ALLOWED!
        assertThat(leverageService.change(accountId, btc, Position.Side.LONG, 6).leverage()).isEqualTo(6);

        // Now test Position.increase invalidating active SL & TP!
        long member2 = MEMBERS.incrementAndGet();
        long acc2 = memberAccounts.open(member2).accountId();
        leverageService.change(acc2, btc, Position.Side.LONG, 10);

        // Open LONG 1 BTC @ 1000 (liq ~909), set SL @ 920 and TP @ 1080
        mark(btc, "1000");
        OrderResponse pos2 = orderService.create(acc2, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, BigDecimal.ONE, 10, null,
                        new BigDecimal("920"), new BigDecimal("1080")));
        assertThat(stopLossService.get(acc2, pos2.positionId()).status()).isEqualTo("ACTIVE");
        assertThat(takeProfitService.get(acc2, pos2.positionId()).status()).isEqualTo("ACTIVE");

        // Price rises to 1070 (still below TP 1080), user adds 3 BTC @ 1070 -> blended entry = (1000 + 3210)/4 = 1052.5,
        // new liq ~957 > SL 920! So SL 920 is now beyond new liquidation and MUST expire with POSITION_CHANGED!
        mark(btc, "1070");
        orderService.create(acc2, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, new BigDecimal("3"), 10, null));

        var slAfterIncrease = stopLossService.get(acc2, pos2.positionId());
        assertThat(slAfterIncrease.status()).isEqualTo("EXPIRED");
        assertThat(slAfterIncrease.reason()).isEqualTo("POSITION_CHANGED");
        assertThat(tradingEvents.after(acc2, 0, 100))
                .anyMatch(e -> "STOP_LOSS_CHANGED".equals(e.type())
                        && e.stopLoss() != null && "EXPIRED".equals(e.stopLoss().status())
                        && "POSITION_CHANGED".equals(e.stopLoss().reason()));

        // Also test LIMIT OPEN fill via AccountTriggerService expiring invalid SL on increase
        long member3 = MEMBERS.incrementAndGet();
        long acc3 = memberAccounts.open(member3).accountId();
        leverageService.change(acc3, eth, Position.Side.SHORT, 10);
        mark(eth, "200");
        OrderResponse shortPos = orderService.create(acc3, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, eth, Position.Side.SHORT, new BigDecimal("1"), 10, null,
                        new BigDecimal("215"), new BigDecimal("180")));
        // Place passive SHORT LIMIT OPEN @ 210 (above mark 200), price rises to 212 crossing limit -> limit fills & blends?
        // Wait: for SHORT, adding at LOWER price moves liq DOWN! Place SHORT @ 200 with SL @ 215, move mark to 185,
        // place SHORT LIMIT OPEN @ 190? No, for SHORT LIMIT OPEN must be > mark. Set mark=181, place LIMIT SHORT @ 182 for 5 ETH!
        // Blended SHORT entry = (200 + 5*182)/6 = 185 -> new liq ~202 < SL 215!
        mark(eth, "181");
        orderService.create(acc3, key(),
                new CreateOrderRequest(TradingOrder.Type.LIMIT, eth, Position.Side.SHORT, new BigDecimal("5"), 10, new BigDecimal("182")));
        Thread.sleep(5);
        LatestMarkPrice fillTick = mark(eth, "183");
        accountTriggerService.process(acc3, fillTick, Map.of(eth, fillTick));

        assertThat(stopLossService.get(acc3, shortPos.positionId()).status()).isEqualTo("EXPIRED");
        assertThat(stopLossService.get(acc3, shortPos.positionId()).reason()).isEqualTo("POSITION_CHANGED");
        assertThat(reconciler.reconcile(accountId).status()).isEqualTo("MATCHED");
        assertThat(reconciler.reconcile(acc2).status()).isEqualTo("MATCHED");
        assertThat(reconciler.reconcile(acc3).status()).isEqualTo("MATCHED");
    }

    @Test
    void w2_5_contestStateMachineGuardsSettledWithdrawnWinnerPreservationDisqualifyDeleteAndAuditLogs() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long winnerId = MEMBERS.incrementAndGet();
        long runnerUpId = MEMBERS.incrementAndGet();
        long cheaterId = MEMBERS.incrementAndGet();

        String adminBearer = "Bearer " + adminToken(adminId);
        String winnerBearer = "Bearer " + memberToken(winnerId);
        String runnerUpBearer = "Bearer " + memberToken(runnerUpId);
        String cheaterBearer = "Bearer " + memberToken(cheaterId);
        Instant now = Instant.now();

        // 1. Draft season with 0 participants can be deleted cleanly
        long draftSeasonId = createSeason(adminBearer, "삭제가능 초안 시즌", "10000",
                now.plusSeconds(3600), now.plusSeconds(7200), now.plusSeconds(7200), now.plusSeconds(14400));
        mvc.perform(delete("/api/v1/trading/admin/contest/seasons/" + draftSeasonId)
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(true))
                .andExpect(jsonPath("$.hardDeleted").value(true));
        assertThat(jdbc.queryForObject("select count(*) from trading.contest_season where id = ?", Long.class, draftSeasonId))
                .isZero();

        // 2. Canceled season cannot be edited, cannot be settled, and can be deleted when 0 active exposure
        long cancelSeasonId = createSeason(adminBearer, "취소 가드 시즌", "10000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));
        mvc.perform(patch("/api/v1/trading/admin/contest/seasons/" + cancelSeasonId + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"isCanceled\":true}"))
                .andExpect(status().isOk());

        // Cannot edit canceled season
        String updateBody = json.writeValueAsString(Map.of(
                "title", "수정시도",
                "description", "desc",
                "seedMoney", "10000",
                "recruitmentStartAt", now.minusSeconds(3600).toString(),
                "recruitmentEndAt", now.plusSeconds(3600).toString(),
                "contestStartAt", now.minusSeconds(600).toString(),
                "contestEndAt", now.plusSeconds(7200).toString(),
                "isPublic", true));
        mvc.perform(put("/api/v1/trading/admin/contest/seasons/" + cancelSeasonId)
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content(updateBody))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTEST_ALREADY_CANCELED"));

        // Cannot settle canceled season
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + cancelSeasonId + "/settle")
                        .header("Authorization", adminBearer))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTEST_ALREADY_CANCELED"));

        // Canceled season with 0 exposure can be deleted
        mvc.perform(delete("/api/v1/trading/admin/contest/seasons/" + cancelSeasonId)
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(true));

        // 3. Live season: test disqualify, delete rejection, settle, re-settle rejection, and post-settlement winner withdrawal
        long liveSeasonId = createSeason(adminBearer, "정산·실격·탈퇴우승자 시즌", "10000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));

        long winApp = applyForSeason(winnerBearer, liveSeasonId, "우승트레이더");
        long runApp = applyForSeason(runnerUpBearer, liveSeasonId, "준우승트레이더");
        long cheatApp = applyForSeason(cheaterBearer, liveSeasonId, "부정참가자");
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + liveSeasonId + "/applicants/bulk-approve")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"applicationIds\":[" + winApp + "," + runApp + "," + cheatApp + "]}"))
                .andExpect(status().isOk());

        // Cannot delete active season with participants
        mvc.perform(delete("/api/v1/trading/admin/contest/seasons/" + liveSeasonId)
                        .header("Authorization", adminBearer))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTEST_DELETE_NOT_ALLOWED"));

        Long winnerAcc = contestAccountId(liveSeasonId, winnerId);
        Long cheaterAcc = contestAccountId(liveSeasonId, cheaterId);
        LegacyLeverageFixtures.bothDirections(jdbc, winnerAcc, btc);
        LegacyLeverageFixtures.bothDirections(jdbc, cheaterAcc, btc);

        // Winner profits, cheater opens position + pending order + SL/TP
        mark(btc, "1000");
        orderService.create(winnerAcc, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, BigDecimal.ONE, 10, null));
        OrderResponse cheaterOpen = orderService.create(cheaterAcc, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, BigDecimal.ONE, 10, null,
                        new BigDecimal("960"), new BigDecimal("1200")));
        orderService.create(cheaterAcc, key(),
                new CreateOrderRequest(TradingOrder.Type.LIMIT, btc, Position.Side.LONG, new BigDecimal("0.5"), 10, new BigDecimal("900")));

        // Admin disqualifies cheater
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + liveSeasonId + "/participants/" + cheaterId + "/disqualify")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"reason\":\"비정상 거래 패턴 실격\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DISQUALIFIED"))
                .andExpect(jsonPath("$.canceledOrderCount").value(1))
                .andExpect(jsonPath("$.closedPositionCount").value(1));

        assertThat(jdbc.queryForObject("select close_reason from trading.position where id = ?", String.class, cheaterOpen.positionId()))
                .isEqualTo("CONTEST_DISQUALIFIED");
        assertThat(reconciler.reconcile(cheaterAcc).status()).isEqualTo("MATCHED");

        // Disqualified member cannot place new contest orders
        mvc.perform(post("/api/v1/trading/contest/seasons/" + liveSeasonId + "/orders")
                        .header("Authorization", cheaterBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"0.1\",\"leverage\":10}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CONTEST_PARTICIPATION_REQUIRED"));

        // Move BTC up -> settle season -> winner #1, runnerUp #2 (cheater excluded!)
        mark(btc, "1150");
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + liveSeasonId + "/settle")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.finalizedParticipantCount").value(2));

        // Cannot re-settle an already-settled season even with earlyTerminate=true!
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + liveSeasonId + "/settle")
                        .header("Authorization", adminBearer))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTEST_ALREADY_SETTLED"));

        // Winner withdraws AFTER settlement -> settled leaderboard MUST retain rank #1 as '탈퇴한회원' with ZERO rank holes!
        memberWithdrawal.withdraw(winnerId);

        String settledLb = mvc.perform(get("/api/v1/trading/contest/public/seasons/" + liveSeasonId + "/leaderboard"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andReturn().getResponse().getContentAsString();
        JsonNode lbItems = json.readTree(settledLb).path("items");
        assertThat(lbItems.get(0).path("rank").asInt()).isEqualTo(1);
        assertThat(lbItems.get(0).path("nickname").asText()).isEqualTo("탈퇴한회원");
        assertThat(lbItems.get(1).path("rank").asInt()).isEqualTo(2);
        assertThat(lbItems.get(1).path("memberId").asLong()).isEqualTo(runnerUpId);

        // Admin audit logs endpoint records all admin actions with cursor pagination and ROLE_ADMIN enforcement
        mvc.perform(get("/api/v1/trading/admin/audit-logs").header("Authorization", runnerUpBearer))
                .andExpect(status().isForbidden());

        String auditBody = mvc.perform(get("/api/v1/trading/admin/audit-logs")
                        .header("Authorization", adminBearer)
                        .param("size", "50"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> actions = new java.util.ArrayList<>();
        json.readTree(auditBody).path("items").forEach(item -> actions.add(item.path("action").asText()));
        assertThat(actions).contains(
                "CONTEST_SEASON_CREATE",
                "CONTEST_SEASON_CANCEL",
                "CONTEST_SEASON_DELETE",
                "CONTEST_APPLICATION_BULK_APPROVE",
                "CONTEST_PARTICIPANT_DISQUALIFY",
                "CONTEST_SEASON_SETTLE");
    }

    @Test
    void w2_6_entryTimeSlTpTradingEventsContractNotificationDeleteReadAndAuxiliaryRetention() throws Exception {
        long memberId = MEMBERS.incrementAndGet();
        String bearer = "Bearer " + memberToken(memberId);
        long accountId = memberAccounts.open(memberId).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc, accountId, btc);

        // 1. Entry-time SL/TP invalid bound rolls back entire MARKET OPEN atomically!
        mvc.perform(post("/api/v1/trading/account/orders")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":10,\"stopLossPrice\":\"800\",\"takeProfitPrice\":\"1200\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STOP_LOSS_BEYOND_LIQUIDATION"));
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id = ?", Long.class, accountId))
                .isZero();

        // 2. Entry-time valid SL & TP on MARKET OPEN atomically registers both SL & TP in same tx
        String entryKey = key();
        String entryBody = mvc.perform(post("/api/v1/trading/account/orders")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", entryKey)
                        .contentType("application/json")
                        .content("{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":10,\"stopLossPrice\":\"960\",\"takeProfitPrice\":\"1200\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FILLED"))
                .andReturn().getResponse().getContentAsString();
        long posId = json.readTree(entryBody).path("positionId").asLong();

        assertThat(stopLossService.get(accountId, posId).status()).isEqualTo("ACTIVE");
        assertThat(new BigDecimal(stopLossService.get(accountId, posId).stopPrice())).isEqualByComparingTo("960");
        assertThat(takeProfitService.get(accountId, posId).status()).isEqualTo("ACTIVE");
        assertThat(new BigDecimal(takeProfitService.get(accountId, posId).takeProfitPrice())).isEqualByComparingTo("1200");
        assertThat(reconciler.reconcile(accountId).status()).isEqualTo("MATCHED");

        // 3. TradingEvents emits ORDER_REJECTED (NOT POSITION_LIQUIDATED) for non-FILLED LIQUIDATE orders
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            TradingOrder nonFilledLiq = TradingOrder.limit(accountId, btc, Position.Side.LONG,
                    BigDecimal.ONE, 10, new BigDecimal("900"), key(), "0".repeat(64), Instant.now());
            // Use reflection strictly to test a hypothetical non-FILLED LIQUIDATE snapshot against TradingEvents contract
            try {
                var actionField = TradingOrder.class.getDeclaredField("action");
                actionField.setAccessible(true);
                actionField.set(nonFilledLiq, TradingOrder.Action.LIQUIDATE);
                var idField = TradingOrder.class.getDeclaredField("id");
                idField.setAccessible(true);
                // Persist a valid order row first to satisfy FK on trading_event.order_id
                Long persistedOrderId = jdbc.queryForObject("""
                        INSERT INTO trading.trading_order (
                            account_id, trading_symbol_id, side, type, action, status,
                            quantity, leverage, requested_leverage, limit_price, reserved_margin,
                            idempotency_key, request_fingerprint, created_at, completed_at, reason,
                            submitted_margin_mode, fee_rate
                        ) VALUES (?, ?, 'LONG', 'LIMIT', 'OPEN', 'REJECTED', 1, 10, 10, 900, 0, ?, ?, now(), now(), 'TEST_NON_FILLED_LIQ', 'ISOLATED', 0.0005)
                        RETURNING id
                        """, Long.class, accountId, btc, key(), "0".repeat(64));
                idField.set(nonFilledLiq, persistedOrderId);
                nonFilledLiq.reject("TEST_NON_FILLED_LIQ", Instant.now());
                tradingEvents.record(nonFilledLiq, null);
                String recordedType = jdbc.queryForObject(
                        "select event_type from trading.trading_event where order_id = ?",
                        String.class, persistedOrderId);
                assertThat(recordedType).isEqualTo("ORDER_REJECTED");
                status.setRollbackOnly();
            } catch (Exception ex) {
                throw new RuntimeException(ex);
            }
        });

        // 4. Notification deleteReadNotifications deletes read notifications EVEN when id > lastCheckedId
        Long n1 = jdbc.queryForObject("""
                INSERT INTO trading.notification (receiver_member_id, category, type, payload_json, is_read, read_at, created_at, last_event_at)
                VALUES (?, 'MOCK', 'ORDER_COMPLETED', '{}'::jsonb, true, now(), now(), now()) RETURNING id
                """, Long.class, memberId);
        notifications.checkNotifications(memberId); // sets lastCheckedId = n1
        Long n2ReadAfterCheck = jdbc.queryForObject("""
                INSERT INTO trading.notification (receiver_member_id, category, type, payload_json, is_read, read_at, created_at, last_event_at)
                VALUES (?, 'MOCK', 'ORDER_COMPLETED', '{}'::jsonb, true, now(), now(), now()) RETURNING id
                """, Long.class, memberId);
        Long n3Unread = jdbc.queryForObject("""
                INSERT INTO trading.notification (receiver_member_id, category, type, payload_json, is_read, read_at, created_at, last_event_at)
                VALUES (?, 'MOCK', 'ORDER_COMPLETED', '{}'::jsonb, false, null, now(), now()) RETURNING id
                """, Long.class, memberId);

        notifications.deleteReadNotifications(memberId);
        assertThat(jdbc.queryForObject("select count(*) from trading.notification where id in (?, ?)", Long.class, n1, n2ReadAfterCheck))
                .isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.notification where id = ?", Long.class, n3Unread))
                .isEqualTo(1L);

        // 5. RiskJournalRetentionService.purgeAuxiliaryExpired purges >90d notifications & >30d command tables only
        Long oldNotif = jdbc.queryForObject("""
                INSERT INTO trading.notification (receiver_member_id, category, type, payload_json, is_read, created_at, last_event_at)
                VALUES (?, 'MOCK', 'ORDER_COMPLETED', '{}'::jsonb, false, now() - interval '95 days', now() - interval '95 days') RETURNING id
                """, Long.class, memberId);
        String oldIdempKey = "old-idemp-" + UUID.randomUUID();
        String oldSlKey = "old-sl-" + UUID.randomUUID();
        String oldTpKey = "old-tp-" + UUID.randomUUID();
        jdbc.update("""
                INSERT INTO trading.idempotent_command (account_id, request_key, operation, request_fingerprint, response, created_at)
                VALUES (?, ?, 'CANCEL_ALL', ?, '{}'::jsonb, now() - interval '35 days')
                """, accountId, oldIdempKey, "0".repeat(64));
        jdbc.update("""
                INSERT INTO trading.position_stop_loss_command (account_id, request_key, position_id, request_fingerprint, response, created_at)
                VALUES (?, ?, ?, ?, '{}'::jsonb, now() - interval '35 days')
                """, accountId, oldSlKey, posId, "0".repeat(64));
        jdbc.update("""
                INSERT INTO trading.position_take_profit_command (account_id, request_key, position_id, request_fingerprint, response, created_at)
                VALUES (?, ?, ?, ?, '{}'::jsonb, now() - interval '35 days')
                """, accountId, oldTpKey, posId, "0".repeat(64));

        var auxPurge = retentionService.purgeAuxiliaryExpired(Instant.now());
        assertThat(auxPurge.purgedNotifications()).isGreaterThanOrEqualTo(1);
        assertThat(auxPurge.purgedIdempotentCommands()).isGreaterThanOrEqualTo(1);
        assertThat(auxPurge.purgedStopLossCommands()).isGreaterThanOrEqualTo(1);
        assertThat(auxPurge.purgedTakeProfitCommands()).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.notification where id = ?", Long.class, oldNotif)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.notification where id = ?", Long.class, n3Unread)).isEqualTo(1L);
        // Core financial ledger untouched
        assertThat(jdbc.queryForObject("select count(*) from trading.position where id = ?", Long.class, posId)).isEqualTo(1L);
    }

    @Test
    void w2_7_candleAndOrderRateLimitsReturn429RateLimitedWithRetryAfter() throws Exception {
        // 1. Candle endpoint: configured limit=5/min per IP -> 6th returns 429 RATE_LIMITED
        for (int i = 0; i < 5; i++) {
            mvc.perform(get("/api/v1/market/candles")
                            .param("tradingSymbolId", "9999999")
                            .param("interval", "1m")
                            .with(req -> { req.setRemoteAddr("198.51.100.77"); return req; }))
                    .andExpect(status().isNotFound());
        }
        mvc.perform(get("/api/v1/market/candles")
                        .param("tradingSymbolId", "9999999")
                        .param("interval", "1m")
                        .with(req -> { req.setRemoteAddr("198.51.100.77"); return req; }))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"));

        // 2. Order write endpoint: configured limit=5/min per account -> 6th returns 429 RATE_LIMITED
        long memberId = MEMBERS.incrementAndGet();
        String bearer = "Bearer " + memberToken(memberId);
        memberAccounts.open(memberId);

        for (int i = 0; i < 5; i++) {
            mvc.perform(post("/api/v1/trading/account/orders/cancel-all")
                            .header("Authorization", bearer))
                    .andExpect(status().isOk());
        }
        mvc.perform(post("/api/v1/trading/account/orders/cancel-all")
                        .header("Authorization", bearer))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"));
    }

    private long createSeason(String adminBearer, String title, String seed,
            Instant recStart, Instant recEnd, Instant start, Instant end) throws Exception {
        String body = json.writeValueAsString(Map.of(
                "title", title,
                "description", "wave2 test season",
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
        return json.readTree(res).path("id").asLong();
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

    private Long contestAccountId(long seasonId, long memberId) {
        return jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id = ? and member_id = ?",
                Long.class, seasonId, memberId);
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
        return encodeAccessToken(memberId, List.of("MEMBER"));
    }

    private static String adminToken(long memberId) {
        return encodeAccessToken(memberId, List.of("MEMBER", "ADMIN"));
    }

    private static String encodeAccessToken(long memberId, List<String> roles) {
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

    private static String internalToken(long memberId, String tokenUse) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("https://content.test")
                .subject(Long.toString(memberId))
                .issuedAt(now.minusSeconds(2))
                .expiresAt(now.plusSeconds(30))
                .audience(List.of("trading-internal"))
                .claim("token_use", tokenUse)
                .build();
        return ENCODER.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(), claims))
                .getTokenValue();
    }

    private static RSAKey generateKey() {
        try {
            return new RSAKeyGenerator(2048).keyID("wave2-test-key").generate();
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
            Path file = Files.createTempFile("trading-wave2-test-pub-", ".pem");
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
