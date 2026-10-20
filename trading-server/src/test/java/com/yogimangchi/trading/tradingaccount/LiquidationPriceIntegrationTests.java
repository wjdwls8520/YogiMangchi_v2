package com.yogimangchi.trading.tradingaccount;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.*;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.*;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
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
class LiquidationPriceIntegrationTests {
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired SymbolLeverageService leverages;
    @Autowired AccountTriggerService trigger;
    @Autowired LatestPriceStore prices;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @MockitoBean TradingEngineGate gate;
    GuestAccountResponse guest;
    long btc,eth;
    @BeforeEach void setup() {
        guest=accounts.createGuest();
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        eth=jdbc.queryForObject("select id from trading.trading_symbol where symbol='ETH'",Long.class);
        prices.beginSubscription(Set.of(btc,eth)); mark(btc,n("1000")); mark(eth,n("100"));
    }
    @AfterEach void cleanup() { prices.markUnavailable(); }

    @ParameterizedTest @EnumSource(Position.Side.class)
    void actualLiquidationWorkerIsSafeOneUlpBeforeAndLiquidatesAtTheReportedThreshold(Position.Side side) {
        leverages.change(guest.accountId(),btc,100);
        var order=open(btc,side,"100");
        var estimate=accounts.summary(guest.accountId()).positions().get(0);
        BigDecimal price=n(estimate.liquidationPrice());
        BigDecimal nearer=price.add(n(side==Position.Side.LONG?"0.000000000000000001":"-0.000000000000000001"));
        var safe=mark(btc,nearer); trigger.process(guest.accountId(),safe,Map.of(btc,safe));
        assertThat(accounts.summary(guest.accountId()).positions()).hasSize(1);
        var risk=mark(btc,price);
        assertThat(accounts.summary(guest.accountId()).positions().get(0).liquidationPriceStatus().name()).isEqualTo("ALREADY_AT_RISK");
        trigger.process(guest.accountId(),risk,Map.of(btc,risk));
        trigger.process(guest.accountId(),risk,Map.of(btc,risk));
        assertThat(accounts.summary(guest.accountId()).positions()).isEmpty();
        assertThat(jdbc.queryForObject("select status from trading.position where id=?",String.class,order.positionId())).isEqualTo("LIQUIDATED");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and action='LIQUIDATE'",Long.class,guest.accountId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select used_margin from trading.wallet where account_id=?",BigDecimal.class,guest.accountId())).isZero();
    }

    @Test void summaryAndPositionRoutesReturnIdenticalFieldsWithoutFinancialWrites() throws Exception {
        open(btc,Position.Side.LONG,"20"); open(btc,Position.Side.SHORT,"5"); open(eth,Position.Side.SHORT,"1");
        var before=ledger();
        var summary=json.readTree(mvc.perform(get("/api/v1/trading/account/summary").header("Authorization",bearer()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var positions=json.readTree(mvc.perform(get("/api/v1/trading/account/positions").header("Authorization",bearer()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(positions).isEqualTo(summary.path("positions"));
        assertThat(positions.get(0).path("liquidationPrice")).isEqualTo(positions.get(1).path("liquidationPrice"));
        assertThat(positions.get(0).path("liquidationPriceStatus").asText()).isEqualTo("ESTIMATED_DOWNWARD");
        assertThat(positions.get(0).path("liquidationPriceAsOf").isTextual()).isTrue();
        assertThat(ledger()).isEqualTo(before);
        mvc.perform(get("/api/v1/trading/account/positions")).andExpect(status().isUnauthorized());
    }

    @Test void leverageAndPendingOpenCloseReservationsDoNotInventChangesToTheRiskThreshold() {
        var opened=open(btc,Position.Side.SHORT,"5");
        var before=accounts.summary(guest.accountId()).positions().get(0).liquidationPrice();
        var pending=orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,n("1"),10,n("990")));
        var close=orders.createLimitClose(guest.accountId(),opened.positionId(),key(),new LimitCloseRequest(n("1"),n("900")));
        for(int leverage:List.of(1,14,100)) {
            leverages.change(guest.accountId(),btc,leverage);
            assertThat(accounts.summary(guest.accountId()).positions().get(0).liquidationPrice()).isEqualTo(before);
        }
        orders.cancel(guest.accountId(),pending.orderId()); orders.cancel(guest.accountId(),close.orderId());
        assertThat(accounts.summary(guest.accountId()).positions().get(0).liquidationPrice()).isEqualTo(before);
    }

    @Test void fillsPartialCloseAndFullCloseImmediatelyAffectTheDerivedResponse() {
        var first=open(btc,Position.Side.LONG,"20");
        var before=accounts.summary(guest.accountId()).positions().get(0).liquidationPrice();
        mark(btc,n("1100")); open(btc,Position.Side.LONG,"5");
        var added=accounts.summary(guest.accountId()).positions().get(0);
        assertThat(added.id()).isEqualTo(first.positionId()); assertThat(added.entryPrice()).isEqualTo("1020.000000000000000000");
        assertThat(added.liquidationPrice()).isNotEqualTo(before);
        orders.close(guest.accountId(),first.positionId(),key(),new ClosePositionRequest(n("5")));
        assertThat(accounts.summary(guest.accountId()).positions().get(0).liquidationPrice()).isNotEqualTo(added.liquidationPrice());
        orders.close(guest.accountId(),first.positionId(),key());
        assertThat(accounts.summary(guest.accountId()).positions()).isEmpty();
    }

    @Test void missingOtherSymbolMarkMakesEveryEstimateNullEvenIfTargetMarkIsFresh() throws Exception {
        open(btc,Position.Side.SHORT,"5"); open(eth,Position.Side.LONG,"1");
        prices.beginSubscription(Set.of(btc,eth)); mark(btc,n("1000"));
        mvc.perform(get("/api/v1/trading/account/positions").header("Authorization",bearer()))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].liquidationPriceStatus").value("PRICE_UNAVAILABLE"))
                .andExpect(jsonPath("$[0].liquidationPrice").isEmpty()).andExpect(jsonPath("$[0].liquidationPriceAsOf").isEmpty())
                .andExpect(jsonPath("$[1].liquidationPriceStatus").value("PRICE_UNAVAILABLE"));
    }

    @Test void generatedOpenApiDocumentsConditionalAccountThresholdAndAllNullReasons() throws Exception {
        var api=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var fields=api.path("components").path("schemas").path("PositionResponse").path("properties");
        assertThat(fields.path("liquidationPrice").path("description").asText()).contains("ACCOUNT","LONG/SHORT","Not a guaranteed execution price");
        assertThat(fields.path("liquidationPriceStatus").path("enum").toString()).contains("ESTIMATED_DOWNWARD","ESTIMATED_UPWARD","PRICE_UNAVAILABLE","NO_THRESHOLD","UNSUPPORTED_MODEL","ALREADY_AT_RISK");
        assertThat(fields.path("liquidationPriceAsOf").path("description").asText()).contains("Oldest server receivedAt");
        assertThat(api.path("paths").path("/api/v1/trading/account/positions").path("get").path("security").isEmpty()).isFalse();
    }

    private OrderResponse open(long symbol,Position.Side side,String quantity) {
        return orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.MARKET,symbol,side,n(quantity),leverages.current(guest.accountId(),symbol),null));
    }
    private LatestMarkPrice mark(long symbol,BigDecimal price) {
        Instant now=Instant.now();
        Instant event=prices.find(symbol).latestPrice().map(LatestMarkPrice::eventTime).filter(previous -> !previous.isBefore(now)).map(previous -> previous.plusNanos(1)).orElse(now);
        var tick=new LatestMarkPrice(symbol,price,event,now); assertThat(prices.update(tick)).isTrue(); return tick;
    }
    private List<Object> ledger() {
        var result=new ArrayList<Object>();
        for(String table:List.of("trading_account","wallet","position","trading_order"))
            result.add(jdbc.queryForList("select * from trading."+table+" where "+(table.equals("trading_account")?"id":"account_id")+"=? order by 1",guest.accountId()));
        result.add(jdbc.queryForList("select f.* from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=? order by f.id",guest.accountId()));
        return result;
    }
    private String bearer() { return "Bearer "+guest.accessToken(); }
    private static String key() { return UUID.randomUUID().toString(); }
    private static BigDecimal n(String value) { return new BigDecimal(value); }
}
