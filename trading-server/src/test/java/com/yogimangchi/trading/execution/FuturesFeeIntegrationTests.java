package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.support.LegacyLeverageFixtures;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.trigger.*;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.service.OrderQuoteService;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
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
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class FuturesFeeIntegrationTests {
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired OrderQuoteService quotes;
    @Autowired SymbolLeverageService leverages;
    @Autowired AccountTriggerService trigger;
    @Autowired LatestPriceStore prices;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @MockitoBean TradingEngineGate gate;
    GuestAccountResponse guest;
    long btc;
    @BeforeEach void setup() {
        guest=accounts.createGuest();
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc)); mark("1000");
        LegacyLeverageFixtures.bothDirections(jdbc,guest.accountId(),btc);
    }
    @AfterEach void cleanup() { prices.markUnavailable(); }

    @ParameterizedTest @EnumSource(Position.Side.class)
    void marketOpenAndPartialFullCloseChargeActualNotionalOnceWithoutChangingGrossPnl(Position.Side side) {
        var opened=open(TradingOrder.Type.MARKET,side,"1",null);
        assertThat(opened.feeRate()).isEqualTo("0.0005");
        assertThat(n(opened.fill().fee())).isEqualByComparingTo("0.5");
        wallet("9999.5","100","0.5","0");
        mark(side==Position.Side.LONG ? "1100" : "900");
        String closeKey=key();
        var partial=orders.close(guest.accountId(),opened.positionId(),closeKey,new ClosePositionRequest(n("0.4")));
        assertThat(n(partial.fill().realizedPnl())).isEqualByComparingTo("40");
        assertThat(n(partial.fill().fee())).isEqualByComparingTo(side==Position.Side.LONG ? "0.22" : "0.18");
        assertThat(orders.close(guest.accountId(),opened.positionId(),closeKey,new ClosePositionRequest(n("0.4")))).isEqualTo(partial);
        var full=orders.close(guest.accountId(),opened.positionId(),key());
        assertThat(n(full.fill().realizedPnl())).isEqualByComparingTo("60");
        wallet(side==Position.Side.LONG ? "10098.95" : "10099.05","0",side==Position.Side.LONG ? "1.05" : "0.95","100");
    }

    @ParameterizedTest @CsvSource({"LONG,990,980,98,0.294", "SHORT,1010,1020,102,0.306"})
    void limitReservesButDoesNotChargeThenUsesActualTriggerNotional(Position.Side side,String limit,String fill,String margin,String fee) {
        var pending=open(TradingOrder.Type.LIMIT,side,"1",limit);
        assertThat(pending.fill()).isNull(); assertThat(pending.feeRate()).isEqualTo("0.0003");
        assertThat(n(pending.reservedFee())).isEqualByComparingTo(side==Position.Side.LONG ? "0.297" : "0.303");
        wallet("10000","0","0","0");
        var tick=mark(fill); trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        var executed=orders.history(guest.accountId(),null,10).get(0);
        assertThat(n(executed.fill().fee())).isEqualByComparingTo(fee);
        assertThat(n(executed.fill().price())).isEqualByComparingTo(fill);
        wallet(n("10000").subtract(n(fee)).toPlainString(),margin,fee,"0");
        assertThat(n(accounts.wallet(guest.accountId()).reservedMargin())).isZero();
        assertThat(orders.history(guest.accountId(),null,10)).hasSize(1);
    }

    @Test void canceledOpenReturnsMarginAndFeeReservationWithoutChargingAnything() {
        var pending=open(TradingOrder.Type.LIMIT,Position.Side.LONG,"1","990");
        assertThat(n(accounts.wallet(guest.accountId()).reservedMargin())).isEqualByComparingTo("99.297");
        orders.cancel(guest.accountId(),pending.orderId()); orders.cancel(guest.accountId(),pending.orderId());
        wallet("10000","0","0","0");
        assertThat(n(accounts.wallet(guest.accountId()).reservedMargin())).isZero();
    }

    @Test void leverageReallocatesOnlyMarginWhilePendingFeeAndHistoricalRatesStayFixed() {
        open(TradingOrder.Type.MARKET,Position.Side.LONG,"1",null);
        var pending=open(TradingOrder.Type.LIMIT,Position.Side.LONG,"1","990");
        leverages.change(guest.accountId(),btc,Position.Side.LONG,20);
        var current=orders.pending(guest.accountId()).get(0);
        assertThat(n(current.reservedMargin())).isEqualByComparingTo("49.797");
        assertThat(n(current.reservedFee())).isEqualByComparingTo("0.297");
        assertThat(current.feeRate()).isEqualTo("0.0003");
        wallet("9999.5","50","0.5","0");
        orders.cancel(guest.accountId(),pending.orderId());
        assertThat(n(accounts.wallet(guest.accountId()).availableBalance())).isEqualByComparingTo("9949.5");
    }

    @Test void limitCloseChargesPointZeroThreePercentAndKeepsOppositePosition() {
        leverages.change(guest.accountId(),btc,Position.Side.LONG,1);
        leverages.change(guest.accountId(),btc,Position.Side.SHORT,1);
        var opened=open(TradingOrder.Type.MARKET,Position.Side.LONG,"1",null);
        open(TradingOrder.Type.MARKET,Position.Side.SHORT,"1",null);
        var pending=orders.createLimitClose(guest.accountId(),opened.positionId(),key(),new LimitCloseRequest(n("0.4"),n("1100")));
        var tick=mark("1110"); trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        var closed=orders.history(guest.accountId(),null,10).stream().filter(o -> o.orderId().equals(pending.orderId())).findFirst().orElseThrow();
        assertThat(n(closed.fill().fee())).isEqualByComparingTo("0.1332");
        assertThat(n(closed.fill().realizedPnl())).isEqualByComparingTo("44");
        wallet("10042.8668","1600","1.1332","44");
        assertThat(accounts.summary(guest.accountId()).positions()).hasSize(2);
    }

    @ParameterizedTest @CsvSource({"MARKET,10", "MARKET,25", "MARKET,50", "MARKET,100", "LIMIT,10", "LIMIT,25", "LIMIT,50", "LIMIT,100"})
    void percentageSizingIncludesRoundedFeeAndIsExecutableAtTheUnchangedPrice(TradingOrder.Type type,int percentage) {
        var request=new OrderQuoteRequest(type,btc,Position.Side.LONG,null,percentage,type==TradingOrder.Type.LIMIT ? n("990") : null);
        var walletBefore=accounts.wallet(guest.accountId());
        var quote=quotes.quote(guest.accountId(),request);
        assertThat(accounts.wallet(guest.accountId())).isEqualTo(walletBefore);
        assertThat(orders.history(guest.accountId(),null,10)).isEmpty();
        BigDecimal budget=n("10000").multiply(BigDecimal.valueOf(percentage)).divide(n("100"));
        assertThat(n(quote.totalRequired())).isLessThanOrEqualTo(budget);
        // The immediately larger quantity exceeds the selected budget, including both CEILING components.
        BigDecimal more=n(quote.quantity()).add(n("0.00000001"));
        BigDecimal moreCost=quote.type().equals("MARKET")
                ? more.multiply(n("1000")).divide(n("10"),18,java.math.RoundingMode.CEILING).add(more.multiply(n("1000")).multiply(n("0.0005")).setScale(18,java.math.RoundingMode.CEILING))
                : more.multiply(n("990")).divide(n("10"),18,java.math.RoundingMode.CEILING).add(more.multiply(n("990")).multiply(n("0.0003")).setScale(18,java.math.RoundingMode.CEILING));
        assertThat(moreCost).isGreaterThan(budget);
        var accepted=orders.create(guest.accountId(),key(),new CreateOrderRequest(type,btc,Position.Side.LONG,n(quote.quantity()),quote.leverage(),request.limitPrice()));
        assertThat(accepted.status()).isEqualTo(type==TradingOrder.Type.MARKET ? "FILLED" : "PENDING");
    }

    @Test void quoteUsesExactRemainingBasisAfterPartialCloseAndHundredTimesSharedLeverage() {
        var opened=open(TradingOrder.Type.MARKET,Position.Side.LONG,"3",null);
        orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(n("1")));
        leverages.change(guest.accountId(),btc,Position.Side.LONG,100);
        var quote=quotes.quote(guest.accountId(),new OrderQuoteRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,null,100,null));
        assertThat(quote.leverage()).isEqualTo(100);
        var accepted=orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,n(quote.quantity()),100,null));
        assertThat(accepted.positionId()).isEqualTo(opened.positionId());
        assertThat(n(accounts.wallet(guest.accountId()).availableBalance())).isGreaterThanOrEqualTo(BigDecimal.ZERO);
    }

    @Test void quotesRequireAuthenticationAndDocumentNonBindingFeeInclusiveServerContract() throws Exception {
        String body="{\"type\":\"MARKET\",\"tradingSymbolId\":"+btc+",\"side\":\"LONG\",\"balancePercentage\":100}";
        mvc.perform(post("/api/v1/trading/account/orders/quote").contentType("application/json").content(body)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/trading/account/orders/quote").header("Authorization","Bearer "+guest.accessToken()).contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.feeRate").value("0.0005")).andExpect(jsonPath("$.quantity").isString());
        var api=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(api.path("paths").path("/api/v1/trading/account/orders/quote").path("post").path("security").isEmpty()).isFalse();
        assertThat(api.path("components").path("schemas").path("OrderQuoteResponse").path("description").asText()).contains("Non-binding","Does not reserve");
    }

    @Test void minimumEntryIsTenUsdtButSmallRemainingExposureCanStillClose() {
        assertThatThrownBy(() -> open(TradingOrder.Type.MARKET,Position.Side.LONG,"0.00999999",null))
                .isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(ErrorCode.INVALID_ORDER));
        var opened=open(TradingOrder.Type.MARKET,Position.Side.LONG,"0.01",null);
        orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(n("0.00999999")));
        orders.close(guest.accountId(),opened.positionId(),key());
        assertThat(accounts.summary(guest.accountId()).positions()).isEmpty();
        wallet("9999.99","0","0.01","0");
    }

    @Test void retainedFeeFreePendingContractBelowTheNewMinimumStillExecutesWithoutRetroactiveCharges() {
        var pending=open(TradingOrder.Type.LIMIT,Position.Side.LONG,"1","990");
        jdbc.update("update trading.trading_order set fee_rate=0,quantity=0.002,reserved_margin=0.198,submitted_margin_mode='CROSS' where id=?",pending.orderId());
        jdbc.update("update trading.wallet set reserved_margin=0.198 where account_id=?",guest.accountId());
        var tick=mark("980"); trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        var executed=orders.history(guest.accountId(),null,10).get(0);
        assertThat(executed.status()).isEqualTo("FILLED");
        assertThat(executed.feeRate()).isEqualTo("0");
        assertThat(n(executed.fill().fee())).isZero();
        wallet("10000","0.196","0","0");
    }

    @Test void quoteRejectsAmbiguousSizingAndUnavailablePriceWithoutFinancialWrites() {
        var before=accounts.wallet(guest.accountId());
        assertThatThrownBy(() -> quotes.quote(guest.accountId(),new OrderQuoteRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,n("1"),100,null)))
                .isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(ErrorCode.INVALID_ORDER));
        prices.markUnavailable();
        assertThatThrownBy(() -> quotes.quote(guest.accountId(),new OrderQuoteRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,null,100,null)))
                .isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(ErrorCode.PRICE_NOT_FRESH));
        assertThat(accounts.wallet(guest.accountId()).balance()).isEqualTo(before.balance());
        assertThat(orders.history(guest.accountId(),null,10)).isEmpty();
    }

    private void wallet(String balance,String margin,String fees,String pnl) {
        var wallet=accounts.wallet(guest.accountId());
        assertThat(n(wallet.balance())).isEqualByComparingTo(balance);
        assertThat(n(wallet.usedMargin())).isEqualByComparingTo(margin);
        assertThat(n(wallet.feesPaid())).isEqualByComparingTo(fees);
        assertThat(n(wallet.realizedPnl())).isEqualByComparingTo(pnl);
    }
    private OrderResponse open(TradingOrder.Type type,Position.Side side,String quantity,String limit) {
        return orders.create(guest.accountId(),key(),new CreateOrderRequest(type,btc,side,n(quantity),leverages.current(guest.accountId(),btc,side),limit==null?null:n(limit)));
    }
    private LatestMarkPrice mark(String amount) {
        Instant now=Instant.now();
        Instant event=prices.find(btc).latestPrice().map(LatestMarkPrice::eventTime).filter(p -> !p.isBefore(now)).map(p -> p.plusNanos(1)).orElse(now);
        var tick=new LatestMarkPrice(btc,n(amount),event,now); assertThat(prices.update(tick)).isTrue(); return tick;
    }
    private static BigDecimal n(String amount) { return new BigDecimal(amount); }
    private static String key() { return UUID.randomUUID().toString(); }
}
