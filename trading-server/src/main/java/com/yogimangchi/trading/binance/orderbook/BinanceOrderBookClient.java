package com.yogimangchi.trading.binance.orderbook;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTargetLoader;
import com.yogimangchi.trading.marketdata.orderbook.OrderBookSnapshot;
import com.yogimangchi.trading.marketdata.orderbook.RedisOrderBookStore;
import com.yogimangchi.trading.marketdata.websocket.MarketWebSocketHandler;
import com.yogimangchi.trading.ops.OpsAlertService;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.*;
import java.util.function.*;
import org.slf4j.*;
import org.springframework.beans.factory.ObjectProvider;
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
    private record RawFrame(BinanceOrderBookProtocol protocol, String payload, Instant receivedAt) { }

    private final Supplier<List<BinanceSubscriptionTarget>> targets;
    private final ObjectMapper mapper;
    private final Consumer<OrderBookSnapshot> sink;
    private final BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connect;
    private final ScheduledExecutorService executor;
    private final Clock clock;
    private final LongSupplier nanoTime;
    private final ObjectProvider<OpsAlertService> alerts;
    private final LongPredicate hasViewer;
    private final ConcurrentHashMap<Long, RawFrame> latestRawFrames = new ConcurrentHashMap<>();
    private volatile boolean stopping;
    private volatile Session current;
    private boolean started;
    private int attempts;
    private volatile long reconnectCount;
    private volatile String lastDisconnectReason;
    private ScheduledFuture<?> retry, watchdog;

    @Autowired public BinanceOrderBookClient(BinanceSubscriptionTargetLoader targets, ObjectMapper mapper, RedisOrderBookStore store,
            ObjectProvider<OpsAlertService> alerts, ObjectProvider<MarketWebSocketHandler> wsHandler) {
        this(targets::loadActiveTargets, mapper, store::accept, connector(),
                Executors.newSingleThreadScheduledExecutor(task -> { var thread = new Thread(task, "binance-orderbook"); thread.setDaemon(true); return thread; }),
                Clock.systemUTC(), System::nanoTime, alerts,
                store.isLocalDirect()
                        ? symbolId -> {
                            MarketWebSocketHandler handler = wsHandler != null ? wsHandler.getIfAvailable() : null;
                            return handler == null || handler.hasSubscribers(symbolId);
                        }
                        : symbolId -> true);
        if (store.isLocalDirect()) {
            store.setLazyResolver(this::resolveCachedFrame);
        }
    }
    BinanceOrderBookClient(Supplier<List<BinanceSubscriptionTarget>> targets, ObjectMapper mapper, Consumer<OrderBookSnapshot> sink,
            BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connect, ScheduledExecutorService executor, Clock clock, LongSupplier nanoTime) {
        this(targets, mapper, sink, connect, executor, clock, nanoTime, null, symbolId -> true);
    }
    BinanceOrderBookClient(Supplier<List<BinanceSubscriptionTarget>> targets, ObjectMapper mapper, Consumer<OrderBookSnapshot> sink,
            BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connect, ScheduledExecutorService executor, Clock clock, LongSupplier nanoTime,
            ObjectProvider<OpsAlertService> alerts) {
        this(targets, mapper, sink, connect, executor, clock, nanoTime, alerts, symbolId -> true);
    }
    BinanceOrderBookClient(Supplier<List<BinanceSubscriptionTarget>> targets, ObjectMapper mapper, Consumer<OrderBookSnapshot> sink,
            BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connect, ScheduledExecutorService executor, Clock clock, LongSupplier nanoTime,
            ObjectProvider<OpsAlertService> alerts, LongPredicate hasViewer) {
        this.targets = targets; this.mapper = mapper; this.sink = sink; this.connect = connect;
        this.executor = executor; this.clock = clock; this.nanoTime = nanoTime; this.alerts = alerts;
        this.hasViewer = hasViewer != null ? hasViewer : symbolId -> true;
    }

    /** Lazily parses the latest cached raw frame for a symbol that had 0 viewers until now. */
    Optional<OrderBookSnapshot> resolveCachedFrame(long tradingSymbolId) {
        RawFrame frame = latestRawFrames.remove(tradingSymbolId);
        if (frame == null) return Optional.empty();
        Optional<OrderBookSnapshot> parsed = frame.protocol().parse(frame.payload(), frame.receivedAt());
        return parsed.filter(book -> book.isFreshAt(clock.instant()));
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
        latestRawFrames.clear();
        if (session != null) session.abort();
        attempts = Math.min(31, attempts + 1);
        reconnectCount++;
        long ceiling = Math.min(30000L, 1000L << Math.min(5, attempts - 1));
        long delay = ThreadLocalRandom.current().nextLong(ceiling * 8 / 10, ceiling + 1);
        while (failure instanceof CompletionException && failure.getCause() != null) failure = failure.getCause();
        int httpStatus = 0;
        if (failure instanceof WebSocketHandshakeException handshake) {
            httpStatus = handshake.getResponse().statusCode();
            lastDisconnectReason = "WebSocketHandshakeException httpStatus=" + httpStatus;
            if (httpStatus == 429 || httpStatus == 418) {
                long seconds = 60;
                try { seconds = Long.parseLong(handshake.getResponse().headers().firstValue("Retry-After").orElse("60")); }
                catch (NumberFormatException ignored) { }
                delay = Math.max(60000, Math.min(604800000, TimeUnit.SECONDS.toMillis(Math.min(seconds, 604800))));
                alertOps("binance-orderbook-ws:http-" + httpStatus, "CRITICAL",
                        "Binance OrderBook WS rate-limited/banned (HTTP " + httpStatus + ")",
                        Map.of("httpStatus", httpStatus, "retryMs", delay, "attempts", attempts));
            }
        } else {
            lastDisconnectReason = failure == null ? "health/close" : failure.getClass().getSimpleName();
        }
        if (attempts >= 3) {
            alertOps("binance-orderbook-ws:reconnect", "WARN",
                    "Binance OrderBook WS repeated disconnects",
                    Map.of("attempts", attempts, "reconnectCount", reconnectCount, "reason", lastDisconnectReason));
        }
        log.warn("[Order book] disconnected reason={} retryMs={}", lastDisconnectReason, delay);
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
        latestRawFrames.clear();
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

    public String connectionStatus() {
        if (stopping) {
            return "STOPPING";
        }
        Session session = this.current;
        if (session == null) {
            return "DISCONNECTED";
        }
        return session.healthy ? "CONNECTED" : "CONNECTING";
    }

    public long reconnectCount() {
        return reconnectCount;
    }

    public String lastDisconnectReason() {
        return lastDisconnectReason;
    }

    private void alertOps(String key, String severity, String title, Map<String, Object> details) {
        OpsAlertService alertService = alerts != null ? alerts.getIfAvailable() : null;
        if (alertService != null) {
            alertService.alert(key, severity, title, details);
        }
    }

    private final class Session implements WebSocket.Listener {
        final BinanceOrderBookProtocol protocol;
        final StringBuilder text = new StringBuilder();
        final CompletableFuture<Void> closeReceived = new CompletableFuture<>();
        volatile WebSocket socket;
        CompletableFuture<WebSocket> handshake;
        long opened, lastData;
        volatile boolean healthy;
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
                    String raw = text.toString(); text.setLength(0);
                    Instant receivedAt = clock.instant();
                    if (healthy) {
                        var targetId = protocol.resolveTargetSymbolId(raw);
                        if (targetId.isPresent() && !hasViewer.test(targetId.getAsLong())) {
                            latestRawFrames.put(targetId.getAsLong(), new RawFrame(protocol, raw, receivedAt));
                            lastData = nanoTime.getAsLong();
                            ws.request(1);
                            return;
                        }
                        if (targetId.isPresent()) {
                            latestRawFrames.remove(targetId.getAsLong());
                        }
                    }
                    var book = protocol.parse(raw, receivedAt);
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
