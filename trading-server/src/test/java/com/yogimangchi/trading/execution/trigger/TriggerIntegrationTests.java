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
