package com.yogimangchi.trading.tradehistory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.*;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradehistory.service.TradeHistoryService;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class TradeHistoryIntegrationTests {
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired TradeHistoryService history;
    @Autowired SymbolLeverageService leverage;
    @Autowired AccountTriggerService trigger;
    @Autowired LatestPriceStore prices;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;
    @Autowired ObjectMapper json;
    @Autowired MockMvc mvc;
    @MockitoBean TradingEngineGate gate;
    @MockitoSpyBean TradingEvents events;
    GuestAccountResponse guest;
    long btc;
    @BeforeEach void setup() {
        guest=accounts.createGuest();
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc)); mark("1000");
    }
    @AfterEach void cleanup() { reset(events); events.unwatch(guest.accountId()); prices.markUnavailable(); }

    @Test void oneIntegratedLifecycleKeepsEveryFillAndSeparatesGrossFeeAndNet() {
        var opened=open("1"); mark("1100"); open("1"); mark("1150");
        orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(n("0.5")));
        mark("1200"); orders.close(guest.accountId(),opened.positionId(),key());
        var page=history.closed(guest.accountId(),null,50,null,null,null,null,null);
        assertThat(page.items()).hasSize(1); assertThat(page.nextCursor()).isNull();
        var closed=page.items().get(0);
        assertThat(closed.positionId()).isEqualTo(opened.positionId());
        assertThat(n(closed.initialQuantity())).isEqualByComparingTo("2");
        assertThat(n(closed.entryPrice())).isEqualByComparingTo("1050");
        assertThat(n(closed.exitPrice())).isEqualByComparingTo("1200");
        assertThat(n(closed.realizedPnl())).isEqualByComparingTo("275");
        assertThat(n(closed.feesPaid())).isEqualByComparingTo("2.2375");
        assertThat(n(closed.netRealizedPnl())).isEqualByComparingTo("272.7625");
        var first=fills(null,2); var second=fills(first.get(1).fillId(),2);
        assertThat(first).hasSize(2); assertThat(second).hasSize(2);
        assertThat(first.stream().map(f -> f.action()).toList()).containsOnly("CLOSE");
        assertThat(second.stream().map(f -> f.action()).toList()).containsOnly("OPEN");
        assertThat(fills(second.get(1).fillId(),2)).isEmpty();
        assertThat(n(accounts.wallet(guest.accountId()).balance())).isEqualByComparingTo("10272.7625");
    }

    @Test void closedHistoryOrdersByClosureTimeAndUsesIdToBreakTimestampTies() {
        var older=open("1");
        var newer=orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.SHORT,n("1"),10,null));
        orders.close(guest.accountId(),newer.positionId(),key());
        orders.close(guest.accountId(),older.positionId(),key());
        assertThat(history.closed(guest.accountId(),null,50,null,null,null,null,null).items().get(0).positionId()).isEqualTo(older.positionId());
        jdbc.update("update trading.position set closed_at=timestamp with time zone '2026-10-21 10:00:00+00' where account_id=?",guest.accountId());
        var first=history.closed(guest.accountId(),null,1,null,null,null,null,null);
        var second=history.closed(guest.accountId(),first.nextCursor(),1,null,null,null,null,null);
        assertThat(first.items().get(0).positionId()).isEqualTo(newer.positionId());
        assertThat(second.items().get(0).positionId()).isEqualTo(older.positionId());
        assertThat(second.nextCursor()).isNull();
        open("1"); // A new OPEN lifecycle must never appear as a closed position.
        assertThat(history.closed(guest.accountId(),null,50,null,null,null,null,null).items()).hasSize(2);
    }

    @Test void committedEventSnapshotsAreImmutableAndDuplicateTriggersDoNotCreateAnotherEvent() {
        var pending=orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,n("1"),10,n("990")));
        leverage.change(guest.accountId(),btc,Position.Side.LONG,20);
        var tick=mark("980"); trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        trigger.process(guest.accountId(),tick,Map.of(btc,tick));
        var retained=events.after(guest.accountId(),0,100);
        assertThat(retained).hasSize(2);
        assertThat(retained.stream().map(e -> e.type())).containsExactly("ORDER_PENDING","ORDER_FILLED");
        assertThat(retained.get(0).order().leverage()).isEqualTo(10);
        assertThat(retained.get(0).order().fill()).isNull();
        assertThat(retained.get(1).order().leverage()).isEqualTo(20);
        assertThat(n(retained.get(1).order().fill().fee())).isEqualByComparingTo("0.294");
        assertThat(retained.get(1).order().orderId()).isEqualTo(pending.orderId());
        assertThat(events.after(guest.accountId(),Long.parseLong(retained.get(0).eventId()),100)).containsExactly(retained.get(1));
    }

    @Test void cancellationAndLiquidationRetainPreciselyTheirOwnTransitionsAndNetLoss() {
        var canceled=orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,n("1"),10,n("990")));
        orders.cancel(guest.accountId(),canceled.orderId()); orders.cancel(guest.accountId(),canceled.orderId());
        leverage.change(guest.accountId(),btc,Position.Side.LONG,100); var opened=open("10");
        orders.createLimitClose(guest.accountId(),opened.positionId(),key(),new LimitCloseRequest(n("5"),n("1100")));
        var risk=mark("800"); trigger.process(guest.accountId(),risk,Map.of(btc,risk));
        trigger.process(guest.accountId(),risk,Map.of(btc,risk));
        var retained=events.after(guest.accountId(),0,100);
        assertThat(retained.stream().map(e -> e.type())).containsExactly("ORDER_PENDING","ORDER_CANCELED","ORDER_FILLED","ORDER_PENDING","ORDER_REJECTED","POSITION_LIQUIDATED");
        var closed=history.closed(guest.accountId(),null,50,btc,null,Position.Status.LIQUIDATED,null,null).items().get(0);
        assertThat(n(closed.realizedPnl())).isEqualByComparingTo("-2000");
        assertThat(n(closed.feesPaid())).isEqualByComparingTo("9");
        assertThat(n(closed.settlementAdjustment())).isEqualByComparingTo("1904");
        assertThat(n(closed.netRealizedPnl())).isEqualByComparingTo("-105");
    }

    @Test void eventWriteFailureRollsBackWalletPositionOrderAndFillTogether() {
        var before=accounts.wallet(guest.accountId());
        new TransactionTemplate(transactions).executeWithoutResult(status ->
                doThrow(new IllegalStateException("injected event failure")).when(events).record(any(),any()));
        assertThatThrownBy(() -> open("1")).isInstanceOf(IllegalStateException.class);
        assertThat(accounts.wallet(guest.accountId())).isEqualTo(before);
        assertThat(orders.history(guest.accountId(),null,50)).isEmpty();
        assertThat(fills(null,50)).isEmpty();
        assertThat(events.after(guest.accountId(),0,50)).isEmpty();
    }

    @Test void rolledBackOuterTransactionDoesNotLeaveAnEventOrAfterCommitSignal() {
        events.watch(guest.accountId()); assertThat(events.consumeDirty(guest.accountId())).isTrue();
        new TransactionTemplate(transactions).executeWithoutResult(status -> { open("1"); status.setRollbackOnly(); });
        assertThat(events.after(guest.accountId(),0,50)).isEmpty();
        assertThat(events.consumeDirty(guest.accountId())).isFalse();
        assertThat(orders.history(guest.accountId(),null,50)).isEmpty();
    }

    @Test void migratedDonorFillIdsRemainOriginalWhileClosedHistoryReportsOneCanonicalLifecycle() {
        // Disposable V10/V11 fixture: two former Cross lots were merged without rewriting their fills.
        jdbc.update("update trading.trading_account set created_at=now()-interval '1 day',last_financial_change_at=now()-interval '1 second' where id=?",guest.accountId());
        jdbc.update("update trading.wallet set balance=10005,used_margin=190,realized_pnl=5 where account_id=?",guest.accountId());
        Long canonical=jdbc.queryForObject("insert into trading.position(account_id,trading_symbol_id,side,quantity,initial_quantity,reserved_close_quantity,entry_price,entry_notional,leverage,margin,initial_margin,status,realized_pnl,opened_at,opened_margin_mode,isolated_cutover_margin,isolated_cutover_price,isolated_cutover_at) values (?,?,'LONG',1.9,2,0,1000,1900,10,190,200,'OPEN',5,now()-interval '1 hour','CROSS',190,1000,now()) returning id",Long.class,guest.accountId(),btc);
        Long donor=jdbc.queryForObject("insert into trading.position(account_id,trading_symbol_id,side,quantity,initial_quantity,reserved_close_quantity,entry_price,entry_notional,leverage,margin,initial_margin,status,realized_pnl,opened_at,opened_margin_mode,merged_into_position_id) values (?,?,'LONG',0.9,1,0,1000,900,10,90,100,'MERGED',5,now()-interval '1 hour','CROSS',?) returning id",Long.class,guest.accountId(),btc,canonical);
        legacyFill(canonical,"OPEN","1","1000","0");
        legacyFill(donor,"OPEN","1","1000","0");
        legacyFill(donor,"CLOSE","0.1","1050","5");
        orders.close(guest.accountId(),canonical,key());
        var closed=history.closed(guest.accountId(),null,50,null,null,null,null,null).items();
        assertThat(closed).hasSize(1);
        assertThat(closed.get(0).openedMarginMode()).isEqualTo("CROSS");
        assertThat(closed.get(0).closingMarginMode()).isEqualTo("ISOLATED");
        assertThat(n(closed.get(0).realizedPnl())).isEqualByComparingTo("5");
        assertThat(n(closed.get(0).feesPaid())).isEqualByComparingTo("0.95");
        assertThat(n(closed.get(0).netRealizedPnl())).isEqualByComparingTo("4.05");
        assertThat(fills(null,50).stream().filter(f -> f.positionId().equals(donor))).hasSize(2)
                .allMatch(f -> f.lifecyclePositionId().equals(canonical) && f.marginMode().equals("CROSS"));
        assertThat(n(accounts.wallet(guest.accountId()).balance())).isEqualByComparingTo("10004.05");
        assertThat(events.after(guest.accountId(),0,50)).hasSize(1); // No fabricated historical notifications.
    }

    private void legacyFill(long position,String action,String quantity,String price,String pnl) {
        Long order=jdbc.queryForObject("insert into trading.trading_order(account_id,position_id,trading_symbol_id,side,type,action,status,quantity,leverage,requested_leverage,filled_price,reserved_margin,idempotency_key,request_fingerprint,created_at,completed_at,submitted_margin_mode,fee_rate) values (?,?,?,'LONG','MARKET',?,'FILLED',?,10,10,?,0,?,repeat('a',64),now()-interval '30 minutes',now()-interval '30 minutes','CROSS',0) returning id",Long.class,guest.accountId(),position,btc,action,n(quantity),n(price),key());
        jdbc.update("insert into trading.fill(order_id,price,quantity,price_event_time,executed_at,realized_pnl,margin_mode) values (?,?,?,now()-interval '30 minutes',now()-interval '30 minutes',?,'CROSS')",order,n(price),n(quantity),n(pnl));
    }

    @Test void privateApisAndFiltersCannotReturnAnotherAccountsHistory() throws Exception {
        var opened=open("1"); orders.close(guest.accountId(),opened.positionId(),key());
        prices.markUnavailable(); // Immutable history remains readable through a market-data outage.
        var other=accounts.createGuest();
        for(String endpoint:List.of("fills","positions/history","events")) {
            mvc.perform(get("/api/v1/trading/account/"+endpoint)).andExpect(status().isUnauthorized());
            String actual=mvc.perform(get("/api/v1/trading/account/"+endpoint).header("Authorization","Bearer "+other.accessToken()))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            var data=json.readTree(actual); assertThat(data.isArray() ? data.size() : data.path("items").size()).isZero();
        }
        mvc.perform(get("/api/v1/trading/account/orders").header("Authorization",bearer()).param("status","FILLED").param("action","CLOSE"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/api/v1/trading/account/fills").header("Authorization",bearer()).param("side","SHORT"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/api/v1/trading/account/fills").header("Authorization",bearer()).param("action","CLOSE").param("executedFrom",Instant.EPOCH.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].fee").isString()).andExpect(jsonPath("$[0].price").isString())
                .andExpect(jsonPath("$[0].providerSymbol").doesNotExist());
        mvc.perform(get("/api/v1/trading/account/positions/history").header("Authorization",bearer()).param("status","OPEN"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_HISTORY_REQUEST"));
        mvc.perform(get("/api/v1/trading/account/positions/history").header("Authorization",bearer()).param("cursor","invalid"))
                .andExpect(status().isBadRequest());
    }
    @Test void openApiDocumentsPrivateHistoryAndStringValuedFinancialFacts() throws Exception {
        var api=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        for(String endpoint:List.of("fills","positions/history","events")) {
            var operation=api.path("paths").path("/api/v1/trading/account/"+endpoint).path("get");
            assertThat(operation.path("security").isEmpty()).isFalse();
            assertThat(operation.path("summary").asText()).isNotBlank();
        }
        var schemas=api.path("components").path("schemas");
        assertThat(schemas.path("FillHistoryResponse").path("properties").path("fee").path("type").asText()).isEqualTo("string");
        assertThat(schemas.path("ClosedPositionResponse").path("properties").path("netRealizedPnl").path("type").asText()).isEqualTo("string");
        assertThat(schemas.path("TradingEventResponse").path("properties").path("eventId").path("type").asText()).isEqualTo("string");
        assertThat(schemas.path("ClosedPositionResponse").path("description").asText()).contains("lifecycle","not one order");
    }

    private List<com.yogimangchi.trading.tradehistory.dto.FillHistoryResponse> fills(Long before,int limit) {
        return history.fills(guest.accountId(),before,limit,null,null,null,null,null,null);
    }
    private OrderResponse open(String quantity) { return orders.create(guest.accountId(),key(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,n(quantity),leverage.current(guest.accountId(),btc,Position.Side.LONG),null)); }
    private LatestMarkPrice mark(String amount) {
        Instant now=Instant.now();
        Instant event=prices.find(btc).latestPrice().map(LatestMarkPrice::eventTime).filter(p -> !p.isBefore(now)).map(p -> p.plusNanos(1)).orElse(now);
        var tick=new LatestMarkPrice(btc,n(amount),event,now); assertThat(prices.update(tick)).isTrue(); return tick;
    }
    private String bearer() { return "Bearer "+guest.accessToken(); }
    private static BigDecimal n(String value) { return new BigDecimal(value); }
    private static String key() { return UUID.randomUUID().toString(); }
}
