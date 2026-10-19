package com.yogimangchi.trading.execution;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.trigger.*;
import com.yogimangchi.trading.fill.repository.FillRepository;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.*;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"binance.mark-price.enabled=false", "binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class HedgeTradingIntegrationTests {
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired SymbolLeverageService leverages;
    @Autowired AccountTriggerService trigger;
    @Autowired LatestPriceStore prices;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UnusedGuestCleanupService cleanup;
    @MockitoBean TradingEngineGate gate;
    @MockitoSpyBean FillRepository fills;
    GuestAccountResponse guest;
    long btc, eth;
    Map<Long,LatestMarkPrice> book;

    @BeforeEach void setup() {
        guest=accounts.createGuest();
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        eth=jdbc.queryForObject("select id from trading.trading_symbol where symbol='ETH'",Long.class);
        prices.beginSubscription(Set.of(btc,eth)); book=new HashMap<>();
        mark(btc,"1000"); mark(eth,"100");
    }
    @AfterEach void close() { reset(fills); prices.markUnavailable(); }

    @Test void tenAdditionalMarketFillsKeepOnePositionAndSeparateHistory() {
        var first=market(btc,Position.Side.LONG,"0.1");
        for(int i=0;i<10;i++) {
            mark(btc,Integer.toString(1001+i));
            var added=market(btc,Position.Side.LONG,"0.1");
            assertThat(added.positionId()).isEqualTo(first.positionId());
            assertThat(added.quantity()).isEqualTo("0.10000000");
        }
        assertThat(openCount()).isEqualTo(1);
        position(first.positionId(),"quantity","1.1");
        position(first.positionId(),"entry_notional","1105.5");
        position(first.positionId(),"entry_price","1005");
        wallet("used_margin","110.55"); wallet("balance","10000"); wallet("realized_pnl","0");
        assertThat(fillCount()).isEqualTo(11);
        assertThat(orders.history(guest.accountId(),null,100)).hasSize(11);
    }

    @Test void weightedAveragePreservesExactBasisAndPnlThroughRepeatingDivision() {
        mark(btc,"80000"); var first=market(btc,Position.Side.LONG,"0.1");
        mark(btc,"85000"); market(btc,Position.Side.LONG,"0.2");
        position(first.positionId(),"entry_price","83333.333333333333333333");
        position(first.positionId(),"entry_notional","25000");
        wallet("used_margin","2500"); wallet("balance","10000");
        assertThat(accounts.summary(guest.accountId()).wallet().unrealizedPnl()).isEqualTo("500.000000000000000000");
        var closing=orders.close(guest.accountId(),first.positionId(),key());
        assertThat(closing.fill().realizedPnl()).isEqualTo("500.000000000000000000");
        wallet("balance","10500"); wallet("used_margin","0");
    }

    @Test void hedgeDirectionsAndSymbolsNeverNetOrMergeWithEachOther() {
        var longBtc=market(btc,Position.Side.LONG,"1");
        var shortBtc=market(btc,Position.Side.SHORT,"2");
        var longEth=market(eth,Position.Side.LONG,"3");
        assertThat(market(btc,Position.Side.SHORT,"1").positionId()).isEqualTo(shortBtc.positionId());
        assertThat(market(eth,Position.Side.LONG,"1").positionId()).isEqualTo(longEth.positionId());
        position(longBtc.positionId(),"quantity","1"); position(shortBtc.positionId(),"quantity","3");
        assertThat(openCount()).isEqualTo(3); wallet("used_margin","440");
    }

    @ParameterizedTest @ValueSource(ints={1,20,21,100})
    void supportedLeverageExecutesAtTheActualServerSetting(int leverage) {
        leverages.change(guest.accountId(),btc,leverage);
        var order=market(btc,Position.Side.LONG,"1");
        assertThat(order.leverage()).isEqualTo(leverage);
        assertThat(order.requestedLeverage()).isEqualTo(leverage);
        position(order.positionId(),"margin",TradingMath.basisMargin(new BigDecimal("1000"),leverage).toPlainString());
    }

    @Test void invalidAndMismatchedLeverageNeverImplicitlyChangesSetting() {
        for(Integer leverage:Arrays.asList(null,0,-1,101)) rejects(() -> leverages.change(guest.accountId(),btc,leverage),ErrorCode.INVALID_LEVERAGE);
        rejects(() -> orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,14,null)),ErrorCode.LEVERAGE_MISMATCH);
        assertThat(leverages.get(guest.accountId(),btc).leverage()).isEqualTo(10);
        assertThat(openCount()).isZero(); wallet("used_margin","0");
    }

    @Test void sharedLeverageReleasesBothDirectionsMarginWithoutChangingFinancialHistory() {
        var longOrder=market(btc,Position.Side.LONG,"2");
        market(btc,Position.Side.SHORT,"1"); market(eth,Position.Side.LONG,"1");
        orders.close(guest.accountId(),longOrder.positionId(),key(),new ClosePositionRequest(new BigDecimal("0.5")));
        var positionsBefore=jdbc.queryForList("select id,quantity,entry_price,entry_notional,realized_pnl,reserved_close_quantity from trading.position where account_id=? order by id",guest.accountId());
        var historyBefore=orders.history(guest.accountId(),null,100);
        var changed=leverages.change(guest.accountId(),btc,14);
        BigDecimal expected=TradingMath.basisMargin(new BigDecimal("1500"),14).add(TradingMath.basisMargin(new BigDecimal("1000"),14)).add(new BigDecimal("10"));
        wallet("used_margin",expected.toPlainString());
        assertThat(jdbc.queryForList("select id,quantity,entry_price,entry_notional,realized_pnl,reserved_close_quantity from trading.position where account_id=? order by id",guest.accountId())).isEqualTo(positionsBefore);
        assertThat(orders.history(guest.accountId(),null,100)).isEqualTo(historyBefore);
        assertThat(leverages.change(guest.accountId(),btc,14)).isEqualTo(changed);
        assertThat(leverages.get(guest.accountId(),eth).leverage()).isEqualTo(10);
        assertThat(accounts.summary(guest.accountId()).positions().stream().filter(p -> p.tradingSymbolId()==btc))
                .allMatch(p -> p.leverage()==14);
        assertThat(new BigDecimal(accounts.summary(guest.accountId()).wallet().availableBalance())).isEqualByComparingTo(new BigDecimal("10000").subtract(expected));
    }

    @Test void leverageDecreaseRollsBackPositionsOrdersWalletAndSettingTogether() {
        leverages.change(guest.accountId(),btc,100);
        market(btc,Position.Side.LONG,"500");
        limit(Position.Side.SHORT,"100","1010");
        var before=financialSnapshot();
        rejects(() -> leverages.change(guest.accountId(),btc,1),ErrorCode.INSUFFICIENT_MARGIN);
        assertThat(financialSnapshot()).isEqualTo(before);
        assertThat(leverages.get(guest.accountId(),btc).leverage()).isEqualTo(100);
    }

    @Test void pendingOpenRepricingPreservesRequestedLeverageAndCloseReservations() {
        var opened=market(btc,Position.Side.LONG,"1");
        var close=orders.createLimitClose(guest.accountId(),opened.positionId(),key(),new LimitCloseRequest(new BigDecimal("0.2"),new BigDecimal("1100")));
        var buy=limit(Position.Side.LONG,"1","990");
        var sell=limit(Position.Side.SHORT,"1","1010");
        leverages.change(guest.accountId(),btc,20);
        wallet("used_margin","50"); wallet("reserved_margin","100");
        position(opened.positionId(),"reserved_close_quantity","0.2");
        assertThat(orders.pending(guest.accountId()).stream().filter(o -> o.action().equals("OPEN")))
                .allMatch(o -> o.leverage()==20 && o.requestedLeverage()==10);
        process("980"); process("1020");
        var history=orders.history(guest.accountId(),null,100);
        assertThat(history.stream().filter(o -> Set.of(buy.orderId(),sell.orderId()).contains(o.orderId())))
                .allMatch(o -> o.leverage()==20 && o.requestedLeverage()==10 && o.status().equals("FILLED"));
        assertThat(openCount()).isEqualTo(2); wallet("reserved_margin","0"); wallet("used_margin","150");
        position(opened.positionId(),"quantity","2"); position(opened.positionId(),"reserved_close_quantity","0.2");
        orders.cancel(guest.accountId(),close.orderId()); position(opened.positionId(),"reserved_close_quantity","0");
    }

    @Test void threeSequentialLimitFillsMergeWithMarketPositionAndTickReplayIsIdempotent() {
        var opened=market(btc,Position.Side.LONG,"1");
        limit(Position.Side.LONG,"1","990"); limit(Position.Side.LONG,"1","980"); limit(Position.Side.LONG,"1","970");
        process("989"); process("979"); LatestMarkPrice last=process("969");
        trigger.process(guest.accountId(),last,Map.copyOf(book));
        assertThat(openCount()).isEqualTo(1); assertThat(fillCount()).isEqualTo(4);
        position(opened.positionId(),"quantity","4"); position(opened.positionId(),"entry_notional","3937");
        wallet("reserved_margin","0"); wallet("used_margin","393.7");
    }

    @ParameterizedTest @ValueSource(strings={"0.25","0.5","1"})
    void partialAndFullClosesSettleIntegratedPosition(String quantity) {
        var opened=market(btc,Position.Side.LONG,"0.4"); market(btc,Position.Side.LONG,"0.6");
        mark(btc,"1100");
        var result=orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(new BigDecimal(quantity)));
        wallet("balance",new BigDecimal("10000").add(new BigDecimal(quantity).multiply(new BigDecimal("100"))).toPlainString());
        wallet("used_margin",BigDecimal.ONE.subtract(new BigDecimal(quantity)).multiply(new BigDecimal("100")).toPlainString());
        assertThat(result.positionId()).isEqualTo(opened.positionId());
        position(opened.positionId(),"entry_price","1000");
    }

    @Test void partialCloseThenAdditionalFillKeepsPnlAndReservationAndStartsNewIdOnlyAfterFullClose() {
        var opened=market(btc,Position.Side.LONG,"1");
        mark(btc,"1100"); orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(new BigDecimal("0.4")));
        var close=orders.createLimitClose(guest.accountId(),opened.positionId(),key(),new LimitCloseRequest(new BigDecimal("0.2"),new BigDecimal("1200")));
        market(btc,Position.Side.LONG,"0.4");
        position(opened.positionId(),"quantity","1"); position(opened.positionId(),"realized_pnl","40");
        position(opened.positionId(),"entry_price","1040"); position(opened.positionId(),"reserved_close_quantity","0.2");
        assertThat(accounts.summary(guest.accountId()).positions().get(0).freeCloseQuantity()).isEqualTo("0.80000000");
        rejects(() -> orders.close(guest.accountId(),opened.positionId(),key()),ErrorCode.CLOSE_QUANTITY_EXCEEDED);
        process("1200");
        assertThat(orders.history(guest.accountId(),null,100).stream().filter(o -> o.orderId().equals(close.orderId())).findFirst().orElseThrow().status()).isEqualTo("FILLED");
        position(opened.positionId(),"reserved_close_quantity","0"); position(opened.positionId(),"quantity","0.8");
        orders.close(guest.accountId(),opened.positionId(),key());
        assertThat(market(btc,Position.Side.LONG,"1").positionId()).isNotEqualTo(opened.positionId());
    }

    @Test void sameIdempotencyKeyCannotIncreaseTwiceEvenAfterLeverageChangesAndPriceLoss() {
        String key=key();
        var request=new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,new BigDecimal("1"),10,null);
        var first=orders.create(guest.accountId(),key,request);
        leverages.change(guest.accountId(),btc,20); prices.markUnavailable();
        assertThat(orders.create(guest.accountId(),key,request)).isEqualTo(first);
        position(first.positionId(),"quantity","1"); assertThat(fillCount()).isEqualTo(1);
    }

    @Test void simultaneousMarketOrdersKeepDatabaseUniquenessAndExactQuantity() throws Exception {
        race(() -> market(btc,Position.Side.LONG,"1"),() -> market(btc,Position.Side.LONG,"2"));
        assertThat(openCount()).isEqualTo(1); assertThat(fillCount()).isEqualTo(2); wallet("used_margin","300");
        assertThat(accounts.summary(guest.accountId()).positions().get(0).quantity()).isEqualTo("3.00000000");
    }

    @Test void marketAndLimitTriggerRaceUseSameAggregate() throws Exception {
        limit(Position.Side.LONG,"1","990"); var tick=mark(btc,"980");
        race(() -> market(btc,Position.Side.LONG,"1"),() -> trigger.process(guest.accountId(),tick,Map.copyOf(book)));
        assertThat(openCount()).isEqualTo(1); assertThat(fillCount()).isEqualTo(2); wallet("used_margin","196"); wallet("reserved_margin","0");
    }

    @Test void leverageAndLimitFillRaceLeavesConsistentEffectiveMargin() throws Exception {
        limit(Position.Side.LONG,"1","990"); var tick=mark(btc,"980");
        race(() -> leverages.change(guest.accountId(),btc,20),() -> trigger.process(guest.accountId(),tick,Map.copyOf(book)));
        wallet("used_margin","49"); wallet("reserved_margin","0");
        assertThat(accounts.summary(guest.accountId()).positions().get(0).leverage()).isEqualTo(20);
        assertThat(fillCount()).isEqualTo(1);
    }

    @Test void fixedQuantityCloseAndAdditionalFillRacePreservesBothChanges() throws Exception {
        var first=market(btc,Position.Side.LONG,"1");
        race(() -> orders.close(guest.accountId(),first.positionId(),key(),new ClosePositionRequest(new BigDecimal("0.5"))),
                () -> market(btc,Position.Side.LONG,"0.5"));
        position(first.positionId(),"quantity","1"); assertThat(openCount()).isEqualTo(1); wallet("used_margin","100"); assertThat(fillCount()).isEqualTo(3);
    }

    @Test void fillFailureRollsBackAggregateBasisQuantityAndMargin() {
        var first=market(btc,Position.Side.LONG,"1"); var before=financialSnapshot();
        doThrow(new IllegalStateException("injected fill failure")).when(fills).save(any());
        assertThatThrownBy(() -> market(btc,Position.Side.LONG,"1")).isInstanceOf(IllegalStateException.class);
        assertThat(financialSnapshot()).isEqualTo(before); position(first.positionId(),"entry_notional","1000");
    }

    @Test void databaseRejectsDuplicateOpenButAllowsClosedLifecycleAndOppositeSide() {
        market(btc,Position.Side.LONG,"1");
        assertThatThrownBy(() -> jdbc.update("insert into trading.position(account_id,trading_symbol_id,side,quantity,initial_quantity,reserved_close_quantity,entry_price,entry_notional,leverage,margin,initial_margin,status,realized_pnl,opened_at) values (?,?,'LONG',1,1,0,1000,1000,10,100,100,'OPEN',0,now())",guest.accountId(),btc))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        market(btc,Position.Side.SHORT,"1"); assertThat(openCount()).isEqualTo(2);
    }

    @Test void hundredTimesLeverageLiquidatesAtGrossMaintenanceAndReleasesAllReservations() {
        leverages.change(guest.accountId(),btc,100);
        var longOrder=market(btc,Position.Side.LONG,"590");
        market(btc,Position.Side.SHORT,"390");
        limit(Position.Side.LONG,"0.1","990");
        orders.createLimitClose(guest.accountId(),longOrder.positionId(),key(),new LimitCloseRequest(new BigDecimal("0.1"),new BigDecimal("1100")));
        LatestMarkPrice tick=process("999"); // equity=9800, gross maintenance=4895.1: still solvent.
        assertThat(openCount()).isEqualTo(2);
        tick=process("970"); // equity=4000 <= 4753 despite the hedge; both directions liquidate.
        trigger.process(guest.accountId(),tick,Map.copyOf(book));
        assertThat(openCount()).isZero(); wallet("used_margin","0"); wallet("reserved_margin","0"); wallet("balance","4000");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and action='LIQUIDATE'",Long.class,guest.accountId())).isEqualTo(2);
        assertThat(orders.pending(guest.accountId())).isEmpty(); assertThat(fillCount()).isEqualTo(4);
    }

    @Test void leverageChangeAndLiquidationRaceCannotDuplicateOrResurrectExposure() throws Exception {
        leverages.change(guest.accountId(),btc,100); market(btc,Position.Side.LONG,"900");
        var tick=mark(btc,"990");
        race(() -> { try { leverages.change(guest.accountId(),btc,50); } catch(BusinessException e) { assertThat(e.getCode()).isIn(ErrorCode.ACCOUNT_AT_RISK,ErrorCode.ACCOUNT_NOT_ACTIVE); } },
                () -> trigger.process(guest.accountId(),tick,Map.copyOf(book)));
        assertThat(openCount()).isZero(); wallet("used_margin","0"); assertThat(fillCount()).isEqualTo(2);
    }

    @Test void staleMarksPreventLeverageChangesAndLimitFill() {
        var first=market(btc,Position.Side.LONG,"1"); limit(Position.Side.LONG,"1","990");
        var before=financialSnapshot(); prices.markUnavailable();
        rejects(() -> leverages.change(guest.accountId(),btc,20),ErrorCode.PRICE_NOT_FRESH);
        Instant old=Instant.now().minusSeconds(10); var tick=new LatestMarkPrice(btc,new BigDecimal("980"),old,old);
        trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        assertThat(financialSnapshot()).isEqualTo(before); position(first.positionId(),"quantity","1");
    }

    @Test void missingOtherHeldSymbolPriceBlocksLeverageChangeEvenWhenTargetIsFresh() {
        market(btc,Position.Side.LONG,"1"); market(eth,Position.Side.LONG,"1");
        var before=financialSnapshot();
        prices.beginSubscription(Set.of(btc,eth)); mark(btc,"1000");
        rejects(() -> leverages.change(guest.accountId(),btc,20),ErrorCode.PRICE_NOT_FRESH);
        assertThat(financialSnapshot()).isEqualTo(before);
    }

    @Test void positionNotionalLimitRejectsOnlyOverLimitPendingFillAndReleasesItsMargin() {
        leverages.change(guest.accountId(),btc,100);
        var profit=market(btc,Position.Side.LONG,"1"); mark(btc,"1100");
        orders.close(guest.accountId(),profit.positionId(),key()); mark(btc,"1000");
        market(btc,Position.Side.LONG,"999");
        var pending=limit(Position.Side.LONG,"1.02","999");
        process("999");
        assertThat(orders.history(guest.accountId(),null,100).stream().filter(o -> o.orderId().equals(pending.orderId())).findFirst().orElseThrow().status()).isEqualTo("REJECTED");
        wallet("reserved_margin","0"); wallet("used_margin","9990");
        assertThat(fillCount()).isEqualTo(3); assertThat(openCount()).isEqualTo(1);
    }

    @Test void symbolSettingsAreRemovedWithOnlyAnExpiredUnusedGuest() {
        leverages.change(guest.accountId(),btc,20);
        jdbc.update("update trading.trading_account set credential_expires_at=now()-interval '8 days' where id=?",guest.accountId());
        cleanup.cleanupBatch();
        assertThat(jdbc.queryForObject("select count(*) from trading.symbol_leverage where account_id=?",Long.class,guest.accountId())).isZero();
    }

    @Test void authenticatedApiPersistsSettingsAndRejectsFractionalLeverageAndUnknownSymbols() throws Exception {
        String path="/api/v1/trading/account/symbols/"+btc+"/leverage";
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(put(path).contentType("application/json").content("{\"leverage\":14}")).andExpect(status().isUnauthorized());
        mvc.perform(get(path).header("Authorization",bearer())).andExpect(status().isOk()).andExpect(jsonPath("$.leverage").value(10));
        assertThat(jdbc.queryForObject("select count(*) from trading.symbol_leverage where account_id=?",Long.class,guest.accountId())).isZero();
        mvc.perform(put(path).header("Authorization",bearer()).contentType("application/json").content("{\"leverage\":14}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.marginMode").value("CROSS")).andExpect(jsonPath("$.maxLeverage").value(100));
        mvc.perform(get(path).header("Authorization",bearer())).andExpect(jsonPath("$.leverage").value(14));
        for(String invalid:List.of("101","0","14.5","\"14\"","null"))
            mvc.perform(put(path).header("Authorization",bearer()).contentType("application/json").content("{\"leverage\":"+invalid+"}"))
                    .andExpect(status().isBadRequest());
        var other=accounts.createGuest();
        mvc.perform(get(path).header("Authorization","Bearer "+other.accessToken())).andExpect(jsonPath("$.leverage").value(10));
        mvc.perform(get("/api/v1/trading/account/symbols/999999/leverage").header("Authorization",bearer()))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SYMBOL_NOT_AVAILABLE"));
        jdbc.update("update trading.trading_account set credential_expires_at=now()-interval '1 day' where id=?",guest.accountId());
        mvc.perform(get(path).header("Authorization",bearer())).andExpect(status().isUnauthorized());
    }

    @Test void runtimeOpenApiExplainsLeverageAndIntegratedPositionContracts() throws Exception {
        var document=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var path=document.path("paths").path("/api/v1/trading/account/symbols/{symbolId}/leverage");
        assertThat(path.path("put").path("security").isEmpty()).isFalse();
        assertThat(path.path("put").path("description").asText()).contains("PENDING OPEN","INSUFFICIENT_MARGIN","PRICE_NOT_FRESH");
        assertThat(document.path("components").path("schemas").path("CreateOrderRequest").path("properties").path("leverage").path("maximum").asInt()).isEqualTo(100);
        assertThat(document.path("components").path("schemas").path("PositionResponse").path("description").asText()).contains("Hedge Mode","weighted average");
    }

    private OrderResponse market(long symbol,Position.Side side,String quantity) {
        return orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.MARKET,symbol,side,new BigDecimal(quantity),leverages.current(guest.accountId(),symbol),null));
    }
    private OrderResponse limit(Position.Side side,String quantity,String limit) {
        return orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,side,new BigDecimal(quantity),leverages.current(guest.accountId(),btc),new BigDecimal(limit)));
    }
    private LatestMarkPrice mark(long symbol,String value) {
        Instant now=Instant.now();
        Instant event=prices.find(symbol).latestPrice().map(LatestMarkPrice::eventTime)
                .filter(previous -> !previous.isBefore(now)).map(previous -> previous.plusNanos(1)).orElse(now);
        var tick=new LatestMarkPrice(symbol,new BigDecimal(value),event,now);
        assertThat(prices.update(tick)).isTrue(); book.put(symbol,tick); return tick;
    }
    private LatestMarkPrice process(String value) { var tick=mark(btc,value); trigger.process(guest.accountId(),tick,Map.copyOf(book)); return tick; }
    private long openCount() { return jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='OPEN'",Long.class,guest.accountId()); }
    private long fillCount() { return jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,guest.accountId()); }
    private void wallet(String column,String value) { assertThat(jdbc.queryForObject("select "+column+" from trading.wallet where account_id=?",BigDecimal.class,guest.accountId())).isEqualByComparingTo(value); }
    private void position(long id,String column,String value) { assertThat(jdbc.queryForObject("select "+column+" from trading.position where id=?",BigDecimal.class,id)).isEqualByComparingTo(value); }
    private List<Object> financialSnapshot() { return List.of(jdbc.queryForList("select * from trading.wallet where account_id=?",guest.accountId()),jdbc.queryForList("select * from trading.position where account_id=? order by id",guest.accountId()),orders.history(guest.accountId(),null,100)); }
    private static void rejects(Runnable action,ErrorCode code) { assertThatThrownBy(action::run).isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(code)); }
    private static String key() { return UUID.randomUUID().toString(); }
    private String bearer() { return "Bearer "+guest.accessToken(); }
    private static void race(Runnable first,Runnable second) throws Exception {
        var pool=Executors.newFixedThreadPool(2); var start=new CountDownLatch(1);
        try {
            var tasks=new ArrayList<Future<?>>();
            for(var action:List.of(first,second)) tasks.add(pool.submit(() -> { try { start.await(); action.run(); } catch(InterruptedException e) { throw new RuntimeException(e); } }));
            start.countDown(); for(var task:tasks) task.get(15,TimeUnit.SECONDS);
        } finally { pool.shutdownNow(); }
    }
}
