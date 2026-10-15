package com.yogimangchi.trading.marketdata.websocket;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.marketdata.orderbook.OrderBookSnapshot;
import com.yogimangchi.trading.marketdata.orderbook.RedisOrderBookStore;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.net.http.WebSocketHandshakeException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"binance.mark-price.enabled=false", "binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
class MarketWebSocketIntegrationTests {
    @LocalServerPort private int port;
    @Autowired private ObjectMapper mapper;
    @Autowired private LatestPriceStore prices;
    @Autowired private RedisMarketDataBridge redis;
    @Autowired private MarketWebSocketHandler handler;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private RedisOrderBookStore orderBooks;
    @Autowired private org.springframework.data.redis.core.StringRedisTemplate sharedRedis;
    private static final java.util.concurrent.atomic.AtomicLong bookSequence = new java.util.concurrent.atomic.AtomicLong(1000);
    private final List<Client> connections = new ArrayList<>();
    private long btc;
    private long eth;

    @BeforeEach
    void setUp() {
        btc = jdbc.queryForObject("select id from trading.trading_symbol where symbol = 'BTC'", Long.class);
        eth = jdbc.queryForObject("select id from trading.trading_symbol where symbol = 'ETH'", Long.class);
        sharedRedis.delete(List.of(RedisOrderBookStore.snapshotKey(btc), RedisOrderBookStore.watermarkKey(btc),
                RedisOrderBookStore.snapshotKey(eth), RedisOrderBookStore.watermarkKey(eth)));
        await().atMost(Duration.ofSeconds(10)).until(() -> redis.health().state() == RedisMarketDataBridge.State.HEALTHY);
        prices.beginSubscription(Set.of(btc, eth));
        update(btc, "100.123456789012345678");
        await().atMost(Duration.ofSeconds(5)).until(() -> redis.readSharedSnapshot(btc).status() == LatestPriceStore.Status.FRESH);
    }

    @AfterEach
    void cleanUp() {
        for (Client client : connections) {
            client.socket.sendClose(WebSocket.NORMAL_CLOSURE, "Test complete").join();
        }
        await().atMost(Duration.ofSeconds(5)).until(() -> handler.connectedClients() == 0);
    }

    @Test
    void providerClockSkewStillDeliversFreshSnapshotAndLiveMarketPricesThroughRedis() throws Exception {
        Instant receivedAt = Instant.now();
        var first = new LatestMarkPrice(btc, new BigDecimal("110"), receivedAt.plusSeconds(2), receivedAt);
        assertThat(prices.update(first)).isTrue();
        await().atMost(Duration.ofSeconds(3)).until(() -> redis.readSharedSnapshot(btc).latestPrice().map(first::equals).orElse(false));
        Client client = connect(null);
        client.next("CONNECTED");
        client.send("{\"type\":\"SUBSCRIBE\",\"tradingSymbolIds\":[" + btc + "]}");
        client.next("SUBSCRIBED");
        assertThat(client.next("SNAPSHOT").at("/prices/0/status").asText()).isEqualTo("FRESH");
        for (int i = 1; i <= 3; i++) {
            Instant receipt = Instant.now();
            var next = new LatestMarkPrice(btc, BigDecimal.valueOf(110 + i), receipt.plusSeconds(6).plusMillis(i), receipt);
            assertThat(prices.update(next)).isTrue();
            JsonNode live = client.next("MARKET_PRICE");
            assertThat(live.path("price").asText()).isEqualTo(Integer.toString(110 + i));
            assertThat(live.path("status").asText()).isEqualTo("FRESH");
            assertThat(prices.marketClockSnapshot().status().name()).isEqualTo("DEGRADED");
        }
        Instant rejectAt = Instant.now();
        assertThat(prices.update(new LatestMarkPrice(btc, new BigDecimal("999"), rejectAt.plusSeconds(11), rejectAt))).isFalse();
        assertStatus(client.next("MARKET_STATUS"), "UNAVAILABLE");
        client.noMessageOfType("MARKET_PRICE", Duration.ofMillis(200));
    }

    @Test
    void publicSocketDeliversSnapshotAndRedisLivePricesWithoutDuplicatesAndCleansUp() throws Exception {
        Client client = connect(null);
        assertThat(client.next("CONNECTED").path("maxSubscriptions").intValue()).isEqualTo(32);
        client.send("{\"type\":\"SUBSCRIBE\",\"tradingSymbolIds\":[" + btc + "," + btc + "]}");
        assertThat(client.next("SUBSCRIBED").path("tradingSymbolIds")).hasSize(1);
        JsonNode snapshot = client.next("SNAPSHOT").path("prices").get(0);
        assertThat(snapshot.path("tradingSymbolId").longValue()).isEqualTo(btc);
        assertThat(snapshot.path("price").textValue()).isEqualTo("100.123456789012345678");
        assertThat(snapshot.path("status").textValue()).isEqualTo("FRESH");
        assertThat(snapshot.has("providerSymbol")).isFalse();
        assertThat(snapshot.has("providerMarkPrice")).isFalse();

        update(btc, "101.25");
        JsonNode live = client.next("MARKET_PRICE");
        assertThat(live.path("tradingSymbolId").longValue()).isEqualTo(btc);
        assertThat(live.path("price").textValue()).isEqualTo("101.25");
        assertThat(live.path("eventTime").isTextual()).isTrue();
        assertThat(live.path("receivedAt").isTextual()).isTrue();
        assertThat(redis.readSharedSnapshot(btc).latestPrice().orElseThrow().domainMarkPrice()).isEqualByComparingTo("101.25");
        client.noMessageOfType("MARKET_PRICE", Duration.ofMillis(300));

        update(eth, "200");
        client.noMessageOfType("MARKET_PRICE", Duration.ofMillis(300));
        client.send("{\"type\":\"SUBSCRIBE\",\"tradingSymbolIds\":[" + btc + "]}");
        assertThat(client.next("SUBSCRIBED").path("tradingSymbolIds")).hasSize(1);
        assertThat(client.next("SNAPSHOT").path("prices").get(0).path("price").textValue()).isEqualTo("101.25");
        client.send("{\"type\":\"UNSUBSCRIBE\",\"tradingSymbolIds\":[" + btc + "]}");
        assertThat(client.next("UNSUBSCRIBED").path("tradingSymbolIds")).isEmpty();
        update(btc, "102");
        client.send("{\"type\":\"PING\"}");
        assertThat(client.next("PONG").path("serverTime").isTextual()).isTrue();
        client.noMessageOfType("MARKET_PRICE", Duration.ofMillis(300));
    }

    @Test
    void invalidUnknownInactiveAndOversizedSubscriptionsAreRejectedAtomically() throws Exception {
        Client client = connect(null);
        client.next("CONNECTED");
        client.send("not json");
        assertThat(client.next("ERROR").path("code").textValue()).isEqualTo("INVALID_COMMAND");
        client.send("{\"type\":\"UNKNOWN\"}");
        assertThat(client.next("ERROR").path("code").textValue()).isEqualTo("UNKNOWN_COMMAND");
        for (String ids : List.of("[]", "[0]", "[\"1\"]", "[true]", "[1.5]", "[9223372036854775808]")) {
            client.send("{\"type\":\"SUBSCRIBE\",\"tradingSymbolIds\":" + ids + "}");
            assertThat(client.next("ERROR").path("code").textValue()).isEqualTo("INVALID_COMMAND");
        }
        client.send("{\"type\":\"SUBSCRIBE\",\"tradingSymbolIds\":[" + btc + ",999999]}");
        assertThat(client.next("ERROR").path("code").textValue()).isEqualTo("SYMBOL_NOT_AVAILABLE");
        jdbc.update("update trading.trading_symbol set status = 'INACTIVE' where id = ?", eth);
        try {
            client.send("{\"type\":\"SUBSCRIBE\",\"tradingSymbolIds\":[" + eth + "]}");
            assertThat(client.next("ERROR").path("code").textValue()).isEqualTo("SYMBOL_NOT_AVAILABLE");
        } finally {
            jdbc.update("update trading.trading_symbol set status = 'ACTIVE' where id = ?", eth);
        }
        client.send(mapper.writeValueAsString(java.util.Map.of("type", "SUBSCRIBE", "tradingSymbolIds",
                java.util.Collections.nCopies(33, btc))));
        JsonNode error = client.next("ERROR");
        assertThat(error.path("code").textValue()).isEqualTo("INVALID_COMMAND");
        assertThat(error.has("trace")).isFalse();
        assertThat(error.has("exception")).isFalse();
        client.send("{\"type\":\"UNSUBSCRIBE\",\"tradingSymbolIds\":[" + btc + "]}");
        assertThat(client.next("UNSUBSCRIBED").path("tradingSymbolIds")).isEmpty();
    }

    @Test
    void connectionStatesDoNotRecoverUntilValidPriceAndSilenceBecomesStale() throws Exception {
        Client client = connect(null);
        client.next("CONNECTED");
        client.send("{\"type\":\"SUBSCRIBE\",\"tradingSymbolIds\":[" + btc + "]}");
        client.next("SNAPSHOT");
        prices.markUnavailable();
        assertStatus(client.next("MARKET_STATUS"), "UNAVAILABLE");
        prices.beginSubscription(Set.of(btc, eth));
        assertStatus(client.next("MARKET_STATUS"), "RECONNECTING");
        client.noMessageOfType("MARKET_STATUS", Duration.ofMillis(300));
        update(btc, "103");
        assertStatus(client.next("MARKET_STATUS"), "RECOVERED");
        assertThat(client.next("MARKET_PRICE").path("price").textValue()).isEqualTo("103");
        assertStatus(client.next("MARKET_STATUS", Duration.ofSeconds(8)), "STALE");
        client.noMessageOfType("MARKET_PRICE", Duration.ofMillis(200));
    }

    @Test
    void configuredBrowserOriginIsAllowedAndUnknownOriginIsRejected() throws Exception {
        assertThatThrownBy(() -> connect("https://untrusted.example"))
                .hasCauseInstanceOf(WebSocketHandshakeException.class)
                .satisfies(ex -> assertThat(((WebSocketHandshakeException) ex.getCause()).getResponse().statusCode()).isEqualTo(403));
        Client client = connect("http://localhost:3000");
        assertThat(client.next("CONNECTED").path("type").textValue()).isEqualTo("CONNECTED");
    }

    private void assertStatus(JsonNode message, String status) {
        assertThat(message.path("status").textValue()).isEqualTo(status);
        assertThat(message.path("affectedTradingSymbolIds").get(0).longValue()).isEqualTo(btc);
    }

    @Test void orderBookSubscribeImmediatelyReturnsFreshRedisSnapshotAndThenOnlySelectedUpdates() throws Exception {
        var first = book(btc, "100", "101");
        orderBooks.accept(first);
        await().atMost(Duration.ofSeconds(5)).until(() -> orderBooks.read(Set.of(btc)).containsKey(btc));
        Client client = connect(null); client.next("CONNECTED");
        client.send("{\"type\":\"SUBSCRIBE\",\"tradingSymbolIds\":[" + btc + "]}");
        client.next("SUBSCRIBED"); client.next("SNAPSHOT");
        var snapshot = client.next("ORDER_BOOK");
        assertThat(snapshot.path("status").asText()).isEqualTo("FRESH");
        assertThat(snapshot.path("version").asInt()).isEqualTo(1);
        assertThat(snapshot.path("tradingSymbolId").asLong()).isEqualTo(btc);
        assertThat(snapshot.at("/bids/0/price").asText()).isEqualTo("100");
        assertThat(snapshot.at("/bids/0/quantity").isTextual()).isTrue();
        assertThat(snapshot.has("providerSymbol") || snapshot.has("providerUpdateId") || snapshot.has("multiplier")).isFalse();
        orderBooks.accept(book(eth, "200", "201"));
        client.noMessageOfType("ORDER_BOOK", Duration.ofMillis(200));
        orderBooks.accept(book(btc, "101", "102"));
        assertThat(client.next("ORDER_BOOK").at("/bids/0/price").asText()).isEqualTo("101");
        update(btc, "102");
        assertThat(client.next("MARKET_PRICE").path("price").asText()).isEqualTo("102");
        client.send("{\"type\":\"UNSUBSCRIBE\",\"tradingSymbolIds\":[" + btc + "]}");
        client.next("UNSUBSCRIBED");
        orderBooks.accept(book(btc, "102", "103"));
        client.noMessageOfType("ORDER_BOOK", Duration.ofMillis(200));
    }

    @Test void staleOrderBookClearsLevelsWhileMarkPricesContinueNormally() throws Exception {
        orderBooks.accept(book(btc, "100", "101"));
        await().atMost(Duration.ofSeconds(5)).until(() -> orderBooks.read(Set.of(btc)).containsKey(btc));
        Client client = connect(null); client.next("CONNECTED");
        client.send("{\"type\":\"SUBSCRIBE\",\"tradingSymbolIds\":[" + btc + "]}");
        client.next("SUBSCRIBED"); client.next("SNAPSHOT"); client.next("ORDER_BOOK");
        var stale = client.next("ORDER_BOOK", Duration.ofSeconds(5));
        assertThat(stale.path("status").asText()).isEqualTo("STALE");
        assertThat(stale.path("bids")).isEmpty(); assertThat(stale.path("asks")).isEmpty();
        update(btc, "105");
        assertThat(client.next("MARKET_PRICE").path("status").asText()).isEqualTo("FRESH");
    }

    private OrderBookSnapshot book(long id, String bid, String ask) {
        Instant now = Instant.now();
        return new OrderBookSnapshot(id, List.of(new OrderBookSnapshot.Level(bid, "1.25")),
                List.of(new OrderBookSnapshot.Level(ask, "2.5")), bookSequence.incrementAndGet(), now, now);
    }

    private void update(long id, String price) {
        Instant now = Instant.now();
        Instant eventTime = prices.find(id).latestPrice().map(LatestMarkPrice::eventTime)
                .filter(previous -> !previous.isBefore(now)).map(previous -> previous.plusMillis(1)).orElse(now);
        assertThat(prices.update(new LatestMarkPrice(id, new BigDecimal(price), eventTime, now))).isTrue();
    }

    private Client connect(String origin) {
        Client client = new Client();
        WebSocket.Builder builder = HttpClient.newHttpClient().newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5));
        if (origin != null) {
            builder.header("Origin", origin);
        }
        client.socket = builder.buildAsync(URI.create("ws://localhost:" + port + "/ws/market"), client).join();
        connections.add(client);
        return client;
    }

    private class Client implements WebSocket.Listener {
        private final BlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
        private final StringBuilder fragments = new StringBuilder();
        private WebSocket socket;

        @Override
        public void onOpen(WebSocket webSocket) {
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            fragments.append(data);
            if (last) {
                try {
                    messages.add(mapper.readTree(fragments.toString()));
                    fragments.setLength(0);
                } catch (Exception ex) {
                    return CompletableFuture.failedFuture(ex);
                }
            }
            webSocket.request(1);
            return CompletableFuture.completedFuture(null);
        }

        private void send(String json) {
            socket.sendText(json, true).join();
        }

        private JsonNode next(String type) throws InterruptedException {
            return next(type, Duration.ofSeconds(5));
        }

        private JsonNode next(String type, Duration timeout) throws InterruptedException {
            long deadline = System.nanoTime() + timeout.toNanos();
            List<JsonNode> observed = new ArrayList<>();
            while (System.nanoTime() < deadline) {
                JsonNode message = messages.poll(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
                if (message == null) {
                    break;
                }
                observed.add(message);
                if (type.equals(message.path("type").textValue())) {
                    return message;
                }
            }
            throw new AssertionError("Expected " + type + ", observed " + observed);
        }

        private void noMessageOfType(String type, Duration duration) throws InterruptedException {
            long deadline = System.nanoTime() + duration.toNanos();
            while (System.nanoTime() < deadline) {
                JsonNode message = messages.poll(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
                if (message == null) {
                    return;
                }
                assertThat(message.path("type").textValue()).isNotEqualTo(type);
            }
        }
    }
}
