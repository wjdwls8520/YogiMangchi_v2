package com.yogimangchi.trading.portfolio;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.dto.OrderResponse;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.LegacyLeverageFixtures;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.MemberAccounts;
import com.yogimangchi.trading.tradingaccount.service.MemberWithdrawal;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import com.yogimangchi.trading.tradinground.MemberRounds;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneOffset;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"binance.mark-price.enabled=false", "binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class PublicPortfolioAndLedgerFilterIntegrationTests {

    private static final AtomicLong MEMBERS = new AtomicLong(9200000);

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private TradingAccountService accounts;
    @Autowired private MemberAccounts members;
    @Autowired private MemberWithdrawal withdrawals;
    @Autowired private MemberRounds rounds;
    @Autowired private TradingOrderService orders;
    @Autowired private LatestPriceStore prices;
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
    void publicPortfolioReturnsEmptySnapshotWhenMemberHasNoAccountOrIsWithdrawnWithoutCreatingAccount() throws Exception {
        long unprovisionedMemberId = MEMBERS.incrementAndGet();
        long beforeCount = jdbc.queryForObject("select count(*) from trading.trading_account", Long.class);

        mvc.perform(get("/api/v1/trading/portfolios/members/" + unprovisionedMemberId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memberId").value(unprovisionedMemberId))
                .andExpect(jsonPath("$.accountExists").value(false))
                .andExpect(jsonPath("$.roundId").isEmpty())
                .andExpect(jsonPath("$.roundNumber").value(0))
                .andExpect(jsonPath("$.initialSeed").value("10000"))
                .andExpect(jsonPath("$.wallet.balance").value("0"))
                .andExpect(jsonPath("$.wallet.totalEquity").value("0"))
                .andExpect(jsonPath("$.positions.length()").value(0))
                .andExpect(jsonPath("$.symbolPerformances.length()").value(0))
                .andExpect(jsonPath("$.closedTradeSummary.closedPositionCount").value(0));

        assertThat(jdbc.queryForObject("select count(*) from trading.trading_account", Long.class)).isEqualTo(beforeCount);

        // Even if a visitor sends an arbitrary/expired Bearer header, the public endpoint must not reject with 401
        mvc.perform(get("/api/v1/trading/portfolios/members/" + unprovisionedMemberId)
                        .header("Authorization", "Bearer arbitrary-visitor-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountExists").value(false));

        // Invalid memberId = 0 returns 400
        mvc.perform(get("/api/v1/trading/portfolios/members/0"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_HISTORY_REQUEST"));

        // Provision and then withdraw member -> public portfolio returns accountExists = false
        long withdrawnMemberId = MEMBERS.incrementAndGet();
        members.open(withdrawnMemberId);
        withdrawals.withdraw(withdrawnMemberId);

        mvc.perform(get("/api/v1/trading/portfolios/members/" + withdrawnMemberId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memberId").value(withdrawnMemberId))
                .andExpect(jsonPath("$.accountExists").value(false));

        // Bankrupt member mock account -> public portfolio still returns accountExists = true with 0 balance and -100% ROI
        long bankruptMemberId = MEMBERS.incrementAndGet();
        long bankruptAccountId = members.open(bankruptMemberId).accountId();
        jdbc.update("update trading.wallet set balance = 0, realized_pnl = -10000 where account_id = ?", bankruptAccountId);
        jdbc.update("update trading.trading_account set status = 'BANKRUPT' where id = ?", bankruptAccountId);

        mvc.perform(get("/api/v1/trading/portfolios/members/" + bankruptMemberId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memberId").value(bankruptMemberId))
                .andExpect(jsonPath("$.accountExists").value(true))
                .andExpect(jsonPath("$.wallet.balance").value("0"))
                .andExpect(jsonPath("$.wallet.totalEquity").value("0"))
                .andExpect(jsonPath("$.wallet.totalRoiPct").value("-100"));
    }

    @Test
    void publicPortfolioReturnsLiveValuationAllocationsSymbolPerformancesAndClosedTradeSummary() throws Exception {
        long memberId = MEMBERS.incrementAndGet();
        long accountId = members.open(memberId).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc, accountId, btc);
        LegacyLeverageFixtures.bothDirections(jdbc, accountId, eth);

        // 1. Closed winning trade on BTC: open 1 BTC LONG @ 1000, close @ 1100
        var closedBtc = open(accountId, btc, Position.Side.LONG, "1");
        mark(btc, "1100");
        orders.close(accountId, closedBtc.positionId(), key());

        // 2. Closed losing trade on ETH: open 5 ETH LONG @ 200, close @ 190
        var closedEth = open(accountId, eth, Position.Side.LONG, "5");
        mark(eth, "190");
        orders.close(accountId, closedEth.positionId(), key());

        // 3. Open positions: 1 BTC LONG @ 1100 (margin 110) and 5 ETH SHORT @ 190 (margin 95)
        var openBtc = open(accountId, btc, Position.Side.LONG, "1");
        var openEth = open(accountId, eth, Position.Side.SHORT, "5");
        assertThat(openBtc.positionId()).isNotNull();
        assertThat(openEth.positionId()).isNotNull();

        // Update mark prices: BTC -> 1150 (+50 unrealized), ETH -> 180 (+50 unrealized on SHORT 5)
        mark(btc, "1150");
        mark(eth, "180");

        String body = mvc.perform(get("/api/v1/trading/portfolios/members/" + memberId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memberId").value(memberId))
                .andExpect(jsonPath("$.accountExists").value(true))
                .andExpect(jsonPath("$.roundNumber").value(1))
                .andExpect(jsonPath("$.initialSeed").value("10000"))
                .andExpect(jsonPath("$.wallet.priceFresh").value(true))
                .andExpect(jsonPath("$.positions.length()").value(2))
                .andExpect(jsonPath("$.symbolPerformances.length()").value(2))
                .andExpect(jsonPath("$.closedTradeSummary.closedPositionCount").value(2))
                .andExpect(jsonPath("$.closedTradeSummary.winCount").value(1))
                .andExpect(jsonPath("$.closedTradeSummary.lossCount").value(1))
                .andReturn().getResponse().getContentAsString();

        PublicMemberPortfolioResponse response = json.readValue(body, PublicMemberPortfolioResponse.class);
        assertThat(new BigDecimal(response.wallet().unrealizedPnl())).isEqualByComparingTo("100");
        assertThat(new BigDecimal(response.wallet().usedMargin())).isEqualByComparingTo("205");
        assertThat(new BigDecimal(response.allocation().longMarginUsdt())).isEqualByComparingTo("110");
        assertThat(new BigDecimal(response.allocation().shortMarginUsdt())).isEqualByComparingTo("95");
        assertThat(new BigDecimal(response.closedTradeSummary().winRatePct())).isEqualByComparingTo("50");
        assertThat(response.symbolPerformances().get(0).symbol()).isEqualTo("BTC");
    }

    @Test
    void ownerOrderFillPositionAndRoundEndpointsSupportSymbolSubstringAndDateRangeFilters() throws Exception {
        GuestAccountResponse guest = accounts.createGuest();
        long accountId = guest.accountId();
        String bearer = "Bearer " + guest.accessToken();
        LegacyLeverageFixtures.bothDirections(jdbc, accountId, btc);
        LegacyLeverageFixtures.bothDirections(jdbc, accountId, eth);

        var btcOpen = open(accountId, btc, Position.Side.LONG, "1");
        orders.close(accountId, btcOpen.positionId(), key());
        var ethOpen = open(accountId, eth, Position.Side.SHORT, "2");
        orders.close(accountId, ethOpen.positionId(), key());

        Instant t1 = Instant.parse("2026-03-01T10:00:00Z");
        Instant t2 = Instant.parse("2026-03-02T10:00:00Z");
        jdbc.update("update trading.trading_order set created_at=? where account_id=? and trading_symbol_id=?",
                t1.atOffset(ZoneOffset.UTC), accountId, btc);
        jdbc.update("update trading.trading_order set created_at=? where account_id=? and trading_symbol_id=?",
                t2.atOffset(ZoneOffset.UTC), accountId, eth);

        // 1. /api/v1/trading/account/orders symbol & date range filters
        mvc.perform(get("/api/v1/trading/account/orders").header("Authorization", bearer).param("symbol", "btc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].tradingSymbolId").value(btc));

        mvc.perform(get("/api/v1/trading/account/orders").header("Authorization", bearer)
                        .param("createdFrom", t1.toString())
                        .param("createdBefore", t1.plusSeconds(60).toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].tradingSymbolId").value(btc));

        mvc.perform(get("/api/v1/trading/account/orders").header("Authorization", bearer)
                        .param("createdFrom", t2.toString())
                        .param("createdBefore", t1.toString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_HISTORY_REQUEST"));

        // 2. /api/v1/trading/account/fills symbol filter
        mvc.perform(get("/api/v1/trading/account/fills").header("Authorization", bearer).param("symbol", "eth"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].tradingSymbolId").value(eth));

        // 3. /api/v1/trading/account/positions/history symbol filter
        mvc.perform(get("/api/v1/trading/account/positions/history").header("Authorization", bearer).param("symbol", "BTC"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].tradingSymbolId").value(btc));

        // 4. Member round ledger symbol filters
        long memberId = MEMBERS.incrementAndGet();
        long memberAccountId = members.open(memberId).accountId();
        long roundId = rounds.current(memberAccountId).round().roundId();
        LegacyLeverageFixtures.bothDirections(jdbc, memberAccountId, btc);
        LegacyLeverageFixtures.bothDirections(jdbc, memberAccountId, eth);

        var mBtc = open(memberAccountId, btc, Position.Side.LONG, "1");
        orders.close(memberAccountId, mBtc.positionId(), key());
        var mEth = open(memberAccountId, eth, Position.Side.LONG, "1");
        orders.close(memberAccountId, mEth.positionId(), key());

        assertThat(rounds.orders(memberAccountId, roundId, null, 20, "btc").content()).hasSize(2)
                .allMatch(item -> Long.valueOf(btc).equals(item.tradingSymbolId()));
        assertThat(rounds.fills(memberAccountId, roundId, null, 20, "eth").content()).hasSize(2);
        assertThat(rounds.positions(memberAccountId, roundId, null, 20, "btc").content()).hasSize(1)
                .allMatch(item -> Long.valueOf(btc).equals(item.tradingSymbolId()));
    }

    private OrderResponse open(long accountId, long symbolId, Position.Side side, String quantity) {
        return orders.create(accountId, key(), new CreateOrderRequest(
                TradingOrder.Type.MARKET, symbolId, side, new BigDecimal(quantity), 10, null));
    }

    private void mark(long symbolId, String price) {
        Instant now = Instant.now();
        Instant event = prices.find(symbolId).latestPrice().map(LatestMarkPrice::eventTime)
                .filter(p -> !p.isBefore(now)).map(p -> p.plusNanos(1)).orElse(now);
        assertThat(prices.update(new LatestMarkPrice(symbolId, new BigDecimal(price), event, now))).isTrue();
    }

    private static String key() {
        return UUID.randomUUID().toString();
    }
}
