package com.yogimangchi.trading.binance.orderbook;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTargetLoader;
import com.yogimangchi.trading.marketdata.orderbook.OrderBookSnapshot;
import com.yogimangchi.trading.marketdata.orderbook.RedisOrderBookStore;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.List;
import java.util.concurrent.*;
import java.util.function.*;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** Separate public depth connection; no dependency on Mark Price state or execution health. */
@Component
@ConditionalOnProperty(name = "binance.order-book.enabled", havingValue = "true", matchIfMissing = true)
public class BinanceOrderBookClient {
    private static final Logger log = LoggerFactory.getLogger(BinanceOrderBookClient.class);
    private final Supplier<List<BinanceSubscriptionTarget>> targets;
    private final ObjectMapper mapper;
    private final Consumer<OrderBookSnapshot> sink;
    private final BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connect;
    private final ScheduledExecutorService executor;
    private final Clock clock;
    private final LongSupplier nanoTime;
    private volatile boolean stopping;
    private volatile Session current;
    private boolean started;
    private int attempts;
    private ScheduledFuture<?> retry, watchdog;

    @Autowired public BinanceOrderBookClient(BinanceSubscriptionTargetLoader targets, ObjectMapper mapper, RedisOrderBookStore store) {
        this(targets::loadActiveTargets, mapper, store::accept, connector(),
                Executors.newSingleThreadScheduledExecutor(task -> { var thread = new Thread(task, "binance-orderbook"); thread.setDaemon(true); return thread; }),
                Clock.systemUTC(), System::nanoTime);
    }
    BinanceOrderBookClient(Supplier<List<BinanceSubscriptionTarget>> targets, ObjectMapper mapper, Consumer<OrderBookSnapshot> sink,
            BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connect, ScheduledExecutorService executor, Clock clock, LongSupplier nanoTime) {
        this.targets = targets; this.mapper = mapper; this.sink = sink; this.connect = connect;
        this.executor = executor; this.clock = clock; this.nanoTime = nanoTime;
    }
    private static BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connector() {
        var http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
        return (uri, listener) -> http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(8)).buildAsync(uri, listener);
    }
    @EventListener(ApplicationReadyEvent.class) public synchronized void start() {
        if (started || stopping) return;
        started = true;
        execute(() -> {
            watchdog = executor.scheduleWithFixedDelay(this::checkHealth, 1, 1, TimeUnit.SECONDS);
            attempt();
        });
    }
    private void attempt() {
        retry = null;
        if (stopping || current != null) return;
        try {
            var active = targets.get();
            if (stopping) return;
            if (active.isEmpty()) { retry = executor.schedule(this::attempt, 30, TimeUnit.SECONDS); return; }
            var session = new Session(new BinanceOrderBookProtocol(active, mapper));
            current = session;
            session.opened = session.lastData = nanoTime.getAsLong();
            session.handshake = connect.apply(session.protocol.uri(), session);
            if (stopping) session.abort();
            session.handshake.whenComplete((socket, failure) -> {
                if (failure != null) execute(() -> failed(session, failure));
                else if (stopping || current != session) socket.abort();
            });
        } catch (RuntimeException failure) { failed(current, failure); }
    }
    private void failed(Session session, Throwable failure) {
        if (stopping || current != session || retry != null) return;
        current = null;
        if (session != null) session.abort();
        attempts = Math.min(31, attempts + 1);
        long ceiling = Math.min(30000L, 1000L << Math.min(5, attempts - 1));
        long delay = ThreadLocalRandom.current().nextLong(ceiling * 8 / 10, ceiling + 1);
        while (failure instanceof CompletionException && failure.getCause() != null) failure = failure.getCause();
        if (failure instanceof WebSocketHandshakeException handshake && (handshake.getResponse().statusCode() == 429 || handshake.getResponse().statusCode() == 418)) {
            long seconds = 60;
            try { seconds = Long.parseLong(handshake.getResponse().headers().firstValue("Retry-After").orElse("60")); }
            catch (NumberFormatException ignored) { }
            delay = Math.max(60000, Math.min(604800000, TimeUnit.SECONDS.toMillis(Math.min(seconds, 604800))));
        }
        log.warn("[Order book] disconnected reason={} retryMs={}", failure == null ? "health/close" : failure.getClass().getSimpleName(), delay);
        retry = executor.schedule(this::attempt, delay, TimeUnit.MILLISECONDS);
    }
    private void checkHealth() {
        var session = current;
        if (session == null || stopping) return;
        long now = nanoTime.getAsLong();
        if (now - session.lastData >= TimeUnit.SECONDS.toNanos(15)
                || now - session.opened >= TimeUnit.MINUTES.toNanos(1430)) failed(session, null);
    }
    private void execute(Runnable task) {
        if (stopping) return;
        try { executor.execute(task); } catch (RejectedExecutionException ignored) { }
    }
    @PreDestroy public void stop() {
        stopping = true;
        if (retry != null) retry.cancel(false);
        if (watchdog != null) watchdog.cancel(false);
        var session = current;
        try {
            if (session != null && session.socket != null) {
                session.socket.sendClose(WebSocket.NORMAL_CLOSURE, "Application shutdown")
                        .thenCompose(ignored -> session.closeReceived).orTimeout(2, TimeUnit.SECONDS).join();
            }
        } catch (RuntimeException failure) { log.debug("[Order book] shutdown acknowledgement unavailable"); }
        finally {
            if (session != null) session.abort();
            executor.shutdownNow();
        }
    }

    private final class Session implements WebSocket.Listener {
        final BinanceOrderBookProtocol protocol;
        final StringBuilder text = new StringBuilder();
        final CompletableFuture<Void> closeReceived = new CompletableFuture<>();
        volatile WebSocket socket;
        CompletableFuture<WebSocket> handshake;
        long opened, lastData;
        boolean healthy;
        Session(BinanceOrderBookProtocol protocol) { this.protocol = protocol; }
        void abort() {
            if (socket != null) socket.abort();
            if (handshake != null && !handshake.isDone()) handshake.cancel(true);
        }
        @Override public void onOpen(WebSocket ws) {
            socket = ws;
            if (stopping || current != this) { ws.abort(); return; }
            execute(() -> { opened = lastData = nanoTime.getAsLong(); ws.request(1); });
        }
        @Override public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            if (data.length() > 65_536) { execute(() -> failed(this, null)); return null; }
            String fragment = data.toString();
            execute(() -> {
                if (current != this || stopping) { ws.abort(); return; }
                if (text.length() + fragment.length() > 65_536) { failed(this, null); return; }
                text.append(fragment);
                if (last) {
                    var book = protocol.parse(text.toString(), clock.instant()); text.setLength(0);
                    if (book.isPresent()) {
                        lastData = nanoTime.getAsLong();
                        if (!healthy) { healthy = true; attempts = 0; log.info("[Order book] connected; receiving top-20 snapshots"); }
                        try { sink.accept(book.get()); } catch (RuntimeException failure) { log.debug("[Order book] snapshot enqueue unavailable"); }
                    }
                }
                ws.request(1);
            });
            return null;
        }
        // JDK 17 responds to provider Ping frames with Pong automatically.
        @Override public CompletionStage<?> onClose(WebSocket ws, int status, String reason) {
            closeReceived.complete(null); execute(() -> failed(this, null)); return null;
        }
        @Override public void onError(WebSocket ws, Throwable failure) { execute(() -> failed(this, failure)); }
    }
}
