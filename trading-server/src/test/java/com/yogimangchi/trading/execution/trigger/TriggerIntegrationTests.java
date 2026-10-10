package com.yogimangchi.trading.execution.trigger;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.fill.repository.FillRepository;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="binance.mark-price.enabled=false")
@Import(PostgresTestConfiguration.class)
@AutoConfigureMockMvc
class TriggerIntegrationTests {
    @Autowired TradingOrderService orders;
    @Autowired TradingAccountService accounts;
    @Autowired LatestPriceStore prices;
    @Autowired MarketTriggerWorker worker;
    @Autowired AccountTriggerService processor;
    @Autowired RedisMarketDataBridge bridge;
    @Autowired StringRedisTemplate redis;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired MockMvc mvc;
    @MockitoSpyBean TradingEngineGate gate;
    @MockitoSpyBean FillRepository fills;
    @MockitoSpyBean TriggerCandidates candidates;
    @MockitoSpyBean com.yogimangchi.trading.tradingaccount.service.AccountValuation valuation;
    GuestAccountResponse guest;
    long symbol;

    @BeforeEach void setup() throws Exception {
        guest=accounts.createGuest();
        symbol=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(symbol));
        await().atMost(Duration.ofSeconds(8)).until(() -> bridge.health().state()==RedisMarketDataBridge.State.HEALTHY);
        tick("100"); drain();
    }
    @AfterEach void cleanup() { reset(gate,fills,candidates,valuation); prices.markUnavailable(); }

    @Test void limitReservesAndCrossingSurvivesDipThenReboundBeforeWorkerRuns() throws Exception {
        OrderResponse buy=limit(Position.Side.LONG,"10","99",10);
        OrderResponse sell=limit(Position.Side.SHORT,"10","101",10);
        assertThat(buy.status()).isEqualTo("PENDING"); assertThat(buy.fill()).isNull(); assertThat(buy.positionId()).isNull();
        amount("reserved_margin","200");
        tick("98"); tick("102"); drain();
        assertThat(orderStatus(buy.orderId())).isEqualTo("FILLED"); assertThat(orderStatus(sell.orderId())).isEqualTo("FILLED");
        assertThat(fillPrice(buy.orderId())).isEqualByComparingTo("98");
        assertThat(fillPrice(sell.orderId())).isEqualByComparingTo("102");
        amount("reserved_margin","0"); amount("used_margin","200");
    }

    @Test void pendingReplayCancelAndOwnerProtectionWorkThroughApi() throws Exception {
        OrderResponse pending=limit(Position.Side.LONG,"10","99",10);
        mvc.perform(get("/api/v1/trading/account/orders/pending").header("Authorization","Bearer "+guest.accessToken()))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].orderId").value(pending.orderId()));
        var other=accounts.createGuest();
        mvc.perform(post("/api/v1/trading/account/orders/"+pending.orderId()+"/cancel").header("Authorization","Bearer "+other.accessToken()))
                .andExpect(status().isNotFound());
        prices.markUnavailable(); gate.recovering();
        OrderResponse canceled=orders.cancel(guest.accountId(),pending.orderId());
        assertThat(orders.cancel(guest.accountId(),pending.orderId())).isEqualTo(canceled);
        amount("reserved_margin","0"); assertThat(orderStatus(pending.orderId())).isEqualTo("CANCELED");
    }

    @Test void cancelAndFillRaceLeavesExactlyOneOutcome() throws Exception {
        OrderResponse pending=limit(Position.Side.LONG,"10","99",10);
        LatestMarkPrice tick=tick("98");
        race(() -> orders.cancel(guest.accountId(),pending.orderId()), () -> processor.process(guest.accountId(),tick,Map.of(symbol,tick)));
        String state=orderStatus(pending.orderId());
        assertThat(state).isIn("CANCELED","FILLED");
        amount("reserved_margin","0");
        assertThat(fillCount()).isEqualTo(state.equals("FILLED") ? 1 : 0);
        amount("used_margin",state.equals("FILLED") ? "98" : "0");
    }

    @Test void marketAndLimitFillShareTheSameWalletLock() throws Exception {
        limit(Position.Side.LONG,"50","99",1);
        LatestMarkPrice tick=tick("98");
        // Exercise database serialization independently of the admission gate (covered separately).
        doNothing().when(gate).requireCaughtUp(anyMap());
        race(() -> market(Position.Side.LONG,"50",1), () -> processor.process(guest.accountId(),tick,Map.of(symbol,tick)));
        amount("used_margin","9800"); amount("reserved_margin","0");
        assertThat(fillCount()).isEqualTo(2);
    }

    @Test void workerFailureAfterAccountCommitReplaysWithoutDoubleFill() throws Exception {
        OrderResponse pending=limit(Position.Side.LONG,"10","99",10);
        tick("98");
        doThrow(new IllegalStateException("crash after account commit")).when(candidates).accounts(any(),longThat(id -> id>0));
        assertThatThrownBy(worker::runOnce).isInstanceOf(IllegalStateException.class);
        assertThat(orderStatus(pending.orderId())).isEqualTo("FILLED");
        reset(candidates);
        MarketTriggerWorker restarted=new MarketTriggerWorker(redis,jdbc,json,bridge,gate,candidates,processor,false);
        try { restarted.runOnce(); } finally { restarted.close(); }
        assertThat(fillCount()).isEqualTo(1); amount("used_margin","98"); amount("reserved_margin","0");
        drain();
    }

    @Test void fillFailureRollsBackPendingReservationPositionAndFill() throws Exception {
        OrderResponse pending=limit(Position.Side.LONG,"10","99",10);
        LatestMarkPrice tick=tick("98");
        doThrow(new IllegalStateException("injected fill failure")).when(fills).save(any());
        assertThatThrownBy(() -> processor.process(guest.accountId(),tick,Map.of(symbol,tick))).isInstanceOf(IllegalStateException.class);
        assertThat(orderStatus(pending.orderId())).isEqualTo("PENDING");
        amount("reserved_margin","99"); amount("used_margin","0"); assertThat(fillCount()).isZero();
        assertThat(positionCount("OPEN")).isZero();
    }

    @Test void longLiquidationCrossesWithoutExactTouchAndCancelsAllReservations() throws Exception {
        market(Position.Side.LONG,"900",10);
        OrderResponse pending=limit(Position.Side.SHORT,"1","200",10);
        tick("88"); tick("102"); drain();
        assertThat(positionCount("LIQUIDATED")).isEqualTo(1);
        assertThat(orderStatus(pending.orderId())).isEqualTo("REJECTED");
        amount("balance","-800"); amount("realized_pnl","-10800"); amount("used_margin","0"); amount("reserved_margin","0");
        assertThat(accounts.summary(guest.accountId()).status()).isEqualTo("BANKRUPT");
        assertThat(fillCount()).isEqualTo(2);
        tick("80"); drain(); assertThat(fillCount()).isEqualTo(2);
    }

    @Test void shortLiquidationCrossesAndDuplicateEventCannotLiquidateAgain() throws Exception {
        market(Position.Side.SHORT,"1000",10);
        LatestMarkPrice risk=tick("111"); tick("99"); drain();
        amount("balance","-1000"); assertThat(positionCount("LIQUIDATED")).isEqualTo(1);
        processor.process(guest.accountId(),risk,Map.of(symbol,risk));
        assertThat(fillCount()).isEqualTo(2);
    }

    @Test void liquidationWriteFailureRollsBackEntireAccount() throws Exception {
        market(Position.Side.LONG,"900",10);
        OrderResponse pending=limit(Position.Side.LONG,"1","50",10);
        LatestMarkPrice risk=tick("88");
        doThrow(new IllegalStateException("injected liquidation failure")).when(fills).save(any());
        assertThatThrownBy(() -> processor.process(guest.accountId(),risk,Map.of(symbol,risk))).isInstanceOf(IllegalStateException.class);
        amount("balance","10000"); amount("used_margin","9000"); amount("reserved_margin","5");
        assertThat(positionCount("OPEN")).isEqualTo(1); assertThat(orderStatus(pending.orderId())).isEqualTo("PENDING");
        assertThat(fillCount()).isEqualTo(1);
    }

    @Test void missingOrStalePortfolioMarkPreventsExecution() throws Exception {
        OrderResponse pending=limit(Position.Side.LONG,"10","99",10);
        LatestMarkPrice fresh=tick("98");
        LatestMarkPrice old=new LatestMarkPrice(symbol,new BigDecimal("98"),Instant.now().minusSeconds(6),Instant.now().minusSeconds(6));
        processor.process(guest.accountId(),old,Map.of(symbol,old));
        assertThat(orderStatus(pending.orderId())).isEqualTo("PENDING");
        prices.markUnavailable(); processor.process(guest.accountId(),fresh,Map.of(symbol,fresh));
        assertThat(orderStatus(pending.orderId())).isEqualTo("PENDING"); amount("reserved_margin","99");
    }

    @Test void gateBlocksUnprocessedPricesAndRecoversAfterReplay() throws Exception {
        tick("98");
        assertThatThrownBy(() -> market(Position.Side.LONG,"1",1)).isInstanceOfSatisfying(BusinessException.class,
                e -> assertThat(e.getCode()).isEqualTo(ErrorCode.ENGINE_RECOVERING));
        drain(); assertThat(market(Position.Side.LONG,"1",1).status()).isEqualTo("FILLED");
        assertThatThrownBy(() -> orders.create(guest.accountId(),"liquidation:position:1",new CreateOrderRequest(
                TradingOrder.Type.MARKET,symbol,Position.Side.LONG,BigDecimal.ONE,1,null)))
                .isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(ErrorCode.INVALID_IDEMPOTENCY_KEY));
    }

    @Test void lostRedisStreamIsDetectedAndDatabasePendingOrdersAreReconciled() throws Exception {
        OrderResponse pending=limit(Position.Side.LONG,"10","99",10);
        long gaps=jdbc.queryForObject("select gap_count from trading.market_trigger_cursor where id=1",Long.class);
        redis.delete(RedisMarketDataBridge.STREAM_KEY); // Isolated Testcontainers Redis, never local infrastructure.
        worker.runOnce(); assertThat(gate.status()).isEqualTo("RECOVERING");
        assertThat(jdbc.queryForObject("select gap_count from trading.market_trigger_cursor where id=1",Long.class)).isGreaterThan(gaps);
        tick("98"); drain();
        assertThat(orderStatus(pending.orderId())).isEqualTo("FILLED"); assertThat(fillCount()).isEqualTo(1);
    }

    @Test void crossMarginLiquidatesAllSymbolsAtomicallyUsingOneFreshVector() throws Exception {
        long ether=jdbc.queryForObject("select id from trading.trading_symbol where symbol='ETH'",Long.class);
        prices.beginSubscription(Set.of(symbol,ether)); tick("100");
        Instant now=Instant.now();
        LatestMarkPrice etherPrice=new LatestMarkPrice(ether,new BigDecimal("100"),now,now);
        prices.update(etherPrice);
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
            worker.runOnce(); gate.requireCaughtUp(prices.findAll(Set.of(symbol,ether)));
        });
        market(Position.Side.LONG,"500",10);
        orders.create(guest.accountId(),UUID.randomUUID().toString(),new CreateOrderRequest(
                TradingOrder.Type.MARKET,ether,Position.Side.SHORT,new BigDecimal("500"),10,null));
        LatestMarkPrice btcRisk=tick("79");
        processor.process(guest.accountId(),btcRisk,Map.of(symbol,btcRisk));
        assertThat(positionCount("OPEN")).isEqualTo(2); // Missing ETH cannot be interpreted as zero PnL.
        processor.process(guest.accountId(),btcRisk,Map.of(symbol,btcRisk,ether,etherPrice));
        assertThat(positionCount("LIQUIDATED")).isEqualTo(2); assertThat(fillCount()).isEqualTo(4);
        amount("balance","-500"); amount("used_margin","0");
    }

    @Test void limitRejectsInsufficientExecutionMarginAndReleasesReservation() throws Exception {
        OrderResponse pending=limit(Position.Side.SHORT,"100","99",1);
        tick("102"); drain();
        assertThat(orderStatus(pending.orderId())).isEqualTo("REJECTED");
        assertThat(jdbc.queryForObject("select reason from trading.trading_order where id=?",String.class,pending.orderId()))
                .isEqualTo("INSUFFICIENT_MARGIN");
        amount("reserved_margin","0"); amount("used_margin","0"); assertThat(fillCount()).isZero();
    }

    @Test void crossingWaitsForAnUncommittedNewPositionInsteadOfSkippingIt() throws Exception {
        CountDownLatch beforeCommit=new CountDownLatch(1);
        CountDownLatch release=new CountDownLatch(1);
        java.util.concurrent.atomic.AtomicBoolean first=new java.util.concurrent.atomic.AtomicBoolean(true);
        doAnswer(invocation -> {
            Object value = invocation.callRealMethod();
            if (first.getAndSet(false)) {
                beforeCommit.countDown();
                if (!release.await(3,TimeUnit.SECONDS)) throw new IllegalStateException("Test did not release the transaction");
            }
            return value;
        }).when(valuation).calculate(any(com.yogimangchi.trading.tradingaccount.entity.Wallet.class),anyList(),anySet());
        ExecutorService pool=Executors.newFixedThreadPool(2);
        try {
            Future<OrderResponse> opening=pool.submit(() -> market(Position.Side.LONG,"1000",10));
            assertThat(beforeCommit.await(3,TimeUnit.SECONDS)).isTrue();
            tick("89"); tick("102");
            CountDownLatch readerStarted=new CountDownLatch(1);
            Future<?> reading=pool.submit(() -> { readerStarted.countDown(); worker.runOnce(); return null; });
            assertThat(readerStarted.await(1,TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> reading.get(100,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
            release.countDown();
            opening.get(3,TimeUnit.SECONDS); reading.get(3,TimeUnit.SECONDS);
            assertThat(positionCount("LIQUIDATED")).isEqualTo(1); amount("balance","-1000");
            assertThat(fillCount()).isEqualTo(2);
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test void failedMarketTransactionReleasesItsOrderingGateAfterRollback() throws Exception {
        doThrow(new IllegalStateException("injected market failure")).when(fills).save(any());
        assertThatThrownBy(() -> market(Position.Side.LONG,"1",1)).isInstanceOf(IllegalStateException.class);
        assertThat(positionCount("OPEN")).isZero(); amount("used_margin","0");
        reset(fills);
        tick("99"); drain();
        assertThat(market(Position.Side.LONG,"1",1).status()).isEqualTo("FILLED");
    }

    @Test void invalidCheckpointCannotBeBypassedOnTheSecondAttempt() throws Exception {
        String saved=jdbc.queryForObject("select price_book from trading.market_trigger_cursor where id=1",String.class);
        MarketTriggerWorker restarted=new MarketTriggerWorker(redis,jdbc,json,bridge,gate,candidates,processor,false);
        try {
            jdbc.update("update trading.market_trigger_cursor set price_book=? where id=1","{broken");
            assertThatThrownBy(restarted::runOnce).isInstanceOf(IllegalStateException.class).hasMessage("Invalid trigger checkpoint");
            assertThatThrownBy(restarted::runOnce).isInstanceOf(IllegalStateException.class).hasMessage("Invalid trigger checkpoint");
        } finally {
            jdbc.update("update trading.market_trigger_cursor set price_book=? where id=1",saved);
            restarted.close();
        }
        drain();
    }

    private OrderResponse limit(Position.Side side,String quantity,String limit,int leverage) {
        return orders.create(guest.accountId(),UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,symbol,side,new BigDecimal(quantity),leverage,new BigDecimal(limit)));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"LONG,0.4,110,109,111,0.6,4.4", "LONG,1,110,109,111,0,11",
            "SHORT,0.4,90,91,89,0.6,4.4", "SHORT,1,90,91,89,0,11"})
    void limitCloseUsesOppositeDirectionAndTriggerMark(Position.Side side, String quantity, String limit,
            String before, String crossed, String remaining, String pnl) throws Exception {
        var opened=market(side,"1",10);
        var close=closeLimit(opened.positionId(),quantity,limit);
        assertThat(close.action()).isEqualTo("CLOSE");
        assertThat(close.positionId()).isEqualTo(opened.positionId());
        assertThat(close.reservedCloseQuantity()).isEqualTo(new BigDecimal(quantity).setScale(8).toPlainString());
        amount("used_margin","10"); amount("reserved_margin","0");
        tick(before); drain(); assertThat(orderStatus(close.orderId())).isEqualTo("PENDING");
        tick(crossed); drain(); assertThat(orderStatus(close.orderId())).isEqualTo("FILLED");
        assertThat(fillPrice(close.orderId())).isEqualByComparingTo(crossed);
        positionAmount(opened.positionId(),"quantity",remaining);
        positionAmount(opened.positionId(),"reserved_close_quantity","0");
        amount("used_margin",new BigDecimal(remaining).multiply(BigDecimal.TEN).toPlainString());
        amount("realized_pnl",pnl);
        assertThat(fillCount()).isEqualTo(2);
        assertThat(positionCount(remaining.equals("0") ? "CLOSED" : "OPEN")).isEqualTo(1);
    }

    @Test void reservationsPreventOverCloseAndCancelReleasesOnlyItsQuantityEvenDuringOutage() {
        var opened=market(Position.Side.LONG,"1",10);
        var first=closeLimit(opened.positionId(),"0.7","110");
        assertThatThrownBy(() -> closeLimit(opened.positionId(),"0.4","120"))
                .isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(ErrorCode.CLOSE_QUANTITY_EXCEEDED));
        assertThatThrownBy(() -> orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(new BigDecimal("0.5"))))
                .isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(ErrorCode.CLOSE_QUANTITY_EXCEEDED));
        assertThatThrownBy(() -> orders.close(guest.accountId(),opened.positionId(),key()))
                .isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(ErrorCode.CLOSE_QUANTITY_EXCEEDED));
        orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(new BigDecimal("0.2")));
        var second=closeLimit(opened.positionId(),"0.1","120");
        positionAmount(opened.positionId(),"quantity","0.8"); positionAmount(opened.positionId(),"reserved_close_quantity","0.8");
        prices.markUnavailable(); gate.recovering();
        var canceled=orders.cancel(guest.accountId(),first.orderId());
        assertThat(orders.cancel(guest.accountId(),first.orderId())).isEqualTo(canceled);
        positionAmount(opened.positionId(),"reserved_close_quantity","0.1");
        assertThat(orderStatus(second.orderId())).isEqualTo("PENDING");
        amount("reserved_margin","0"); amount("used_margin","8");
    }

    @Test void closeLimitReplayUsesPayloadAndFullRequestIsCapturedAtCreation() throws Exception {
        var opened=market(Position.Side.SHORT,"1",10);
        String key=key();
        var request=new LimitCloseRequest(null,new BigDecimal("90"));
        var pending=orders.createLimitClose(guest.accountId(),opened.positionId(),key,request);
        prices.markUnavailable(); gate.recovering();
        assertThat(orders.createLimitClose(guest.accountId(),opened.positionId(),key,request)).isEqualTo(pending);
        assertThatThrownBy(() -> orders.createLimitClose(guest.accountId(),opened.positionId(),key,new LimitCloseRequest(null,new BigDecimal("89"))))
                .isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(ErrorCode.IDEMPOTENCY_CONFLICT));
        assertThatThrownBy(() -> orders.createLimitClose(guest.accountId(),opened.positionId(),key,new LimitCloseRequest(new BigDecimal("0.5"),new BigDecimal("90"))))
                .isInstanceOfSatisfying(BusinessException.class,e -> assertThat(e.getCode()).isEqualTo(ErrorCode.IDEMPOTENCY_CONFLICT));
        prices.beginSubscription(Set.of(symbol)); tick("89"); drain();
        var filled=orders.createLimitClose(guest.accountId(),opened.positionId(),key,request);
        assertThat(filled.status()).isEqualTo("FILLED"); assertThat(filled.orderId()).isEqualTo(pending.orderId());
        assertThat(filled.quantity()).isEqualTo("1.00000000"); assertThat(fillCount()).isEqualTo(2);
    }

    @Test void closeOrderApiRequiresOwnerAndExposesSeparateReservations() throws Exception {
        var opened=market(Position.Side.LONG,"1",10);
        String path="/api/v1/trading/account/positions/"+opened.positionId()+"/close-orders";
        String body="{\"quantity\":\"0.7\",\"limitPrice\":\"110\"}";
        mvc.perform(post(path).header("Idempotency-Key",key()).contentType("application/json").content(body)).andExpect(status().isUnauthorized());
        var other=accounts.createGuest();
        mvc.perform(post(path).header("Authorization","Bearer "+other.accessToken()).header("Idempotency-Key",key())
                .contentType("application/json").content(body)).andExpect(status().isNotFound());
        for (String blank : List.of("", " ")) {
            mvc.perform(post(path).header("Authorization","Bearer "+guest.accessToken()).header("Idempotency-Key",key())
                    .contentType("application/json").content("{\"quantity\":\""+blank+"\",\"limitPrice\":\"110\"}"))
                    .andExpect(status().isBadRequest());
        }
        positionAmount(opened.positionId(),"reserved_close_quantity","0");
        mvc.perform(post(path).header("Authorization","Bearer "+guest.accessToken()).header("Idempotency-Key",key())
                .contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.action").value("CLOSE"))
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.reservedCloseQuantity").value("0.70000000"))
                .andExpect(jsonPath("$.reservedMargin").value("0.000000000000000000"));
        mvc.perform(get("/api/v1/trading/account/positions").header("Authorization","Bearer "+guest.accessToken()))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].freeCloseQuantity").value("0.30000000"));
    }

    private OrderResponse closeLimit(Long positionId,String quantity,String limit) {
        return orders.createLimitClose(guest.accountId(),positionId,key(),new LimitCloseRequest(
                quantity==null ? null : new BigDecimal(quantity),new BigDecimal(limit)));
    }

    @Test void simultaneousCloseReservationsCannotOverbookAndDuplicateKeyReservesOnce() throws Exception {
        var opened=market(Position.Side.LONG,"1",10);
        var results=concurrentResults(() -> closeLimit(opened.positionId(),"0.7","110"),
                () -> closeLimit(opened.positionId(),"0.7","120"));
        assertThat(results.stream().filter(OrderResponse.class::isInstance)).hasSize(1);
        assertThat(results.stream().filter(BusinessException.class::isInstance).map(BusinessException.class::cast))
                .extracting(BusinessException::getCode).containsExactly(ErrorCode.CLOSE_QUANTITY_EXCEEDED);
        positionAmount(opened.positionId(),"reserved_close_quantity","0.7");
        orders.cancel(guest.accountId(),orders.pending(guest.accountId()).get(0).orderId());
        String key=key(); var request=new LimitCloseRequest(new BigDecimal("0.7"),new BigDecimal("110"));
        var duplicates=concurrentResults(() -> orders.createLimitClose(guest.accountId(),opened.positionId(),key,request),
                () -> orders.createLimitClose(guest.accountId(),opened.positionId(),key,request));
        assertThat(duplicates).allMatch(OrderResponse.class::isInstance);
        assertThat(duplicates.stream().distinct()).hasSize(1);
        positionAmount(opened.positionId(),"reserved_close_quantity","0.7");
    }

    @Test void limitCloseCancelVersusFillSettlesExactlyOnce() throws Exception {
        var opened=market(Position.Side.LONG,"1",10);
        var closing=closeLimit(opened.positionId(),"0.4","110");
        var price=tick("111");
        race(() -> orders.cancel(guest.accountId(),closing.orderId()), () -> processor.process(guest.accountId(),price,Map.of(symbol,price)));
        String status=orderStatus(closing.orderId());
        assertThat(status).isIn("FILLED","CANCELED");
        positionAmount(opened.positionId(),"reserved_close_quantity","0");
        positionAmount(opened.positionId(),"quantity",status.equals("FILLED") ? "0.6" : "1");
        amount("balance",status.equals("FILLED") ? "10004.4" : "10000");
        amount("used_margin",status.equals("FILLED") ? "6" : "10");
        assertThat(fillCount()).isEqualTo(status.equals("FILLED") ? 2 : 1);
    }

    @Test void marketHalfCloseCannotRacePastReservedLimitClose() throws Exception {
        var opened=market(Position.Side.LONG,"1",10);
        var closing=closeLimit(opened.positionId(),"0.6","110");
        var price=tick("111");
        doNothing().when(gate).requireCaughtUp(anyMap());
        var results=concurrentResults(() -> orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(new BigDecimal("0.5"))),
                () -> { processor.process(guest.accountId(),price,Map.of(symbol,price)); return "processed"; });
        assertThat(results.stream().filter(BusinessException.class::isInstance).map(BusinessException.class::cast))
                .extracting(BusinessException::getCode).containsExactly(ErrorCode.CLOSE_QUANTITY_EXCEEDED);
        assertThat(orderStatus(closing.orderId())).isEqualTo("FILLED");
        positionAmount(opened.positionId(),"quantity","0.4"); positionAmount(opened.positionId(),"reserved_close_quantity","0");
        amount("balance","10006.6"); amount("used_margin","4"); assertThat(fillCount()).isEqualTo(2);
    }

    @Test void closeFillFailureRestoresReservationRemainingQuantityAndWalletThenRetriesOnce() {
        var opened=market(Position.Side.LONG,"1",10);
        var closing=closeLimit(opened.positionId(),"0.4","110");
        var price=tick("111");
        doThrow(new IllegalStateException("injected close fill failure")).when(fills).save(any());
        assertThatThrownBy(() -> processor.process(guest.accountId(),price,Map.of(symbol,price))).isInstanceOf(IllegalStateException.class);
        positionAmount(opened.positionId(),"quantity","1"); positionAmount(opened.positionId(),"reserved_close_quantity","0.4");
        amount("used_margin","10"); amount("balance","10000"); assertThat(orderStatus(closing.orderId())).isEqualTo("PENDING");
        assertThat(fillCount()).isEqualTo(1);
        reset(fills);
        processor.process(guest.accountId(),price,Map.of(symbol,price));
        processor.process(guest.accountId(),price,Map.of(symbol,price));
        positionAmount(opened.positionId(),"quantity","0.6"); positionAmount(opened.positionId(),"reserved_close_quantity","0");
        amount("balance","10004.4"); assertThat(fillCount()).isEqualTo(2);
    }

    @Test void partialCloseStreamReplayAfterCommitDoesNotDecreaseQuantityTwice() throws Exception {
        var opened=market(Position.Side.LONG,"1",10);
        closeLimit(opened.positionId(),"0.4","110"); tick("111");
        String checkpoint=jdbc.queryForObject("select stream_id from trading.market_trigger_cursor where id=1",String.class);
        doThrow(new IllegalStateException("crash before checkpoint")).when(candidates).accounts(any(),longThat(id -> id>0));
        assertThatThrownBy(worker::runOnce).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("select stream_id from trading.market_trigger_cursor where id=1",String.class)).isEqualTo(checkpoint);
        positionAmount(opened.positionId(),"quantity","0.6"); amount("balance","10004.4");
        reset(candidates);
        var restarted=new MarketTriggerWorker(redis,jdbc,json,bridge,gate,candidates,processor,false);
        try { restarted.runOnce(); } finally { restarted.close(); }
        positionAmount(opened.positionId(),"quantity","0.6"); positionAmount(opened.positionId(),"reserved_close_quantity","0");
        amount("balance","10004.4"); amount("used_margin","6"); assertThat(fillCount()).isEqualTo(2);
        drain();
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"LONG,110,80", "SHORT,90,120"})
    void partialCloseThenLiquidationUsesOnlyRemainingExposureAndClearsBothReservationTypes(Position.Side side,String limit,String adverse) throws Exception {
        var opened=market(side,"900",10);
        orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(new BigDecimal("300")));
        var closing=closeLimit(opened.positionId(),"400",limit);
        var opening=limit(Position.Side.SHORT,"1","200",10);
        tick(adverse); drain();
        assertThat(positionCount("LIQUIDATED")).isEqualTo(1);
        positionAmount(opened.positionId(),"quantity","0"); positionAmount(opened.positionId(),"reserved_close_quantity","0");
        positionAmount(opened.positionId(),"realized_pnl","-12000");
        amount("balance","-2000"); amount("used_margin","0"); amount("reserved_margin","0");
        assertThat(orderStatus(closing.orderId())).isEqualTo("REJECTED"); assertThat(orderStatus(opening.orderId())).isEqualTo("REJECTED");
        assertThat(orders.pending(guest.accountId())).isEmpty();
        assertThat(orders.history(guest.accountId(),null,100).stream().filter(o -> o.action().equals("LIQUIDATE")))
                .extracting(OrderResponse::quantity).containsExactly("600.00000000");
        assertThat(fillCount()).isEqualTo(3);
    }

    @Test void liquidationRollbackRestoresCloseReservationAsWellAsRemainingLot() {
        var opened=market(Position.Side.LONG,"1000",10);
        var closing=closeLimit(opened.positionId(),"600","110");
        var price=tick("89");
        doThrow(new IllegalStateException("injected liquidation fill failure")).when(fills).save(any());
        assertThatThrownBy(() -> processor.process(guest.accountId(),price,Map.of(symbol,price))).isInstanceOf(IllegalStateException.class);
        positionAmount(opened.positionId(),"quantity","1000"); positionAmount(opened.positionId(),"reserved_close_quantity","600");
        amount("balance","10000"); amount("used_margin","10000");
        assertThat(orderStatus(closing.orderId())).isEqualTo("PENDING"); assertThat(fillCount()).isEqualTo(1);
    }

    @Test void marketCloseAndLiquidationRaceNeverSettleTheSameQuantityTwice() throws Exception {
        var opened=market(Position.Side.LONG,"1000",10);
        var risk=tick("89");
        doNothing().when(gate).requireCaughtUp(anyMap());
        var results=concurrentResults(() -> orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(new BigDecimal("500"))),
                () -> { processor.process(guest.accountId(),risk,Map.of(symbol,risk)); return "processed"; });
        assertThat(results.stream().filter(BusinessException.class::isInstance).map(BusinessException.class::cast))
                .hasSize(1).allMatch(e -> e.getCode()==ErrorCode.ACCOUNT_AT_RISK || e.getCode()==ErrorCode.ACCOUNT_NOT_ACTIVE);
        amount("balance","-1000"); amount("used_margin","0"); assertThat(fillCount()).isEqualTo(2);
        assertThat(positionCount("LIQUIDATED")).isEqualTo(1);
    }

    @Test void partialCloseThatCommitsFirstReducesSubsequentLiquidationRisk() throws Exception {
        var opened=market(Position.Side.LONG,"1000",10);
        CountDownLatch valued=new CountDownLatch(1), release=new CountDownLatch(1);
        java.util.concurrent.atomic.AtomicBoolean first=new java.util.concurrent.atomic.AtomicBoolean(true);
        doAnswer(invocation -> {
            Object result=invocation.callRealMethod();
            if(first.getAndSet(false)) {
                valued.countDown();
                if(!release.await(3,TimeUnit.SECONDS)) throw new IllegalStateException("Test transaction not released");
            }
            return result;
        }).when(valuation).calculate(any(com.yogimangchi.trading.tradingaccount.entity.Wallet.class),anyList());
        ExecutorService pool=Executors.newFixedThreadPool(2);
        try {
            Future<?> closing=pool.submit(() -> orders.close(guest.accountId(),opened.positionId(),key(),new ClosePositionRequest(new BigDecimal("500"))));
            assertThat(valued.await(3,TimeUnit.SECONDS)).isTrue();
            var risk=tick("89");
            Future<?> riskProcessing=pool.submit(() -> processor.process(guest.accountId(),risk,Map.of(symbol,risk)));
            release.countDown(); closing.get(3,TimeUnit.SECONDS); riskProcessing.get(3,TimeUnit.SECONDS);
            positionAmount(opened.positionId(),"quantity","500"); amount("used_margin","5000"); amount("balance","10000");
            assertThat(positionCount("LIQUIDATED")).isZero();
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test void limitCloseAndLiquidationRaceUsesLatestLockedPositionState() throws Exception {
        var opened=market(Position.Side.LONG,"1000",10);
        var closing=closeLimit(opened.positionId(),"600","110");
        var risk=tick("89"); var profit=tick("111");
        concurrentResults(() -> { processor.process(guest.accountId(),profit,Map.of(symbol,profit)); return "close"; },
                () -> { processor.process(guest.accountId(),risk,Map.of(symbol,risk)); return "risk"; });
        String state=orderStatus(closing.orderId());
        assertThat(state).isIn("FILLED","REJECTED");
        positionAmount(opened.positionId(),"reserved_close_quantity","0");
        positionAmount(opened.positionId(),"quantity",state.equals("FILLED") ? "400" : "0");
        amount("balance",state.equals("FILLED") ? "16600" : "-1000");
        amount("used_margin",state.equals("FILLED") ? "4000" : "0");
        assertThat(fillCount()).isEqualTo(2); assertThat(orders.pending(guest.accountId())).isEmpty();
    }

    private List<Object> concurrentResults(Callable<?> first,Callable<?> second) throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(2); CountDownLatch start=new CountDownLatch(1);
        try {
            List<Future<Object>> futures=new ArrayList<>();
            for(Callable<?> action:List.of(first,second)) futures.add(pool.submit(() -> {
                start.await(); try { return action.call(); } catch(BusinessException exception) { return exception; }
            }));
            start.countDown(); List<Object> result=new ArrayList<>();
            for(Future<Object> future:futures) result.add(future.get(10,TimeUnit.SECONDS));
            return result;
        } finally { pool.shutdownNow(); }
    }

    @Test void rejectedLimitCloseReleasesReservationWithoutRealizingUnfundedLoss() throws Exception {
        var losing=market(Position.Side.LONG,"200",10);
        var winning=market(Position.Side.SHORT,"200",10);
        var closing=closeLimit(losing.positionId(),"200","0.5");
        tick("1"); drain();
        assertThat(orderStatus(closing.orderId())).isEqualTo("REJECTED");
        assertThat(jdbc.queryForObject("select reason from trading.trading_order where id=?",String.class,closing.orderId()))
                .isEqualTo("INSUFFICIENT_SETTLEMENT_CASH");
        positionAmount(losing.positionId(),"reserved_close_quantity","0"); positionAmount(losing.positionId(),"quantity","200");
        amount("balance","10000"); amount("used_margin","4000"); assertThat(fillCount()).isEqualTo(2);
        orders.close(guest.accountId(),winning.positionId(),key());
        orders.close(guest.accountId(),losing.positionId(),key());
        amount("balance","10000"); amount("used_margin","0"); assertThat(positionCount("OPEN")).isZero();
    }

    @Test void staleCloseTickCannotConsumeItsReservation() {
        var opened=market(Position.Side.LONG,"1",10);
        var closing=closeLimit(opened.positionId(),"0.4","110");
        Instant expired=Instant.now().minusSeconds(6);
        var old=new LatestMarkPrice(symbol,new BigDecimal("111"),expired,expired);
        processor.process(guest.accountId(),old,Map.of(symbol,old));
        assertThat(orderStatus(closing.orderId())).isEqualTo("PENDING");
        positionAmount(opened.positionId(),"quantity","1"); positionAmount(opened.positionId(),"reserved_close_quantity","0.4");
        amount("balance","10000"); assertThat(fillCount()).isEqualTo(1);
    }
    private static String key() { return UUID.randomUUID().toString(); }
    private void positionAmount(Long id,String column,String expected) {
        assertThat(jdbc.queryForObject("select "+column+" from trading.position where id=?",BigDecimal.class,id)).isEqualByComparingTo(expected);
    }
    private OrderResponse market(Position.Side side,String quantity,int leverage) {
        return orders.create(guest.accountId(),UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,symbol,side,new BigDecimal(quantity),leverage,null));
    }
    private LatestMarkPrice tick(String amount) {
        Instant now=Instant.now();
        LatestMarkPrice price=new LatestMarkPrice(symbol,new BigDecimal(amount),now,now);
        assertThat(prices.update(price)).isTrue();
        await().atMost(Duration.ofSeconds(3)).until(() -> bridge.readSharedSnapshot(symbol).latestPrice().map(p -> p.eventTime().equals(now)).orElse(false));
        return price;
    }
    private void drain() {
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
            worker.runOnce(); gate.requireCaughtUp(prices.findAll(Set.of(symbol)));
        });
    }
    private String orderStatus(Long id) { return jdbc.queryForObject("select status from trading.trading_order where id=?",String.class,id); }
    private BigDecimal fillPrice(Long id) { return jdbc.queryForObject("select price from trading.fill where order_id=?",BigDecimal.class,id); }
    private long fillCount() { return jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,guest.accountId()); }
    private long positionCount(String status) { return jdbc.queryForObject("select count(*) from trading.position where account_id=? and status=?",Long.class,guest.accountId(),status); }
    private void amount(String column,String expected) {
        assertThat(jdbc.queryForObject("select "+column+" from trading.wallet where account_id=?",BigDecimal.class,guest.accountId())).isEqualByComparingTo(expected);
    }
    private void race(Runnable first,Runnable second) throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(2); CountDownLatch latch=new CountDownLatch(1);
        try {
            List<Future<?>> futures=new ArrayList<>();
            for(Runnable action:List.of(first,second)) futures.add(pool.submit(() -> {
                try { latch.await(); action.run(); }
                catch(BusinessException e) { assertThat(e.getCode()).isEqualTo(ErrorCode.ORDER_NOT_PENDING); }
                catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
            }));
            latch.countDown(); for(Future<?> future:futures) future.get(10,TimeUnit.SECONDS);
        } finally { pool.shutdownNow(); }
    }
}
