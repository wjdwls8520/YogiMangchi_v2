package com.yogimangchi.trading.notification;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.yogimangchi.trading.contest.ContestSettlementService;
import com.yogimangchi.trading.execution.trigger.AccountTriggerService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.support.LegacyLeverageFixtures;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.service.MemberAccounts;
import com.yogimangchi.trading.tradingaccount.service.MemberWithdrawal;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
class TradingNotificationIntegrationTests {

    private static final RSAKey KEY = generateKey();
    private static final Path PUBLIC_KEY = writePublicKeyFile();
    private static final JwtEncoder ENCODER = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(KEY)));
    private static final AtomicLong MEMBERS = new AtomicLong(9_800_000L);

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
    @Autowired private AccountTriggerService accountTriggerService;
    @Autowired private ContestSettlementService settlementService;
    @Autowired private MemberWithdrawal memberWithdrawal;
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
    void mockMarketLimitStopLossAndBankruptLiquidationEmitV1ParityNotifications() throws Exception {
        long memberId = MEMBERS.incrementAndGet();
        String bearer = "Bearer " + memberToken(memberId);

        // Even before opening a MOCK trading account, member notification endpoints return 200 OK (not 409)
        mvc.perform(get("/api/v1/trading/notifications/status").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newCount").value(0))
                .andExpect(jsonPath("$.unreadCount").value(0));

        long mockAccountId = memberAccounts.open(memberId).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc, mockAccountId, btc);

        // 1. Market OPEN (1 BTC LONG @ 1000, 10x) -> ORDER_COMPLETED (MARKET / OPEN)
        String marketOpenBody = placeMockOrder(bearer, "MARKET", btc, "LONG", "1", 10, null);
        long posId = json.readTree(marketOpenBody).path("positionId").asLong();

        // 2. Market CLOSE (0.4 BTC) @ 1050 -> ORDER_COMPLETED (MARKET / CLOSE) with realizedPnl
        mark(btc, "1050");
        mvc.perform(post("/api/v1/trading/account/positions/" + posId + "/close")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType("application/json")
                        .content("{\"quantity\":\"0.4\"}"))
                .andExpect(status().isOk());

        // 3. Pending LIMIT OPEN (0.5 BTC LONG @ 980, 10x) -> filled when price crosses 975
        placeMockOrder(bearer, "LIMIT", btc, "LONG", "0.5", 10, "980");
        Thread.sleep(10);
        LatestMarkPrice limitTick = mark(btc, "975");
        accountTriggerService.process(mockAccountId, limitTick, Map.of(btc, limitTick));

        // 4. Stop-Loss on remaining BTC LONG position -> set stopPrice=960, trigger @ 955 -> ORDER_COMPLETED (STOP_MARKET / CLOSE)
        mvc.perform(put("/api/v1/trading/account/positions/" + posId + "/stop-loss")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType("application/json")
                        .content("{\"stopPrice\":\"960\",\"expectedVersion\":0}"))
                .andExpect(status().isOk());
        Thread.sleep(10);
        LatestMarkPrice stopTick = mark(btc, "955");
        accountTriggerService.process(mockAccountId, stopTick, Map.of(btc, stopTick));

        // 5. Forced Liquidation that drives entire wallet to BANKRUPT -> LIQUIDATION_COMPLETED still recorded!
        long liqMemberId = MEMBERS.incrementAndGet();
        String liqBearer = "Bearer " + memberToken(liqMemberId);
        long liqAccountId = memberAccounts.open(liqMemberId).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc, liqAccountId, eth);
        jdbc.update("update trading.wallet set balance = 201 where account_id = ?", liqAccountId);
        mark(eth, "200");
        // 10 ETH * 200 = 2,000 notional -> 200 margin + 1.00 fee = 201.00 USDT (0 free cash left)
        placeMockOrder(liqBearer, "MARKET", eth, "LONG", "10", 10, null);
        Thread.sleep(10);
        LatestMarkPrice crashTick = mark(eth, "150");
        accountTriggerService.process(liqAccountId, crashTick, Map.of(eth, crashTick));

        String liqAccountStatus = jdbc.queryForObject(
                "select status from trading.trading_account where id=?", String.class, liqAccountId);
        assertThat(liqAccountStatus).isEqualTo("BANKRUPT");

        String liqNotifsBody = mvc.perform(get("/api/v1/trading/notifications")
                        .header("Authorization", liqBearer))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode liqContent = json.readTree(liqNotifsBody).path("content");
        assertThat(liqContent).hasSize(2);
        assertThat(liqContent.get(0).path("type").asText()).isEqualTo("LIQUIDATION_COMPLETED");
        assertThat(liqContent.get(0).path("category").asText()).isEqualTo("MOCK");
        assertThat(liqContent.get(0).path("payload").path("displayNameKr").asText()).isEqualTo("이더리움");
        assertThat(liqContent.get(0).path("payload").path("liquidationPrice").asText()).isEqualTo("150");

        // Verify member 1's 4 notifications (STOP_MARKET CLOSE, LIMIT OPEN, MARKET CLOSE, MARKET OPEN in newest-first order)
        String notifsBody = mvc.perform(get("/api/v1/trading/notifications")
                        .header("Authorization", bearer)
                        .param("category", "MOCK"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode content = json.readTree(notifsBody).path("content");
        assertThat(content).hasSize(4);
        assertThat(content.get(0).path("type").asText()).isEqualTo("ORDER_COMPLETED");
        assertThat(content.get(0).path("payload").path("orderType").asText()).isEqualTo("STOP_MARKET");
        assertThat(content.get(0).path("payload").path("positionAction").asText()).isEqualTo("CLOSE");
        assertThat(content.get(0).path("payload").path("displayNameKr").asText()).isEqualTo("비트코인");

        assertThat(content.get(1).path("payload").path("orderType").asText()).isEqualTo("LIMIT");
        assertThat(content.get(1).path("payload").path("positionAction").asText()).isEqualTo("OPEN");

        assertThat(content.get(2).path("payload").path("orderType").asText()).isEqualTo("MARKET");
        assertThat(content.get(2).path("payload").path("positionAction").asText()).isEqualTo("CLOSE");

        assertThat(content.get(3).path("payload").path("orderType").asText()).isEqualTo("MARKET");
        assertThat(content.get(3).path("payload").path("positionAction").asText()).isEqualTo("OPEN");

        // Verify badge status, check, mark read, and delete-read lifecycle
        mvc.perform(get("/api/v1/trading/notifications/status").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newCount").value(4))
                .andExpect(jsonPath("$.unreadCount").value(4));

        mvc.perform(put("/api/v1/trading/notifications/check").header("Authorization", bearer))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/trading/notifications/status").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.newCount").value(0))
                .andExpect(jsonPath("$.unreadCount").value(4));

        long firstNotifId = content.get(0).path("notificationId").asLong();
        mvc.perform(put("/api/v1/trading/notifications/" + firstNotifId + "/read").header("Authorization", bearer))
                .andExpect(status().isNoContent());

        mvc.perform(delete("/api/v1/trading/notifications/read").header("Authorization", bearer))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/trading/notifications/status").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unreadCount").value(3));
    }

    @Test
    void contestRejectApproveOrderAndSeasonSettlementEmitExactNotificationsWithoutSpuriousLiquidation() throws Exception {
        long adminId = MEMBERS.incrementAndGet();
        long winnerId = MEMBERS.incrementAndGet();
        long runnerUpId = MEMBERS.incrementAndGet();

        String adminBearer = "Bearer " + adminToken(adminId);
        String winnerBearer = "Bearer " + memberToken(winnerId);
        String runnerUpBearer = "Bearer " + memberToken(runnerUpId);

        Instant now = Instant.now();
        long seasonId = createSeasonViaAdmin(
                adminBearer,
                "제1회 요기망치 실전 대회",
                "10000",
                now.minusSeconds(3600),
                now.plusSeconds(3600),
                now.minusSeconds(600),
                now.plusSeconds(3600));

        // 1. Winner applies -> Admin rejects -> CONTEST_APPLICATION_REJECTED
        long appId = applyForSeason(winnerBearer, seasonId, "우승후보");
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + seasonId + "/applicants/" + appId + "/reject")
                        .header("Authorization", adminBearer)
                        .contentType("application/json")
                        .content("{\"reason\":\"닉네임 확인 후 재신청 바랍니다.\"}"))
                .andExpect(status().isOk());

        // 2. Winner re-applies & RunnerUp applies -> Admin bulk-approves -> CONTEST_APPLICATION_APPROVED
        applyForSeason(winnerBearer, seasonId, "우승후보");
        applyForSeason(runnerUpBearer, seasonId, "준우승후보");
        mvc.perform(post("/api/v1/trading/admin/contest/seasons/" + seasonId + "/applicants/bulk-approve")
                        .header("Authorization", adminBearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        Long winnerContestAccountId = jdbc.queryForObject(
                "select account_id from trading.contest_participant where contest_season_id=? and member_id=?",
                Long.class, seasonId, winnerId);
        LegacyLeverageFixtures.bothDirections(jdbc, winnerContestAccountId, btc);

        // 3. Winner opens 1 BTC LONG @ 1000 in CONTEST -> ORDER_COMPLETED (category=CONTEST)
        mark(btc, "1000");
        placeContestOrder(winnerBearer, seasonId, "MARKET", btc, "LONG", "1", 10, null);

        // 4. BTC rises to 1120 -> Winner has open position (+120 USDT unrealized); settle contest season!
        mark(btc, "1120");
        var result = settlementService.executePipeline(seasonId, "ADMIN:" + adminId, true, 10);
        assertThat(result.status()).isEqualTo("COMPLETED");
        assertThat(result.liquidatedPositionCount()).isEqualTo(1);
        assertThat(result.finalizedParticipantCount()).isEqualTo(2);

        // Verify Winner's CONTEST notifications:
        // [0] CONTEST_SEASON_SETTLED (rank 1 of 2, NO administrative LIQUIDATION_COMPLETED!)
        // [1] ORDER_COMPLETED (category=CONTEST)
        // [2] CONTEST_APPLICATION_APPROVED
        // [3] CONTEST_APPLICATION_REJECTED
        String winnerNotifsBody = mvc.perform(get("/api/v1/trading/notifications")
                        .header("Authorization", winnerBearer)
                        .param("category", "CONTEST"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode winnerContent = json.readTree(winnerNotifsBody).path("content");
        assertThat(winnerContent).hasSize(4);

        assertThat(winnerContent.get(0).path("type").asText()).isEqualTo("CONTEST_SEASON_SETTLED");
        assertThat(winnerContent.get(0).path("payload").path("seasonTitle").asText()).isEqualTo("제1회 요기망치 실전 대회");
        assertThat(winnerContent.get(0).path("payload").path("finalRank").asInt()).isEqualTo(1);
        assertThat(winnerContent.get(0).path("payload").path("totalParticipants").asInt()).isEqualTo(2);

        assertThat(winnerContent.get(1).path("type").asText()).isEqualTo("ORDER_COMPLETED");
        assertThat(winnerContent.get(1).path("category").asText()).isEqualTo("CONTEST");
        assertThat(winnerContent.get(1).path("payload").path("seasonTitle").asText()).isEqualTo("제1회 요기망치 실전 대회");

        assertThat(winnerContent.get(2).path("type").asText()).isEqualTo("CONTEST_APPLICATION_APPROVED");
        assertThat(winnerContent.get(3).path("type").asText()).isEqualTo("CONTEST_APPLICATION_REJECTED");
        assertThat(winnerContent.get(3).path("payload").path("rejectReason").asText()).isEqualTo("닉네임 확인 후 재신청 바랍니다.");

        // RunnerUp receives CONTEST_SEASON_SETTLED with finalRank = 2
        String runnerUpNotifsBody = mvc.perform(get("/api/v1/trading/notifications")
                        .header("Authorization", runnerUpBearer)
                        .param("category", "CONTEST"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode runnerUpContent = json.readTree(runnerUpNotifsBody).path("content");
        assertThat(runnerUpContent).hasSize(2);
        assertThat(runnerUpContent.get(0).path("type").asText()).isEqualTo("CONTEST_SEASON_SETTLED");
        assertThat(runnerUpContent.get(0).path("payload").path("finalRank").asInt()).isEqualTo(2);

        // SSE subscribe endpoint returns 200 OK and replays missed notifications when Last-Event-ID=0
        mvc.perform(get("/api/v1/trading/notifications/subscribe")
                        .header("Authorization", winnerBearer)
                        .header("Last-Event-ID", "0"))
                .andExpect(status().isOk());

        // Member withdrawal cleans up trading notifications cleanly
        memberWithdrawal.withdraw(runnerUpId);
        Long remainingRunnerUpNotifs = jdbc.queryForObject(
                "SELECT COUNT(*) FROM trading.notification WHERE receiver_member_id = ?",
                Long.class, runnerUpId);
        assertThat(remainingRunnerUpNotifs).isZero();
    }

    private String placeMockOrder(
            String bearer,
            String type,
            long symbolId,
            String side,
            String quantity,
            int leverage,
            String limitPrice) throws Exception {
        var payload = new LinkedHashMap<String, Object>();
        payload.put("type", type);
        payload.put("tradingSymbolId", symbolId);
        payload.put("side", side);
        payload.put("quantity", quantity);
        payload.put("leverage", leverage);
        if (limitPrice != null) {
            payload.put("limitPrice", limitPrice);
        }
        return mvc.perform(post("/api/v1/trading/account/orders")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType("application/json")
                        .content(json.writeValueAsString(payload)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private String placeContestOrder(
            String bearer,
            long seasonId,
            String type,
            long symbolId,
            String side,
            String quantity,
            int leverage,
            String limitPrice) throws Exception {
        var payload = new LinkedHashMap<String, Object>();
        payload.put("type", type);
        payload.put("tradingSymbolId", symbolId);
        payload.put("side", side);
        payload.put("quantity", quantity);
        payload.put("leverage", leverage);
        if (limitPrice != null) {
            payload.put("limitPrice", limitPrice);
        }
        return mvc.perform(post("/api/v1/trading/contest/seasons/" + seasonId + "/orders")
                        .header("Authorization", bearer)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType("application/json")
                        .content(json.writeValueAsString(payload)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
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

    private LatestMarkPrice mark(long symbolId, String price) {
        Instant now = Instant.now();
        Instant event = prices.find(symbolId).latestPrice().map(LatestMarkPrice::eventTime)
                .filter(p -> !p.isBefore(now)).map(p -> p.plusNanos(1)).orElse(now);
        LatestMarkPrice tick = new LatestMarkPrice(symbolId, new BigDecimal(price), event, now);
        assertThat(prices.update(tick)).isTrue();
        return tick;
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
            Path file = Files.createTempFile("yogimangchi-trading-notif-test-key-", ".pem");
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
