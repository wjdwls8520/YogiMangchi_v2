package com.yogimangchi.trading.performance;

import com.yogimangchi.trading.support.LegacyLeverageFixtures;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.*;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.*;
import com.yogimangchi.trading.tradinground.MemberRounds;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class) @AutoConfigureMockMvc
class SymbolPerformanceIntegrationTests {
    static final AtomicLong MEMBERS=new AtomicLong(8100000);
    @Autowired SymbolPerformanceService performance;
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired LatestPriceStore prices;
    @Autowired AccountTriggerService trigger;
    @Autowired GuestRetryService retries;
    @Autowired MemberAccounts members;
    @Autowired MemberRounds rounds;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @MockitoBean TradingEngineGate gate;
    GuestAccountResponse guest;long btc,eth;
    @BeforeEach void setup() {
        guest=accounts.createGuest();
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        eth=jdbc.queryForObject("select id from trading.trading_symbol where symbol='ETH'",Long.class);
        prices.beginSubscription(Set.of(btc,eth));mark(btc,"1000");mark(eth,"100");
    }
    @AfterEach void cleanup(){prices.markUnavailable();}
    @Test void combinesBothDirectionsAndExecutionLegsSeparatingGrossFeesAndCash() {
        var l=open(guest.accountId(),btc,Position.Side.LONG,"1");
        var s=open(guest.accountId(),btc,Position.Side.SHORT,"2");
        open(guest.accountId(),eth,Position.Side.LONG,"1");
        mark(btc,"1010");orders.close(guest.accountId(),l.positionId(),key());
        orders.close(guest.accountId(),s.positionId(),key(),new ClosePositionRequest(n("1")));
        var p=performance.aggregate(guest.accountId(),null,null,null,null);
        assertThat(p.totals().fillCount()).isEqualTo(5);
        eq(p.totals().turnover(),"5120");eq(p.totals().grossRealizedPnl(),"0");eq(p.totals().fees(),"2.56");
        eq(p.totals().economicTradingPnl(),"-2.56");eq(p.totals().cashTradingPnl(),"-2.56");
        var b=p.symbols().stream().filter(x -> x.tradingSymbolId()==btc).findFirst().orElseThrow();
        eq(b.turnover(),"5020");eq(b.currentUnrealizedPnl(),"-10");assertThat(b.priceEventTime()).isNotNull();
        assertThat(p.roundReturn()).isNull();
    }
    @Test void includesWholeRangeBeyondOneHistoryPageAndHonorsExclusiveBoundary() {
        for(int i=0;i<105;i++)open(guest.accountId(),btc,Position.Side.LONG,"0.01");
        Instant boundary=Instant.parse("2026-01-02T00:00:00Z");
        jdbc.update("update trading.fill f set executed_at=? from trading.trading_order o where o.id=f.order_id and o.account_id=?",boundary.atOffset(ZoneOffset.UTC),guest.accountId());
        assertThat(performance.aggregate(guest.accountId(),boundary,boundary.plusSeconds(1),null,btc).totals().fillCount()).isEqualTo(105);
        assertThat(performance.aggregate(guest.accountId(),boundary.minusSeconds(1),boundary,null,null).totals().fillCount()).isZero();
    }
    @Test void pendingCanceledAndAdministrativeRetirementAreNotTurnoverOrPnlAndFundingIsSeparate() {
        open(guest.accountId(),btc,Position.Side.LONG,"1");
        var pending=orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,n("1"),10,n("990")));
        orders.cancel(guest.accountId(),pending.orderId());
        retries.retry(guest.accountId(),key());
        var p=performance.aggregate(guest.accountId(),null,null,null,null);
        assertThat(p.totals().fillCount()).isEqualTo(1);eq(p.totals().turnover(),"1000");eq(p.totals().grossRealizedPnl(),"0");
        eq(p.capitalAdjustment(),"0.5");eq(p.totals().cashTradingPnl(),"-0.5");eq(p.symbols().get(0).currentUnrealizedPnl(),"0");
    }
    @Test void actualLiquidationIncludesNotionalGrossLossAndSeparatePlatformAdjustment() {
        open(guest.accountId(),btc,Position.Side.LONG,"1");
        var tick=mark(btc,"100");trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        var p=performance.aggregate(guest.accountId(),null,null,null,btc);
        assertThat(p.totals().fillCount()).isEqualTo(2);eq(p.totals().turnover(),"1100");eq(p.totals().grossRealizedPnl(),"-900");
        eq(p.totals().fees(),"0.55");eq(p.totals().settlementAdjustment(),"800.05");eq(p.totals().economicTradingPnl(),"-900.55");eq(p.totals().cashTradingPnl(),"-100.5");
    }
    @Test void currentExposureHasSeparateValuationEvenOutsideHistoricalRangeAndUnavailableIsNull() {
        open(guest.accountId(),btc,Position.Side.LONG,"1");mark(btc,"1010");
        var p=performance.aggregate(guest.accountId(),Instant.EPOCH,Instant.parse("2020-01-01T00:00:00Z"),null,null);
        assertThat(p.totals().fillCount()).isZero();eq(p.symbols().get(0).currentUnrealizedPnl(),"10");
        prices.markUnavailable();p=performance.aggregate(guest.accountId(),null,null,null,null);
        assertThat(p.symbols().get(0).currentUnrealizedPnl()).isNull();assertThat(p.symbols().get(0).valuationStatus()).isEqualTo("UNAVAILABLE");
    }
    @Test void memberRoundOwnershipFundingAndReturnsDoNotIncludePreviousRoundOrRestartGrant() {
        long id=members.open(MEMBERS.incrementAndGet()).accountId();long round=rounds.current(id).round().roundId();
        var opened=open(id,btc,Position.Side.LONG,"1");mark(btc,"1010");orders.close(id,opened.positionId(),key());
        var p=performance.aggregate(id,null,null,round,null);
        eq(p.roundReturn().initialCapital(),"10000");eq(p.roundReturn().cashPerformance(),"8.995");eq(p.roundReturn().returnPercent(),"0.08995");
        var next=rounds.restart(id,key());
        p=performance.aggregate(id,null,null,round,null);assertThat(p.roundReturn().status()).isEqualTo("FINAL");eq(p.roundReturn().cashPerformance(),"8.995");
        var current=performance.aggregate(id,null,null,next.roundId(),null);assertThat(current.totals().fillCount()).isZero();eq(current.roundReturn().returnPercent(),"0");eq(current.capitalAdjustment(),"-8.995");
        assertThatThrownBy(() -> performance.aggregate(guest.accountId(),null,null,round,null)).isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(ErrorCode.ROUND_NOT_FOUND));
        assertThat(performance.aggregate(id,null,null,round,btc).roundReturn()).isNull();
    }
    @Test void legacyRoundFundingRemainsUnknownRatherThanInvented() {
        long id=members.open(MEMBERS.incrementAndGet()).accountId();long round=rounds.current(id).round().roundId();
        jdbc.update("update trading.member_trading_round set funding='LEGACY_UNVERIFIED',initial_balance=null where id=?",round);
        var p=performance.aggregate(id,null,null,round,null);
        assertThat(p.roundReturn().status()).isEqualTo("LEGACY_UNVERIFIED");
        assertThat(p.roundReturn().initialCapital()).isNull();assertThat(p.roundReturn().returnPercent()).isNull();
    }

    @Test void representativeAggregateHasMeasuredPlanAndExactWholeRangeWithoutDuplicateFacts() {
        for(int i=0;i<120;i++)open(guest.accountId(),btc,i%2==0?Position.Side.LONG:Position.Side.SHORT,"0.01");
        long maxNanos=0;
        for(int i=0;i<10;i++) {
            long start=System.nanoTime();var p=performance.aggregate(guest.accountId(),null,null,null,null);
            maxNanos=Math.max(maxNanos,System.nanoTime()-start);
            assertThat(p.totals().fillCount()).isEqualTo(120);eq(p.totals().turnover(),"1200");
        }
        var plan=jdbc.queryForObject("explain (analyze,buffers,format json) select o.trading_symbol_id,count(*),sum(f.price*f.quantity),sum(f.realized_pnl),sum(f.fee),sum(f.settlement_adjustment) from trading.trading_order o join trading.fill f on f.order_id=o.id where o.account_id=? and f.executed_at>=? and f.executed_at<? and o.status='FILLED' and o.action in ('OPEN','CLOSE','LIQUIDATE') group by o.trading_symbol_id",String.class,guest.accountId(),Instant.EPOCH.atOffset(ZoneOffset.UTC),Instant.now().atOffset(ZoneOffset.UTC));
        System.out.println("PERFORMANCE_MEASUREMENT rows=120 rounds=10 maxAggregateMs="+maxNanos/1_000_000.0+" plan="+plan);
        assertThat(plan).contains("Actual Rows","Shared Hit Blocks");
    }

    @Test void authenticatedHttpUsesOnlyOwnAccountAndDocumentsContract() throws Exception {
        var other=accounts.createGuest();open(other.accountId(),btc,Position.Side.LONG,"1");
        String path="/api/v1/trading/account/performance/symbols";
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(get(path).header("Authorization","Bearer "+guest.accessToken())).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control","no-store")).andExpect(jsonPath("$.totals.fillCount").value(0));
        mvc.perform(get(path).param("tradingSymbolId","-1").header("Authorization","Bearer "+guest.accessToken())).andExpect(status().isBadRequest());
        mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andExpect(jsonPath("$.paths['"+path+"'].get.description").exists());
    }
    private OrderResponse open(long account,long symbol,Position.Side side,String quantity) {
        LegacyLeverageFixtures.tenTimes(jdbc,account,symbol,side);

        return orders.create(account,key(),new CreateOrderRequest(TradingOrder.Type.MARKET,symbol,side,n(quantity),10,null));
    }
    private LatestMarkPrice mark(long symbol,String amount) {
        Instant now=Instant.now();var tick=new LatestMarkPrice(symbol,n(amount),now,now);assertThat(prices.update(tick)).isTrue();return tick;
    }
    private static void eq(String actual,String expected){assertThat(n(actual)).isEqualByComparingTo(expected);}
    private static BigDecimal n(String v){return new BigDecimal(v);}
    private static String key(){return UUID.randomUUID().toString();}
}
