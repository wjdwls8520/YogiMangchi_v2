package com.yogimangchi.trading.binance.candle;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.marketdata.candle.CandleInterval;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import static org.assertj.core.api.Assertions.*;

class BinanceCandleClientTests {
    private HttpServer server;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final AtomicInteger requests = new AtomicInteger();
    private volatile String query;
    private volatile int status = 200;
    private volatile long delayMillis;
    private volatile long bodyDelayMillis;
    private volatile String body = "[" + BinanceCandleParserTests.row(BinanceCandleParserTests.OPEN, 86400000) + "]";
    private BinanceCandleClient client;
    private final BinanceSubscriptionTarget target = new BinanceSubscriptionTarget(11L, "PEPE", "1000PEPEUSDT", 1000);

    @BeforeEach void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(executor);
        server.createContext("/fapi/v1/markPriceKlines", exchange -> {
            requests.incrementAndGet(); query = exchange.getRequestURI().getRawQuery();
            try {
                if (delayMillis > 0) Thread.sleep(delayMillis);
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Retry-After", "60");
                exchange.sendResponseHeaders(status, bytes.length);
                if (bodyDelayMillis > 0) Thread.sleep(bodyDelayMillis);
                exchange.getResponseBody().write(bytes);
            } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            catch (java.io.IOException ignored) { /* Timeout intentionally closes the test client's socket. */ }
            finally { exchange.close(); }
        });
        server.start();
        client = makeClient(Duration.ofSeconds(2));
    }
    @AfterEach void stop() { server.stop(0); executor.shutdownNow(); }

    @Test void usesMarkPriceEndpointProviderMappingAndOneCanonicalLimit() {
        var result = client.load(target, CandleInterval.ONE_DAY);
        assertThat(query).isEqualTo("symbol=1000PEPEUSDT&interval=1d&limit=500");
        assertThat(result.get(0).close()).isEqualTo("0.0000145");
        assertThat(requests).hasValue(1);
    }
    @Test void historicalQueryUsesExclusiveMillisecondEndTimeAndKeepsNormalization() {
        Instant before = Instant.parse("2026-10-16T00:00:00.123Z");
        var result = client.load(target, CandleInterval.ONE_DAY, before);
        assertThat(query).isEqualTo("symbol=1000PEPEUSDT&interval=1d&limit=500&endTime=" + (before.toEpochMilli() - 1));
        assertThat(result.get(0).close()).isEqualTo("0.0000145");
        assertThat(requests).hasValue(1);
    }
    @Test void emptyHistoricalResponseIsAValidPage() {
        body = "[]";
        assertThat(client.load(target, CandleInterval.ONE_DAY, Instant.parse("2000-01-01T00:00:00Z"))).isEmpty();
        assertThat(requests).hasValue(1);
    }
    @Test void providerFailureDoesNotRetry() {
        status = 500;
        failure(client, ErrorCode.CANDLE_PROVIDER_FAILURE);
        failure(client, ErrorCode.CANDLE_UNAVAILABLE);
        assertThat(requests).hasValue(1);
    }
    @Test void malformedSuccessIsAProviderFailure() { body = "{\"code\":-1121}"; failure(client, ErrorCode.CANDLE_PROVIDER_FAILURE); }
    @Test void providerTimeoutIsBoundedAndDoesNotRetry() {
        delayMillis = 1000;
        var impatient = makeClient(Duration.ofMillis(100));
        Assertions.assertTimeoutPreemptively(Duration.ofSeconds(2), () -> failure(impatient, ErrorCode.CANDLE_PROVIDER_TIMEOUT));
        assertThat(requests.get()).isLessThanOrEqualTo(1);
    }
    @Test void rateLimitPausesLaterRequestsInsteadOfRetryingIntoABan() {
        status = 429;
        failure(client, ErrorCode.CANDLE_UNAVAILABLE);
        failure(client, ErrorCode.CANDLE_UNAVAILABLE);
        assertThat(requests).hasValue(1);
    }
    @Test void timeoutAlsoCoversAStalledBodyAfterSuccessfulHeaders() {
        bodyDelayMillis = 1000;
        failure(makeClient(Duration.ofMillis(100)), ErrorCode.CANDLE_PROVIDER_TIMEOUT);
    }
    @Test void oversizedResponseIsRejected() {
        body = " ".repeat(1_000_001) + "[]";
        failure(client, ErrorCode.CANDLE_PROVIDER_FAILURE);
    }
    private BinanceCandleClient makeClient(Duration timeout) {
        return new BinanceCandleClient(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build(), new ObjectMapper(),
                URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/fapi/v1/markPriceKlines"), timeout);
    }
    private void failure(BinanceCandleClient client, ErrorCode code) {
        assertThatThrownBy(() -> client.load(target, CandleInterval.ONE_DAY)).isInstanceOfSatisfying(
                BusinessException.class, error -> assertThat(error.getCode()).isEqualTo(code));
    }
}
