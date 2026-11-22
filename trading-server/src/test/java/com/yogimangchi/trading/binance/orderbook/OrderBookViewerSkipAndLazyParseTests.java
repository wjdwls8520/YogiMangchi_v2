package com.yogimangchi.trading.binance.orderbook;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.marketdata.orderbook.OrderBookSnapshot;
import java.net.http.WebSocket;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class OrderBookViewerSkipAndLazyParseTests {
    private final Instant now = Instant.parse("2026-10-16T00:00:00Z");
    private final List<BinanceSubscriptionTarget> targets = List.of(
            new BinanceSubscriptionTarget(11L, "PEPE", "1000PEPEUSDT", 1000));

    @Test
    void resolvesTargetSymbolWithoutFullTreeParse() {
        var protocol = new BinanceOrderBookProtocol(targets, new ObjectMapper());
        String msg = BinanceOrderBookProtocolTests.message(now);
        assertThat(protocol.resolveTargetSymbolId(msg)).hasValue(11L);
        assertThat(protocol.resolveTargetSymbolId("{\"stream\":\"unknown@depth20@500ms\",\"data\":{}}")).isEmpty();
        assertThat(protocol.resolveTargetSymbolId("{}")).isEmpty();
    }

    @Test
    void skipsParsingWhenSymbolHasZeroViewersAndLazilyParsesOnFirstSubscribe() {
        var listener = new AtomicReference<WebSocket.Listener>();
        var socket = mock(WebSocket.class);
        var seen = new CopyOnWriteArrayList<OrderBookSnapshot>();
        var nanos = new AtomicLong();
        var watched = new AtomicBoolean(false);
        var client = new BinanceOrderBookClient(
                () -> targets,
                new ObjectMapper(),
                seen::add,
                (uri, handler) -> {
                    listener.set(handler);
                    handler.onOpen(socket);
                    return CompletableFuture.completedFuture(socket);
                },
                Executors.newSingleThreadScheduledExecutor(),
                Clock.fixed(now, ZoneOffset.UTC),
                nanos::get,
                null,
                symbolId -> watched.get());
        try {
            client.start();
            await().atMost(Duration.ofSeconds(2)).until(() -> listener.get() != null);

            String firstFrame = BinanceOrderBookProtocolTests.message(now);
            // Initial frame validates stream health once.
            listener.get().onText(socket, firstFrame, true);
            await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
                assertThat(seen).hasSize(1);
                assertThat(client.connectionStatus()).isEqualTo("CONNECTED");
            });

            // Subsequent frames while 0 viewers watch symbol 11 skip parsing and sink delivery,
            // yet keep lastData fresh so health watchdog stays CONNECTED.
            nanos.set(TimeUnit.SECONDS.toNanos(10));
            String idleFrame = firstFrame
                    .replace("\"0.004001\"", "\"0.0040015\"")
                    .replace("\"u\":100", "\"u\":105");
            listener.get().onText(socket, idleFrame, true);
            listener.get().onText(socket, idleFrame, true);
            await().during(Duration.ofMillis(200)).atMost(Duration.ofMillis(400))
                    .untilAsserted(() -> assertThat(seen).hasSize(1));
            assertThat(client.connectionStatus()).isEqualTo("CONNECTED");

            // On first viewer subscribe, lazy resolution parses the cached raw frame immediately.
            var resolved = client.resolveCachedFrame(11L);
            assertThat(resolved).isPresent();
            assertThat(resolved.get().bids().get(0).price()).isEqualTo("0.0000040015");
            assertThat(resolved.get().providerUpdateId()).isEqualTo(105L);
            assertThat(client.resolveCachedFrame(11L)).isEmpty();

            // Once a viewer is active, frames parse and flow directly to sink again.
            watched.set(true);
            listener.get().onText(socket, idleFrame, true);
            await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertThat(seen).hasSize(2));
        } finally {
            client.stop();
        }
    }
}
