package com.yogimangchi.trading.ops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.notification.TradingNotificationService;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.support.LegacyLeverageFixtures;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.MemberAccounts;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
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

import static org.assertj.core.api.Assertions.assertThat;
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
        "trading.risk-journal.enabled=true"
})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class LifecycleContestPrivacyAndOpsIntegrationTests {

    private static final RSAKey KEY = generateKey();
    private static final Path PUBLIC_KEY = writePublicKeyFile();
    private static final JwtEncoder ENCODER = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(KEY)));
    private static final AtomicLong MEMBERS = new AtomicLong(97_000_000);

    @DynamicPropertySource
    static void jwtSettings(DynamicPropertyRegistry registry) {
        registry.add("trading.member-auth.public-key-path", PUBLIC_KEY::toString);
        registry.add("trading.member-auth.issuer", () -> "https://content.test");
    }

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private MemberAccounts memberAccounts;
    @Autowired private TradingAccountService tradingAccountService;
    @Autowired private TradingOrderService orderService;
    @Autowired private LatestPriceStore prices;
    @Autowired private LedgerReconciler reconciler;
    @Autowired private TradingNotificationService notifications;
    @Autowired private OpsErrorBuffer errorBuffer;
    @MockitoBean private TradingEngineGate gate;

    private long btc;
    private long eth;

    @BeforeEach
    void setup() {
        btc = jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'", Long.class);
        eth = jdbc.queryForObject("select id from trading.trading_symbol where symbol='ETH'", Long.class);
        prices.beginSubscription(Set.of(btc, eth));
        mark(btc, "1000");
        mark(eth, "200");
        org.mockito.Mockito.when(gate.status()).thenReturn("READY");
    }

    @AfterEach
    void cleanup() {
        prices.markUnavailable();
    }

    @Test
    void contestSeasonCancellationAtomicallyCleansApplicationsOrdersPositionsAndNotifiesAffectedMembers() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long participantId = MEMBERS.incrementAndGet();
        long pendingApplicantId = MEMBERS.incrementAndGet();

        String adminBearer = "Bearer " + adminToken(adminId);
        String participantBearer = "Bearer " + memberToken(participantId);
        String applicantBearer = "Bearer " + memberToken(pendingApplicantId);

        Instant now = Instant.now();
        long seasonId = createSeason(adminBearer, "취소 테스트 시즌", "15000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));

        long participantAppId = applyForSeason(participantBearer, seasonId, "참가자1");
        long pendingAppId = applyForSeason(applicantBearer, seasonId, "대기자1");

        // Approve only participantId; leave pendingApplicantId as PENDING
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + seasonId + "/applicants/" + participantAppId + "/approve")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk());

        Long contestAccountId = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                Long.class, seasonId, participantId);
        LegacyLeverageFixtures.bothDirections(jdbc, contestAccountId, btc);

        // Participant opens a position, sets SL & TP, and places pending OPEN + CLOSE orders
        String openBody = mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/orders")
                        .header("Authorization", participantBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":10}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long positionId = json.readTree(openBody).path("positionId").asLong();

        mvc.perform(put("/api/v1/trading/contest/seasons/" + seasonId + "/positions/" + positionId + "/take-profit")
                        .header("Authorization", participantBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"takeProfitPrice\":\"1200\",\"expectedVersion\":0}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/orders")
                        .header("Authorization", participantBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"type\":\"LIMIT\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"0.5\",\"leverage\":10,\"limitPrice\":\"900\"}"))
                .andExpect(status().isOk());

        mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/positions/" + positionId + "/close-orders")
                        .header("Authorization", participantBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"quantity\":\"0.5\",\"limitPrice\":\"1150\"}"))
                .andExpect(status().isOk());

        // Contest events ?latest=true returns newest event first
        String latestEventsBody = mvc.perform(get("/api/v1/trading/contest/seasons/" + seasonId + "/events")
                        .header("Authorization", participantBearer)
                        .param("afterId", "0")
                        .param("limit", "2")
                        .param("latest", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andReturn().getResponse().getContentAsString();
        JsonNode latestEvents = json.readTree(latestEventsBody);
        assertThat(Long.parseLong(latestEvents.get(0).path("eventId").asText()))
                .isGreaterThan(Long.parseLong(latestEvents.get(1).path("eventId").asText()));

        // Admin cancels the season!
        mvc.perform(patch("/api/v1/trading/admin/contest/seasons/" + seasonId + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"isCanceled\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isCanceled").value(true))
                .andExpect(jsonPath("$.pendingOrderCount").value(0))
                .andExpect(jsonPath("$.openPositionCount").value(0));

        // Pending application is now CANCELED
        assertThat(jdbc.queryForObject(
                "select status from trading.contest_application where id=?", String.class, pendingAppId))
                .isEqualTo("CANCELED");

        // Zero phantom open positions or pending orders remain
        assertThat(jdbc.queryForObject(
                "select count(*) from trading.position where account_id=? and status='OPEN'", Long.class, contestAccountId))
                .isZero();
        assertThat(jdbc.queryForObject(
                "select count(*) from trading.trading_order where account_id=? and status='PENDING'", Long.class, contestAccountId))
                .isZero();
        assertThat(jdbc.queryForObject(
                "select close_reason from trading.position where id=?", String.class, positionId))
                .isEqualTo("CONTEST_CANCELED");
        assertThat(jdbc.queryForObject(
                "select status from trading.position_take_profit where position_id=?", String.class, positionId))
                .isEqualTo("EXPIRED");

        // Ledger reconciler stays 100% MATCHED!
        assertThat(reconciler.reconcile(contestAccountId).status()).isEqualTo("MATCHED");

        // Both participant and canceled pending applicant received CONTEST_SEASON_CANCELED notifications
        assertThat(notifications.listNotifications(participantId, null, 20, "CONTEST", null).content())
                .anyMatch(n -> TradingNotificationService.TYPE_CONTEST_SEASON_CANCELED.equals(n.type()));
        assertThat(notifications.listNotifications(pendingApplicantId, null, 20, "CONTEST", null).content())
                .anyMatch(n -> TradingNotificationService.TYPE_CONTEST_SEASON_CANCELED.equals(n.type()));
    }

    @Test
    void contestCancelAllAndCloseAllWorkAtomicallyForActiveContestAccount() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long memberId = MEMBERS.incrementAndGet();
        String adminBearer = "Bearer " + adminToken(adminId);
        String memberBearer = "Bearer " + memberToken(memberId);

        Instant now = Instant.now();
        long seasonId = createSeason(adminBearer, "일괄정리 대회", "10000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));
        long appId = applyForSeason(memberBearer, seasonId, "일괄트레이더");
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + seasonId + "/applicants/" + appId + "/approve")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk());

        Long contestAccountId = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                Long.class, seasonId, memberId);
        LegacyLeverageFixtures.bothDirections(jdbc, contestAccountId, btc);

        mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/orders")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":10}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/orders")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"type\":\"LIMIT\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"0.5\",\"leverage\":10,\"limitPrice\":\"900\"}"))
                .andExpect(status().isOk());

        mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/orders/cancel-all")
                        .header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.canceledCount").value(1));

        mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/positions/close-all")
                        .header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.closedCount").value(1));

        assertThat(reconciler.reconcile(contestAccountId).status()).isEqualTo("MATCHED");
    }

    @Test
    void portfolioVisibilityToggleHidesBalancesAndPositionsFromVisitorsWhileOwnerAndAdminRetainAccess() throws Exception {
        long ownerId = MEMBERS.incrementAndGet();
        long otherMemberId = MEMBERS.incrementAndGet();
        long adminId = MEMBERS.incrementAndGet();

        String ownerBearer = "Bearer " + memberToken(ownerId);
        String otherBearer = "Bearer " + memberToken(otherMemberId);
        String adminBearer = "Bearer " + adminToken(adminId);

        long ownerAccountId = memberAccounts.open(ownerId).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc, ownerAccountId, btc);
        orderService.create(ownerAccountId, key(),
                new CreateOrderRequest(TradingOrder.Type.MARKET, btc, Position.Side.LONG, new BigDecimal("1"), 10, null));

        // Guest cannot access portfolio-visibility (ROLE_MEMBER required)
        GuestAccountResponse guest = tradingAccountService.createGuest();
        mvc.perform(get("/api/v1/trading/account/portfolio-visibility")
                        .header("Authorization", "Bearer " + guest.accessToken()))
                .andExpect(status().isForbidden());

        // Default visibility is true
        mvc.perform(get("/api/v1/trading/account/portfolio-visibility")
                        .header("Authorization", ownerBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.portfolioPublic").value(true));

        // Public visitor sees full positions and portfolioPublic=true
        mvc.perform(get("/api/v1/trading/portfolios/members/" + ownerId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.portfolioPublic").value(true))
                .andExpect(jsonPath("$.positions.length()").value(1))
                .andExpect(jsonPath("$.wallet.balance").isNotEmpty());

        // Owner sets portfolioPublic=false
        mvc.perform(put("/api/v1/trading/account/portfolio-visibility")
                        .header("Authorization", ownerBearer)
                        .contentType("application/json")
                        .content("{\"portfolioPublic\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.portfolioPublic").value(false))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty());

        // Anonymous visitor gets sanitized hidden response with NO balance, entryPrice, or liquidationPrice leak
        String anonBody = mvc.perform(get("/api/v1/trading/portfolios/members/" + ownerId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.portfolioPublic").value(false))
                .andExpect(jsonPath("$.positions.length()").value(0))
                .andExpect(jsonPath("$.wallet.balance").isEmpty())
                .andExpect(jsonPath("$.wallet.totalEquity").isEmpty())
                .andReturn().getResponse().getContentAsString();
        assertThat(anonBody).doesNotContain("1000");

        // Another logged-in member also gets sanitized hidden response
        mvc.perform(get("/api/v1/trading/portfolios/members/" + ownerId)
                        .header("Authorization", otherBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.portfolioPublic").value(false))
                .andExpect(jsonPath("$.positions.length()").value(0))
                .andExpect(jsonPath("$.wallet.balance").isEmpty());

        // Owner STILL sees own full positions and balances (with portfolioPublic=false)
        mvc.perform(get("/api/v1/trading/portfolios/members/" + ownerId)
                        .header("Authorization", ownerBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.portfolioPublic").value(false))
                .andExpect(jsonPath("$.positions.length()").value(1))
                .andExpect(jsonPath("$.wallet.balance").isNotEmpty());

        // Admin STILL sees full positions and balances
        mvc.perform(get("/api/v1/trading/portfolios/members/" + ownerId)
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.portfolioPublic").value(false))
                .andExpect(jsonPath("$.positions.length()").value(1))
                .andExpect(jsonPath("$.wallet.balance").isNotEmpty());

        // Toggle back to true -> public visitor sees positions again
        mvc.perform(put("/api/v1/trading/account/portfolio-visibility")
                        .header("Authorization", ownerBearer)
                        .contentType("application/json")
                        .content("{\"portfolioPublic\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.portfolioPublic").value(true));

        mvc.perform(get("/api/v1/trading/portfolios/members/" + ownerId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.portfolioPublic").value(true))
                .andExpect(jsonPath("$.positions.length()").value(1));
    }

    @Test
    void actuatorRequestIdAdminOpsSummaryAndSafeHoldReleaseWorkEndToEnd() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long memberId = MEMBERS.incrementAndGet();
        String adminBearer = "Bearer " + adminToken(adminId);
        String memberBearer = "Bearer " + memberToken(memberId);
        long memberAccountId = memberAccounts.open(memberId).accountId();

        // 1. Public Actuator health probes succeed without auth and include X-Request-Id
        mvc.perform(get("/actuator/health").header("X-Request-Id", "ops-check-123456"))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Request-Id", "ops-check-123456"))
                .andExpect(jsonPath("$.status").value("UP"));
        mvc.perform(get("/actuator/health/liveness"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
        mvc.perform(get("/actuator/health/readiness"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));

        // 2. /actuator/info, /actuator/metrics, /api/v1/trading/admin/ops/summary require ROLE_ADMIN
        mvc.perform(get("/actuator/info")).andExpect(status().isForbidden());
        mvc.perform(get("/actuator/info").header("Authorization", memberBearer)).andExpect(status().isForbidden());
        mvc.perform(get("/actuator/info").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.build.artifact").value("trading-server"));

        mvc.perform(get("/actuator/metrics").header("Authorization", memberBearer)).andExpect(status().isForbidden());
        mvc.perform(get("/actuator/metrics").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.names").isArray());

        mvc.perform(get("/api/v1/trading/admin/ops/summary")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/trading/admin/ops/summary").header("Authorization", memberBearer)).andExpect(status().isForbidden());

        // Trigger a 409 error so OpsErrorBuffer captures it
        errorBuffer.clear();
        mvc.perform(post("/api/v1/trading/account/orders")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", key())
                        .contentType("application/json")
                        .content("{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":50}"))
                .andExpect(status().isConflict())
                .andExpect(header().exists("X-Request-Id"))
                .andExpect(jsonPath("$.code").value("LEVERAGE_MISMATCH"))
                .andExpect(jsonPath("$.requestId").isNotEmpty());

        // 3. Create a LEDGER_MISMATCH hold by corrupting wallet balance
        jdbc.update("update trading.wallet set balance = balance + 10 where account_id = ?", memberAccountId);
        assertThat(reconciler.reconcile(memberAccountId).status()).isEqualTo("MISMATCH");

        // Admin ops summary reflects DB UP, unresolved hold, ledgerMismatches >= 1, and recentErrors containing LEVERAGE_MISMATCH
        mvc.perform(get("/api/v1/trading/admin/ops/summary").header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(header().exists("X-Request-Id"))
                .andExpect(jsonPath("$.status.engineStatus").value("READY"))
                .andExpect(jsonPath("$.dependencies.db").value("UP"))
                .andExpect(jsonPath("$.dependencies.binanceMarkWs").value("DISABLED"))
                .andExpect(jsonPath("$.dependencies.binanceOrderBookWs").value("DISABLED"))
                .andExpect(jsonPath("$.workerMeasurements").exists())
                .andExpect(jsonPath("$.riskHolds.unresolvedCount").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$.ledgerMismatches").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$.activeWebSockets.market").value(0))
                .andExpect(jsonPath("$.activeWebSockets.trading").value(0))
                .andExpect(jsonPath("$.recentErrors[0].code").value("LEVERAGE_MISMATCH"));

        // 4. Attempting hold release while still MISMATCH returns 409 and does NOT clear the hold
        mvc.perform(post("/api/v1/trading/admin/ops/holds/" + memberAccountId + "/release")
                        .header("Authorization", adminBearer))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.reconciliationStatus").value("MISMATCH"))
                .andExpect(jsonPath("$.releasedCount").value(0));

        assertThat(jdbc.queryForObject(
                "select count(*) from trading.risk_hold where account_id=? and resolved_at is null",
                Long.class, memberAccountId)).isEqualTo(1L);

        // 5. Repair the balance corruption -> hold release succeeds with 200 MATCHED and releasedCount=1
        jdbc.update("update trading.wallet set balance = balance - 10 where account_id = ?", memberAccountId);

        mvc.perform(post("/api/v1/trading/admin/ops/holds/" + memberAccountId + "/release")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"reference\":\"TICKET-OPS-2026-01\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reconciliationStatus").value("MATCHED"))
                .andExpect(jsonPath("$.releasedCount").value(1))
                .andExpect(jsonPath("$.resolutionReference").value("TICKET-OPS-2026-01"));

        assertThat(jdbc.queryForObject(
                "select count(*) from trading.risk_hold where account_id=? and resolved_at is null",
                Long.class, memberAccountId)).isZero();
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

    private void mark(long symbolId, String price) {
        Instant now = Instant.now();
        Instant event = prices.find(symbolId).latestPrice().map(LatestMarkPrice::eventTime)
                .filter(p -> !p.isBefore(now)).map(p -> p.plusNanos(1)).orElse(now);
        assertThat(prices.update(new LatestMarkPrice(symbolId, new BigDecimal(price), event, now))).isTrue();
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
            return new RSAKeyGenerator(2048).keyID("ops-test-key").generate();
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
            Path file = Files.createTempFile("trading-ops-test-pub-", ".pem");
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
