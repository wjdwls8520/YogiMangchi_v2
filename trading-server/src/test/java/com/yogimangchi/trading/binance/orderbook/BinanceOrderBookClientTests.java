package com.yogimangchi.trading.binance.orderbook;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.marketdata.orderbook.OrderBookSnapshot;
import java.net.URI;
import java.net.http.WebSocket;
import java.time.*;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.BiFunction;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class BinanceOrderBookClientTests {
    private final Instant now = Instant.parse("2026-10-16T00:00:00Z");
    private final List<BinanceSubscriptionTarget> targets = List.of(new BinanceSubscriptionTarget(11L,"PEPE","1000PEPEUSDT",1000));

    @Test void receivesFragmentedSnapshotsAndHandlesSinkFailureWithoutAffectingTheConnection() throws Exception {
        var listener = new AtomicReference<WebSocket.Listener>();
        var socket = socket(listener);
        var seen = new CopyOnWriteArrayList<OrderBookSnapshot>();
        var client = make((uri, handler) -> { listener.set(handler); handler.onOpen(socket); return CompletableFuture.completedFuture(socket); },
                book -> { seen.add(book); throw new IllegalStateException("optional Redis queue failed"); }, new AtomicLong());
        try {
            client.start(); client.start();
            await().atMost(Duration.ofSeconds(2)).until(() -> listener.get() != null);
            String json = BinanceOrderBookProtocolTests.message(now);
            listener.get().onText(socket, json.substring(0, 30), false);
            listener.get().onText(socket, json.substring(30), true);
            await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertThat(seen).hasSize(1));
            listener.get().onText(socket, json, true);
            await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertThat(seen).hasSize(2));
            assertThat(seen.get(0).bids().get(0).quantity()).isEqualTo("1250.00");
        } finally { client.stop(); }
        verify(socket).sendClose(eq(WebSocket.NORMAL_CLOSURE), anyString());
        verify(socket, atLeastOnce()).abort();
    }
    @Test void connectionFailuresUseBackoffAndStopCancelsRetries() {
        var attempts = new AtomicInteger();
        var client = make((uri, handler) -> { attempts.incrementAndGet(); return CompletableFuture.failedFuture(new java.io.IOException("offline")); },
                ignored -> { }, new AtomicLong());
        client.start();
        await().atMost(Duration.ofSeconds(2)).until(() -> attempts.get() == 1);
        await().during(Duration.ofMillis(250)).atMost(Duration.ofMillis(500)).untilAsserted(() -> assertThat(attempts).hasValue(1));
        await().atMost(Duration.ofSeconds(2)).until(() -> attempts.get() == 2);
        client.stop();
        await().during(Duration.ofMillis(300)).atMost(Duration.ofMillis(500)).untilAsserted(() -> assertThat(attempts).hasValue(2));
    }
    @Test void staleSessionReconnectsAndLateFramesCannotEnterTheNewSession() {
        var listeners = new CopyOnWriteArrayList<WebSocket.Listener>();
        var socket = mock(WebSocket.class);
        var seen = new CopyOnWriteArrayList<OrderBookSnapshot>();
        var nanos = new AtomicLong();
        var client = make((uri, handler) -> { listeners.add(handler); handler.onOpen(socket); return CompletableFuture.completedFuture(socket); }, seen::add, nanos);
        try {
            client.start();
            await().atMost(Duration.ofSeconds(2)).until(() -> listeners.size() == 1);
            nanos.set(TimeUnit.SECONDS.toNanos(16));
            await().atMost(Duration.ofSeconds(4)).until(() -> listeners.size() == 2);
            listeners.get(0).onText(socket, BinanceOrderBookProtocolTests.message(now), true);
            listeners.get(1).onText(socket, BinanceOrderBookProtocolTests.message(now), true);
            await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertThat(seen).hasSize(1));
        } finally { client.stop(); }
    }
    private WebSocket socket(AtomicReference<WebSocket.Listener> listener) {
        var socket = mock(WebSocket.class);
        when(socket.sendClose(anyInt(), anyString())).thenAnswer(call -> {
            listener.get().onClose(socket, 1000, "ack"); return CompletableFuture.completedFuture(socket);
        });
        return socket;
    }
    private BinanceOrderBookClient make(BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connector,
            java.util.function.Consumer<OrderBookSnapshot> sink, AtomicLong nanos) {
        return new BinanceOrderBookClient(() -> targets, new ObjectMapper(), sink, connector,
                Executors.newSingleThreadScheduledExecutor(), Clock.fixed(now, ZoneOffset.UTC), nanos::get);
    }
}
