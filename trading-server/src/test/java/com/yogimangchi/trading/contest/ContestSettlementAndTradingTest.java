package com.yogimangchi.trading.contest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import com.yogimangchi.trading.support.LegacyLeverageFixtures;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.service.MemberAccounts;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "binance.mark-price.enabled=false",
        "binance.order-book.enabled=false",
        "trading.member-auth.enabled=true",
        "trading.contest.auto-settlement-enabled=false"
})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class ContestSettlementAndTradingTest {

    private static final RSAKey KEY = generateKey();
    private static final Path PUBLIC_KEY = writePublicKeyFile();
    private static final JwtEncoder ENCODER = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(KEY)));
    private static final AtomicLong MEMBERS = new AtomicLong(9500000);

    @DynamicPropertySource
    static void jwtSettings(DynamicPropertyRegistry registry) {
        registry.add("trading.member-auth.public-key-path", PUBLIC_KEY::toString);
        registry.add("trading.member-auth.issuer", () -> "https://content.test");
    }

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private MemberAccounts memberAccounts;
    @Autowired private LatestPriceStore prices;
    @Autowired private ContestSettlementService settlementService;
    @Autowired private ContestSettlementChunkExecutor chunkExecutor;
    @Autowired private ContestSettlementScheduler settlementScheduler;
    @Autowired private LedgerReconciler reconciler;
    @Autowired private com.yogimangchi.trading.tradingaccount.security.TradingCredentials tradingCredentials;
    @Autowired private com.yogimangchi.trading.tradingaccount.service.MemberWithdrawal memberWithdrawal;
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
    }

    @AfterEach
    void cleanup() {
        prices.markUnavailable();
    }

    @Test
    void mockAndContestWalletsAreStrictlySeparatedAcrossSeasonsAndAdminAccessIsEnforced() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long memberId = MEMBERS.incrementAndGet();
        String adminBearer = "Bearer " + adminToken(adminId);
        String memberBearer = "Bearer " + memberToken(memberId);

        // Non-admin member cannot access admin contest endpoints (must receive 403 ACCESS_DENIED, not 409)
        mvc.perform(get("/api/v1/trading/admin/contest/seasons").header("Authorization", memberBearer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        // Open member's MOCK account (10,000 USDT)
        long mockAccountId = memberAccounts.open(memberId).accountId();
        assertThat(jdbc.queryForObject("select account_type from trading.trading_account where id=?", String.class, mockAccountId))
                .isEqualTo("MOCK");

        Instant now = Instant.now();
        long season1Id = createSeasonViaAdmin(adminBearer, "시즌 1 대회", "20000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));
        long season2Id = createSeasonViaAdmin(adminBearer, "시즌 2 대회", "50000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));

        // Apply to both seasons as member
        long app1Id = applyForSeason(memberBearer, season1Id, "알파트레이더");
        long app2Id = applyForSeason(memberBearer, season2Id, "알파트레이더");

        // Approve season 1 individually and season 2 via bulk-approve
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + season1Id + "/applicants/" + app1Id + "/approve")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.seedMoney").value("20000"));

        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + season2Id + "/applicants/bulk-approve")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"applicationIds\":[" + app2Id + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].seedMoney").value("50000"));

        // Verify MOCK account lookup and PublicPortfolioService still resolve exclusively to mockAccountId
        assertThat(memberAccounts.open(memberId).accountId()).isEqualTo(mockAccountId);
        mvc.perform(get("/api/v1/trading/portfolios/members/" + memberId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountExists").value(true))
                .andExpect(jsonPath("$.initialSeed").value("10000"))
                .andExpect(jsonPath("$.wallet.balance").value("10000"));

        // Verify Season 1 and Season 2 contest summaries have completely independent wallets
        mvc.perform(get("/api/v1/trading/contest/seasons/" + season1Id + "/summary")
                        .header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountSummary.wallet.balance").value("20000.000000000000000000"));

        mvc.perform(get("/api/v1/trading/contest/seasons/" + season1Id + "/account/summary")
                        .header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.wallet.balance").value("20000.000000000000000000"));

        mvc.perform(get("/api/v1/trading/contest/seasons/" + season2Id + "/summary")
                        .header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountSummary.wallet.balance").value("50000.000000000000000000"));

        mvc.perform(get("/api/v1/trading/contest/seasons/" + season2Id + "/account/summary")
                        .header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.wallet.balance").value("50000.000000000000000000"));

        // Verify TradingCredentials resolves MOCK account when contestSeasonId is null, and CONTEST account when contestSeasonId is provided
        String rawToken = memberToken(memberId);
        Long season1AccountId = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                Long.class, season1Id, memberId);
        Long season2AccountId = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                Long.class, season2Id, memberId);
        assertThat(tradingCredentials.authenticate(rawToken).orElseThrow().accountId()).isEqualTo(mockAccountId);
        assertThat(tradingCredentials.authenticate(rawToken, season1Id).orElseThrow().accountId()).isEqualTo(season1AccountId);
        assertThat(tradingCredentials.authenticate(rawToken, season2Id).orElseThrow().accountId()).isEqualTo(season2AccountId);
    }

    @Test
    void chunkedSettlementSoftCancelsPendingOrdersForceLiquidatesOpenPositionsAndAssignsOlympicRanks() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long winnerId = MEMBERS.incrementAndGet();
        long tiedAId = MEMBERS.incrementAndGet();
        long tiedBId = MEMBERS.incrementAndGet();
        long loserId = MEMBERS.incrementAndGet();

        String adminBearer = "Bearer " + adminToken(adminId);
        String winnerBearer = "Bearer " + memberToken(winnerId);
        String tiedABearer = "Bearer " + memberToken(tiedAId);
        String tiedBBearer = "Bearer " + memberToken(tiedBId);
        String loserBearer = "Bearer " + memberToken(loserId);

        Instant now = Instant.now();
        long seasonId = createSeasonViaAdmin(adminBearer, "청크 정산 챔피언십", "10000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(3600));

        for (String bearer : List.of(winnerBearer, tiedABearer, tiedBBearer, loserBearer)) {
            applyForSeason(bearer, seasonId, "참가자");
        }
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + seasonId + "/applicants/bulk-approve")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4));

        // Configure 10x leverage for winner, tiedA, tiedB, loser on BTC & ETH
        for (Long mId : List.of(winnerId, tiedAId, tiedBId, loserId)) {
            Long contestAccountId = jdbc.queryForObject(
                    "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                    Long.class, seasonId, mId);
            LegacyLeverageFixtures.bothDirections(jdbc, contestAccountId, btc);
            LegacyLeverageFixtures.bothDirections(jdbc, contestAccountId, eth);
        }

        // 1. Winner opens 1 BTC LONG @ 1000 and 2 pending LIMIT OPEN orders (@ 900, @ 850)
        String winnerOpenBody = placeOrder(winnerBearer, seasonId, "MARKET", btc, "LONG", "1", 10, null);
        long winnerOpenOrderId = json.readTree(winnerOpenBody).path("orderId").asLong();
        placeOrder(winnerBearer, seasonId, "LIMIT", btc, "LONG", "0.5", 10, "900");
        placeOrder(winnerBearer, seasonId, "LIMIT", eth, "LONG", "1", 10, "150");

        // Verify contest terminal endpoints (/orders/{orderId}, /events, /recovery, /performance/symbols, /command-results/query)
        mvc.perform(get("/api/v1/trading/contest/seasons/" + seasonId + "/orders/" + winnerOpenOrderId)
                        .header("Authorization", winnerBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orderId").value(winnerOpenOrderId))
                .andExpect(jsonPath("$.status").value("FILLED"));

        mvc.perform(get("/api/v1/trading/contest/seasons/" + seasonId + "/events")
                        .header("Authorization", winnerBearer)
                        .param("afterId", "0")
                        .param("limit", "50"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3));

        mvc.perform(get("/api/v1/trading/contest/seasons/" + seasonId + "/recovery")
                        .header("Authorization", winnerBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CLEAR"));

        mvc.perform(get("/api/v1/trading/contest/seasons/" + seasonId + "/performance/symbols")
                        .header("Authorization", winnerBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.fillCount").value(1));

        mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/command-results/query")
                        .header("Authorization", winnerBearer)
                        .contentType("application/json")
                        .content("{\"operation\":\"OPEN\",\"idempotencyKey\":\"nonexistent_key_12345\",\"request\":{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":10,\"limitPrice\":null}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("NOT_OBSERVED"));

        // 2. TiedA and TiedB stay at 10000 USDT cash (0% ROI, 0 realized PnL -> tied for rank 2!) and place pending LIMIT orders
        placeOrder(tiedABearer, seasonId, "LIMIT", btc, "LONG", "0.5", 10, "900");
        placeOrder(tiedBBearer, seasonId, "LIMIT", eth, "SHORT", "1", 10, "250");

        // 3. Loser opens 1 BTC SHORT @ 1000 and 5 ETH SHORT @ 200, plus a pending LIMIT CLOSE order on BTC
        String loserOpenBody = placeOrder(loserBearer, seasonId, "MARKET", btc, "SHORT", "1", 10, null);
        long loserBtcPosId = json.readTree(loserOpenBody).path("positionId").asLong();
        placeOrder(loserBearer, seasonId, "MARKET", eth, "SHORT", "5", 10, null);
        mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/positions/" + loserBtcPosId + "/close-orders")
                        .header("Authorization", loserBearer)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType("application/json")
                        .content("{\"quantity\":\"0.4\",\"limitPrice\":\"950\"}"))
                .andExpect(status().isOk());

        // Move mark prices: BTC -> 1080 (+80 for Winner LONG, -80 for Loser SHORT), ETH -> 210 (-50 for Loser SHORT)
        mark(btc, "1080");
        mark(eth, "210");

        // Execute multi-batch chunk settlement with chunkSize = 2 to verify multi-chunk keyset pagination!
        var result = settlementService.executePipeline(seasonId, "ADMIN:" + adminId, true, 2);
        assertThat(result.status()).isEqualTo("COMPLETED");
        assertThat(result.canceledOrderCount()).isEqualTo(5);
        assertThat(result.liquidatedPositionCount()).isEqualTo(3);
        assertThat(result.finalizedParticipantCount()).isEqualTo(4);

        // Verify 0 PENDING orders and 0 OPEN positions remain in the season
        long remainingPending = jdbc.queryForObject("""
                SELECT COUNT(*) FROM trading.trading_order o
                JOIN trading.trading_account a ON a.id = o.account_id
                WHERE a.contest_season_id = ? AND o.status = 'PENDING'
                """, Long.class, seasonId);
        long remainingOpen = jdbc.queryForObject("""
                SELECT COUNT(*) FROM trading.position p
                JOIN trading.trading_account a ON a.id = p.account_id
                WHERE a.contest_season_id = ? AND p.status = 'OPEN'
                """, Long.class, seasonId);
        assertThat(remainingPending).isZero();
        assertThat(remainingOpen).isZero();

        // Verify soft-canceled orders have status=CANCELED and reason=CONTEST_SETTLEMENT
        long softCanceledCount = jdbc.queryForObject("""
                SELECT COUNT(*) FROM trading.trading_order o
                JOIN trading.trading_account a ON a.id = o.account_id
                WHERE a.contest_season_id = ? AND o.status = 'CANCELED' AND o.reason = 'CONTEST_SETTLEMENT'
                """, Long.class, seasonId);
        assertThat(softCanceledCount).isEqualTo(5L);

        // Verify force-liquidated positions have status=LIQUIDATED and close_reason=CONTEST_SETTLEMENT
        long forceLiquidatedCount = jdbc.queryForObject("""
                SELECT COUNT(*) FROM trading.position p
                JOIN trading.trading_account a ON a.id = p.account_id
                WHERE a.contest_season_id = ? AND p.status = 'LIQUIDATED' AND p.close_reason = 'CONTEST_SETTLEMENT'
                """, Long.class, seasonId);
        assertThat(forceLiquidatedCount).isEqualTo(3L);

        // Verify LedgerReconciler passes (MATCHED) for all 4 contest accounts!
        for (Long mId : List.of(winnerId, tiedAId, tiedBId, loserId)) {
            Long contestAccountId = jdbc.queryForObject(
                    "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                    Long.class, seasonId, mId);
            var check = reconciler.check(contestAccountId);
            assertThat(check.status()).isEqualTo("MATCHED");
            assertThat(check.failedChecks()).isEmpty();
        }

        // Verify Olympic Ranking (1, 2, 2, 4): winner=1, tiedA=2, tiedB=2, loser=4
        String lbBody = mvc.perform(get("/api/v1/trading/contest/public/seasons/" + seasonId + "/leaderboard"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(4))
                .andReturn().getResponse().getContentAsString();
        JsonNode items = json.readTree(lbBody).path("items");
        assertThat(items.get(0).path("memberId").asLong()).isEqualTo(winnerId);
        assertThat(items.get(0).path("rank").asInt()).isEqualTo(1);
        assertThat(items.get(0).path("tradeCount").asLong()).isEqualTo(1L);
        assertThat(items.get(0).path("winRate").asText()).isEqualTo("100.0%");
        assertThat(items.get(1).path("rank").asInt()).isEqualTo(2);
        assertThat(items.get(1).path("tradeCount").asLong()).isZero();
        assertThat(items.get(1).path("winRate").asText()).isEqualTo("0.0%");
        assertThat(items.get(2).path("rank").asInt()).isEqualTo(2);
        assertThat(items.get(2).path("tradeCount").asLong()).isZero();
        assertThat(items.get(2).path("winRate").asText()).isEqualTo("0.0%");
        assertThat(items.get(3).path("memberId").asLong()).isEqualTo(loserId);
        assertThat(items.get(3).path("rank").asInt()).isEqualTo(4);
        assertThat(items.get(3).path("tradeCount").asLong()).isEqualTo(2L);
        assertThat(items.get(3).path("winRate").asText()).isEqualTo("0.0%");

        // Verify new orders after settlement are rejected with CONTEST_NOT_RUNNING
        mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/orders")
                        .header("Authorization", winnerBearer)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType("application/json")
                        .content("{\"type\":\"MARKET\",\"tradingSymbolId\":" + btc + ",\"side\":\"LONG\",\"quantity\":\"0.1\",\"leverage\":10}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTEST_NOT_RUNNING"));

        // Verify cleanup-remaining endpoint works on already-settled seasons
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + seasonId + "/cleanup-remaining")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));
    }

    @Test
    void schedulerAutomaticallySettlesExpiredSeasons() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long memberId = MEMBERS.incrementAndGet();
        String adminBearer = "Bearer " + adminToken(adminId);
        String memberBearer = "Bearer " + memberToken(memberId);

        Instant now = Instant.now();
        long seasonId = createSeasonViaAdmin(adminBearer, "자동 스케줄러 정산 시즌", "10000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(1200));

        applyForSeason(memberBearer, seasonId, "스케줄러테스터");
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + seasonId + "/applicants/bulk-approve")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk());

        Long contestAccountId = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                Long.class, seasonId, memberId);
        LegacyLeverageFixtures.bothDirections(jdbc, contestAccountId, btc);
        placeOrder(memberBearer, seasonId, "MARKET", btc, "LONG", "1", 10, null);
        placeOrder(memberBearer, seasonId, "LIMIT", btc, "LONG", "0.5", 10, "900");

        // Move contest_end_at into the past so the season is due for automatic settlement
        jdbc.update("update trading.contest_season set contest_end_at = now() - interval '1 minute' where id = ?", seasonId);

        int settled = settlementScheduler.settleDueSeasons(Instant.now());
        assertThat(settled).isGreaterThanOrEqualTo(1);

        assertThat(jdbc.queryForObject("select settled_at is not null from trading.contest_season where id=?", Boolean.class, seasonId))
                .isTrue();
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='OPEN'", Long.class, contestAccountId))
                .isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'", Long.class, contestAccountId))
                .isZero();
    }

    @Test
    void distributedSettlementLockRecoversStaleRunsAndProcessesMultiChunk500BatchesWithZeroDiscrepancy() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long member1Id = MEMBERS.incrementAndGet();
        long member2Id = MEMBERS.incrementAndGet();
        String adminBearer = "Bearer " + adminToken(adminId);
        String member1Bearer = "Bearer " + memberToken(member1Id);
        String member2Bearer = "Bearer " + memberToken(member2Id);

        Instant now = Instant.now();
        long seasonId = createSeasonViaAdmin(adminBearer, "멀티청크 500x3 및 분산 락 검증 시즌", "100000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));

        applyForSeason(member1Bearer, seasonId, "대용량테스터1");
        applyForSeason(member2Bearer, seasonId, "대용량테스터2");
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + seasonId + "/applicants/bulk-approve")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        Long account1Id = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                Long.class, seasonId, member1Id);
        Long account2Id = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                Long.class, seasonId, member2Id);
        LegacyLeverageFixtures.bothDirections(jdbc, account1Id, btc);
        LegacyLeverageFixtures.bothDirections(jdbc, account1Id, eth);
        LegacyLeverageFixtures.bothDirections(jdbc, account2Id, btc);
        LegacyLeverageFixtures.bothDirections(jdbc, account2Id, eth);

        // Open real positions on both accounts and 1 template LIMIT OPEN order on account1
        placeOrder(member1Bearer, seasonId, "MARKET", btc, "LONG", "1", 10, null);
        placeOrder(member1Bearer, seasonId, "MARKET", eth, "LONG", "5", 10, null);
        placeOrder(member2Bearer, seasonId, "MARKET", btc, "SHORT", "1", 10, null);
        placeOrder(member2Bearer, seasonId, "MARKET", eth, "SHORT", "5", 10, null);

        String templateLimitBody = placeOrder(member1Bearer, seasonId, "LIMIT", btc, "LONG", "0.5", 10, "900");
        long templateOrderId = json.readTree(templateLimitBody).path("orderId").asLong();
        BigDecimal unitReservedMargin = jdbc.queryForObject(
                "select reserved_margin from trading.trading_order where id = ?",
                BigDecimal.class, templateOrderId);

        // Expand to 1,050 PENDING LIMIT OPEN orders (3 chunks at default CHUNK_SIZE=500: 500 + 500 + 50)
        int extraOrders = 1049;
        jdbc.update("""
                INSERT INTO trading.trading_order (
                    account_id, trading_symbol_id, side, type, action, status,
                    quantity, leverage, requested_leverage, limit_price, reserved_margin,
                    idempotency_key, request_fingerprint, created_at, submitted_margin_mode, fee_rate
                )
                SELECT
                    o.account_id, o.trading_symbol_id, o.side, o.type, o.action, 'PENDING',
                    o.quantity, o.leverage, o.requested_leverage, o.limit_price, o.reserved_margin,
                    'bulk-settlement-key-' || gs.n, o.request_fingerprint, o.created_at, o.submitted_margin_mode, o.fee_rate
                FROM trading.trading_order o
                CROSS JOIN generate_series(1, ?) AS gs(n)
                WHERE o.id = ?
                """, extraOrders, templateOrderId);

        BigDecimal totalExtraReserved = unitReservedMargin.multiply(BigDecimal.valueOf(extraOrders));
        jdbc.update("""
                UPDATE trading.wallet
                SET reserved_margin = reserved_margin + ?
                WHERE account_id = ?
                """, totalExtraReserved, account1Id);

        // Pre-settlement reconciliation must be 100% MATCHED with 1,050 pending reservations
        assertThat(reconciler.check(account1Id).status()).isEqualTo("MATCHED");
        assertThat(reconciler.check(account2Id).status()).isEqualTo("MATCHED");

        // 1. Multi-instance distributed lock check: active RUNNING row (<5m old) blocks concurrent settlement with TRADING_BUSY
        Long simulatedActiveRunId = jdbc.queryForObject("""
                INSERT INTO trading.contest_settlement_run (
                    contest_season_id, attempt_no, triggered_by, status, last_completed_phase, started_at
                ) VALUES (?, 1, 'OTHER_INSTANCE', 'RUNNING', 'STARTED', now() - interval '1 minute')
                RETURNING id
                """, Long.class, seasonId);

        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                        settlementService.settleSeason(seasonId, "ADMIN:" + adminId, true))
                .isInstanceOf(com.yogimangchi.trading.error.BusinessException.class)
                .extracting("code")
                .isEqualTo(com.yogimangchi.trading.error.ErrorCode.TRADING_BUSY);

        // 2. Stale RUNNING row (>5m old) is automatically marked FAILED and recovered by next settlement run!
        jdbc.update("""
                UPDATE trading.contest_settlement_run
                SET started_at = now() - interval '10 minutes'
                WHERE id = ?
                """, simulatedActiveRunId);

        mark(btc, "1050");
        mark(eth, "210");

        long startNanos = System.nanoTime();
        var settlementResult = settlementService.settleSeason(seasonId, "ADMIN:" + adminId, true);
        long elapsedMs = (System.nanoTime() - startNanos) / 1_000_000L;

        assertThat(settlementResult.status()).isEqualTo("COMPLETED");
        assertThat(settlementResult.canceledOrderCount()).isEqualTo(1050);
        assertThat(settlementResult.liquidatedPositionCount()).isEqualTo(4);
        assertThat(settlementResult.finalizedParticipantCount()).isEqualTo(2);
        assertThat(elapsedMs).isLessThan(15_000L);

        // Stale run #1 was marked FAILED
        String staleRunStatus = jdbc.queryForObject(
                "select status from trading.contest_settlement_run where id = ?",
                String.class, simulatedActiveRunId);
        assertThat(staleRunStatus).isEqualTo("FAILED");

        // Post-settlement ledger reconciliation must be 100% MATCHED (0 discrepancy across all 1,050 released reservations + 4 liquidated positions)
        assertThat(reconciler.check(account1Id).status()).isEqualTo("MATCHED");
        assertThat(reconciler.check(account2Id).status()).isEqualTo("MATCHED");

        // 3. Duplicate scheduled settlement (earlyTerminate=false) on already-settled season is rejected idempotently with TRADING_BUSY
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                        chunkExecutor.beginSettlementRun(seasonId, "SYSTEM_SCHEDULER", false, Instant.now()))
                .isInstanceOf(com.yogimangchi.trading.error.BusinessException.class)
                .extracting("code")
                .isEqualTo(com.yogimangchi.trading.error.ErrorCode.TRADING_BUSY);
    }

    @Test
    void contestHistoryBeforeIdPaginationVisibilityGuardsAndMemberWithdrawalWorkCleanly() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long memberId = MEMBERS.incrementAndGet();
        long withdrawMemberId = MEMBERS.incrementAndGet();
        String adminBearer = "Bearer " + adminToken(adminId);
        String memberBearer = "Bearer " + memberToken(memberId);
        String withdrawBearer = "Bearer " + memberToken(withdrawMemberId);

        Instant now = Instant.now();
        long seasonId = createSeasonViaAdmin(adminBearer, "페이징 및 탈퇴 정합성 시즌", "30000",
                now.minusSeconds(3600), now.plusSeconds(3600), now.minusSeconds(600), now.plusSeconds(7200));

        // Overlapping LIVE + recruitment season appears in BOTH running and recruiting
        mvc.perform(get("/api/v1/trading/contest/public/seasons"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.running[?(@.id==" + seasonId + ")]").isNotEmpty())
                .andExpect(jsonPath("$.recruiting[?(@.id==" + seasonId + ")]").isNotEmpty());

        // Application view exposes real seedMoney and recruitmentEndAt
        String appBody = mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/applications")
                        .header("Authorization", memberBearer)
                        .contentType("application/json")
                        .content("{\"nickname\":\"페이징테스터\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.seedMoney").value("30000"))
                .andExpect(jsonPath("$.recruitmentEndAt").isNotEmpty())
                .andReturn().getResponse().getContentAsString();
        long appId = json.readTree(appBody).path("applicationId").asLong();
        long withdrawAppId = applyForSeason(withdrawBearer, seasonId, "탈퇴테스터");

        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + seasonId + "/applicants/bulk-approve")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"applicationIds\":[" + appId + "," + withdrawAppId + "]}"))
                .andExpect(status().isOk());

        Long memberContestAccId = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                Long.class, seasonId, memberId);
        Long withdrawContestAccId = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                Long.class, seasonId, withdrawMemberId);
        LegacyLeverageFixtures.bothDirections(jdbc, memberContestAccId, btc);
        LegacyLeverageFixtures.bothDirections(jdbc, withdrawContestAccId, btc);

        // Place 2 market orders on memberId so /orders and /fills have 2 rows, then paginate with beforeId
        placeOrder(memberBearer, seasonId, "MARKET", btc, "LONG", "0.2", 10, null);
        placeOrder(memberBearer, seasonId, "MARKET", btc, "LONG", "0.3", 10, null);

        String ordersPage1 = mvc.perform(get("/api/v1/trading/contest/seasons/" + seasonId + "/orders")
                        .header("Authorization", memberBearer)
                        .param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andReturn().getResponse().getContentAsString();
        long firstOrderId = json.readTree(ordersPage1).get(0).path("orderId").asLong();

        String ordersPage2 = mvc.perform(get("/api/v1/trading/contest/seasons/" + seasonId + "/orders")
                        .header("Authorization", memberBearer)
                        .param("limit", "1")
                        .param("beforeId", Long.toString(firstOrderId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andReturn().getResponse().getContentAsString();
        long secondOrderId = json.readTree(ordersPage2).get(0).path("orderId").asLong();
        assertThat(secondOrderId).isLessThan(firstOrderId);

        String fillsPage1 = mvc.perform(get("/api/v1/trading/contest/seasons/" + seasonId + "/fills")
                        .header("Authorization", memberBearer)
                        .param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andReturn().getResponse().getContentAsString();
        long firstFillId = json.readTree(fillsPage1).get(0).path("fillId").asLong();

        String fillsPage2 = mvc.perform(get("/api/v1/trading/contest/seasons/" + seasonId + "/fills")
                        .header("Authorization", memberBearer)
                        .param("limit", "1")
                        .param("beforeId", Long.toString(firstFillId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andReturn().getResponse().getContentAsString();
        long secondFillId = json.readTree(fillsPage2).get(0).path("fillId").asLong();
        assertThat(secondFillId).isLessThan(firstFillId);

        // Open position + pending limit order on withdrawMemberId, then withdraw member
        placeOrder(withdrawBearer, seasonId, "MARKET", btc, "LONG", "0.5", 10, null);
        placeOrder(withdrawBearer, seasonId, "LIMIT", btc, "LONG", "0.5", 10, "900");
        memberWithdrawal.withdraw(withdrawMemberId);

        assertThat(jdbc.queryForObject("select status from trading.trading_account where id=?", String.class, withdrawContestAccId))
                .isEqualTo("WITHDRAWN");
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='OPEN'", Long.class, withdrawContestAccId))
                .isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'", Long.class, withdrawContestAccId))
                .isZero();
        assertThat(reconciler.check(withdrawContestAccId).status()).isEqualTo("MATCHED");

        // Hidden season leaderboard returns 404 CONTEST_SEASON_NOT_FOUND
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v1/trading/admin/contest/seasons/" + seasonId + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"isPublic\":false}"))
                .andExpect(status().isOk());

        mvc.perform(get("/api/v1/trading/contest/public/seasons/" + seasonId + "/leaderboard"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CONTEST_SEASON_NOT_FOUND"));

        // Restore public visibility, settle season, and verify /account/seasons separates active vs past
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v1/trading/admin/contest/seasons/" + seasonId + "/status")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"isPublic\":true}"))
                .andExpect(status().isOk());

        settlementService.settleSeason(seasonId, "ADMIN:" + adminId, true);

        mvc.perform(get("/api/v1/trading/contest/account/seasons")
                        .header("Authorization", memberBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeSeason").doesNotExist())
                .andExpect(jsonPath("$.participatingSeasons.length()").value(0))
                .andExpect(jsonPath("$.pastSeasons.length()").value(1));
    }

    private long createSeasonViaAdmin(
            String adminBearer,
            String title,
            String seedMoney,
            Instant recStart,
            Instant recEnd,
            Instant conStart,
            Instant conEnd) throws Exception {
        String payload = json.writeValueAsString(Map.of(
                "title", title,
                "description", title + " 설명",
                "seedMoney", seedMoney,
                "recruitmentStartAt", recStart.toString(),
                "recruitmentEndAt", recEnd.toString(),
                "contestStartAt", conStart.toString(),
                "contestEndAt", conEnd.toString(),
                "isPublic", true));
        String body = mvc.perform(post("/api/v1/trading/admin/contest/seasons")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body).path("id").asLong();
    }

    private long applyForSeason(String memberBearer, long seasonId, String nickname) throws Exception {
        String body = mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/applications")
                        .header("Authorization", memberBearer)
                        .contentType("application/json")
                        .content(json.writeValueAsString(Map.of("nickname", nickname))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body).path("applicationId").asLong();
    }

    private String placeOrder(
            String memberBearer,
            long seasonId,
            String type,
            long symbolId,
            String side,
            String quantity,
            int leverage,
            String limitPrice) throws Exception {
        var payload = new java.util.LinkedHashMap<String, Object>();
        payload.put("type", type);
        payload.put("tradingSymbolId", symbolId);
        payload.put("side", side);
        payload.put("quantity", quantity);
        payload.put("leverage", leverage);
        if (limitPrice != null) {
            payload.put("limitPrice", limitPrice);
        }
        return mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/orders")
                        .header("Authorization", memberBearer)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType("application/json")
                        .content(json.writeValueAsString(payload)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private void mark(long symbolId, String price) {
        Instant now = Instant.now();
        Instant event = prices.find(symbolId).latestPrice().map(LatestMarkPrice::eventTime)
                .filter(p -> !p.isBefore(now)).map(p -> p.plusNanos(1)).orElse(now);
        assertThat(prices.update(new LatestMarkPrice(symbolId, new BigDecimal(price), event, now))).isTrue();
    }

    private static String memberToken(long memberId) {
        return signToken(memberId, List.of("MEMBER"));
    }

    private static String adminToken(long memberId) {
        return signToken(memberId, List.of("MEMBER", "ADMIN"));
    }

    private static String signToken(long memberId, List<String> roles) {
        Instant now = Instant.now();
        var claims = JwtClaimsSet.builder()
                .issuer("https://content.test")
                .subject(Long.toString(memberId))
                .issuedAt(now.minusSeconds(2))
                .expiresAt(now.plusSeconds(600))
                .audience(List.of("trading"))
                .claim("token_use", "access")
                .claim("roles", roles)
                .build();
        return ENCODER.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(), claims)).getTokenValue();
    }

    private static RSAKey generateKey() {
        try {
            return new RSAKeyGenerator(2048).generate();
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    private static Path writePublicKeyFile() {
        try {
            Path file = Files.createTempFile("yogimangchi-contest-test-key-", ".pem");
            file.toFile().deleteOnExit();
            Files.writeString(file, "-----BEGIN PUBLIC KEY-----\n"
                    + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(KEY.toRSAPublicKey().getEncoded())
                    + "\n-----END PUBLIC KEY-----\n");
            return file;
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }
}
