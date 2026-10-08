package com.yogimangchi.trading.binance.markprice;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTargetLoader;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.net.http.WebSocketHandshakeException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiFunction;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "binance.mark-price.enabled", havingValue = "true", matchIfMissing = true)
public class BinanceMarkPriceClient {

    private static final Logger log = LoggerFactory.getLogger(BinanceMarkPriceClient.class);
    private static final long STALE_NANOS = Duration.ofSeconds(15).toNanos();
    private static final long ROTATE_NANOS = Duration.ofMinutes(1430).toNanos();
    private static final int MAX_MESSAGE_CHARS = 16_384;

    enum State { CONNECTING, CONNECTED, DISCONNECTED, RECONNECTING }

    private final Supplier<List<BinanceSubscriptionTarget>> loadTargets;
    private final ObjectMapper mapper;
    private final BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connect;
    private final ScheduledExecutorService executor;
    private final Clock clock;
    private final LongSupplier nanoTime;
    private final ReconnectBackoff backoff;
    private final boolean logPrices;
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean stopping = new AtomicBoolean();

    // Lifecycle mutations run on one executor. Identity checks discard callbacks from old sessions.
    private volatile Session current;
    private State state = State.DISCONNECTED;
    private ScheduledFuture<?> retry;
    private ScheduledFuture<?> watchdog;
    private int retryAttempt;
    private Long disconnectedAt;
    private Instant lastReceivedAt;
    private long receivedEvents;
    private long rejectedEvents;
    private long previousEvents;
    private long previousStatsAt;

    @Autowired
    public BinanceMarkPriceClient(BinanceSubscriptionTargetLoader loader, ObjectMapper mapper,
            @Value("${binance.mark-price.log-prices:false}") boolean logPrices) {
        this(loader::loadActiveTargets, mapper, connector(),
                Executors.newSingleThreadScheduledExecutor(task -> {
                    Thread thread = new Thread(task, "binance-mark-price");
                    thread.setDaemon(true);
                    return thread;
                }), Clock.systemUTC(), System::nanoTime,
                new ReconnectBackoff(() -> ThreadLocalRandom.current().nextDouble()), logPrices);
    }

    BinanceMarkPriceClient(Supplier<List<BinanceSubscriptionTarget>> loadTargets, ObjectMapper mapper,
            BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connect,
            ScheduledExecutorService executor, Clock clock, LongSupplier nanoTime,
            ReconnectBackoff backoff, boolean logPrices) {
        this.loadTargets = loadTargets;
        this.mapper = mapper;
        this.connect = connect;
        this.executor = executor;
        this.clock = clock;
        this.nanoTime = nanoTime;
        this.backoff = backoff;
        this.logPrices = logPrices;
    }

    private static BiFunction<URI, WebSocket.Listener, CompletableFuture<WebSocket>> connector() {
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        return (uri, listener) -> client.newWebSocketBuilder()
                .connectTimeout(Duration.ofSeconds(10)).buildAsync(uri, listener);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        if (stopping.get() || !started.compareAndSet(false, true)) {
            return;
        }
        execute(() -> {
            previousStatsAt = nanoTime.getAsLong();
            watchdog = executor.scheduleWithFixedDelay(this::checkHealth, 5, 5, TimeUnit.SECONDS);
            attemptConnection();
        }, null);
    }

    private void attemptConnection() {
        retry = null;
        if (stopping.get() || current != null) {
            return;
        }
        state = retryAttempt == 0 ? State.CONNECTING : State.RECONNECTING;
        log.info("[Binance WS] {} reconnectAttempt={}", state, retryAttempt);
        try {
            List<BinanceSubscriptionTarget> targets = loadTargets.get();
            if (stopping.get()) {
                return;
            }
            if (targets.isEmpty()) {
                state = State.DISCONNECTED;
                log.info("[Binance WS] No ACTIVE Binance symbols; checking again in 30s");
                retry = executor.schedule(this::attemptConnection, 30, TimeUnit.SECONDS);
                return;
            }
            Session session = new Session(new BinanceMarkPriceProtocol(targets, mapper));
            current = session;
            session.handshake = connect.apply(session.protocol.uri(), session);
            session.handshake.whenComplete((socket, error) -> {
                if (error != null) {
                    execute(() -> failed(session, "handshake error=" + errorDescription(error)), null);
                } else if (stopping.get() || current != session) {
                    socket.abort();
                }
            });
        } catch (RuntimeException exception) {
            failed(current, "subscription/connect error=" + exception.getClass().getSimpleName());
        }
    }

    private void opened(Session session, WebSocket socket) {
        if (stopping.get() || current != session) {
            socket.abort();
            return;
        }
        session.socket = socket;
        session.openedAt = nanoTime.getAsLong();
        session.lastDataAt = session.openedAt;
        state = State.CONNECTED;
        log.info("[Binance WS] CONNECTED streams={} reconnectAttempt={} awaitingValidPrice=true",
                session.protocol.size(), retryAttempt);
        socket.request(1);
    }

    private void failed(Session session, String reason) {
        if (stopping.get() || current != session || retry != null) {
            return;
        }
        current = null;
        if (session != null) {
            session.abort();
        }
        state = State.DISCONNECTED;
        if (disconnectedAt == null) {
            disconnectedAt = nanoTime.getAsLong();
        }
        retryAttempt = Math.min(retryAttempt + 1, 31);
        long delay = backoff.delayMillis(retryAttempt);
        log.warn("[Binance WS] DISCONNECTED reason={} reconnectAttempt={} nextRetryMs={}",
                reason, retryAttempt, delay);
        state = State.RECONNECTING;
        retry = executor.schedule(this::attemptConnection, delay, TimeUnit.MILLISECONDS);
    }

    private void checkHealth() {
        if (stopping.get()) {
            return;
        }
        long now = nanoTime.getAsLong();
        Session session = current;
        if (session != null && state == State.CONNECTED) {
            if (now - session.lastDataAt >= STALE_NANOS) {
                failed(session, "STALE: no valid Mark Price for 15s");
            } else if (now - session.openedAt >= ROTATE_NANOS) {
                failed(session, "planned rotation before 24h connection lifetime");
            }
        }
        long elapsed = now - previousStatsAt;
        if (elapsed >= Duration.ofSeconds(10).toNanos()) {
            log.info("[Binance WS] stats state={} subscribedSymbols={} receivedEvents={} eventsPerSecond={}"
                            + " rejectedEvents={} lastReceivedAt={}",
                    state, current == null ? 0 : current.protocol.size(), receivedEvents,
                    Math.round((receivedEvents - previousEvents) * 1_000_000_000.0 / elapsed * 10) / 10.0,
                    rejectedEvents, lastReceivedAt);
            previousStatsAt = now;
            previousEvents = receivedEvents;
        }
    }

    private void received(Session session, String text) {
        var event = session.protocol.parse(text, clock.instant());
        if (event.isEmpty()) {
            rejectedEvents++;
            return;
        }
        BinanceMarkPriceEvent price = event.get();
        session.lastDataAt = nanoTime.getAsLong();
        if (!session.healthy) {
            long disconnectedMillis = disconnectedAt == null ? 0
                    : TimeUnit.NANOSECONDS.toMillis(session.lastDataAt - disconnectedAt);
            log.info("[Binance WS] HEALTHY reconnectAttempt={} disconnectedDurationMs={}",
                    retryAttempt, disconnectedMillis);
            retryAttempt = 0;
            disconnectedAt = null;
            session.healthy = true;
        }
        lastReceivedAt = price.receivedAt();
        receivedEvents++;
        String format = "[MARK PRICE] tradingSymbolId={} symbol={} providerSymbol={} providerMarkPrice={} domainMarkPrice={} eventTime={} receivedAt={}";
        if (logPrices) {
            log.info(format, price.tradingSymbolId(), price.symbol(), price.providerSymbol(),
                    price.providerMarkPrice(), price.domainMarkPrice(), price.eventTime(), price.receivedAt());
        } else {
            log.debug(format, price.tradingSymbolId(), price.symbol(), price.providerSymbol(),
                    price.providerMarkPrice(), price.domainMarkPrice(), price.eventTime(), price.receivedAt());
        }
    }

    private void execute(Runnable action, WebSocket socket) {
        if (stopping.get()) {
            if (socket != null) {
                socket.abort();
            }
            return;
        }
        try {
            executor.execute(action);
        } catch (RejectedExecutionException exception) {
            if (socket != null) {
                socket.abort();
            }
        }
    }

    private static String errorDescription(Throwable error) {
        while (error instanceof CompletionException && error.getCause() != null) {
            error = error.getCause();
        }
        if (error instanceof WebSocketHandshakeException handshakeError) {
            return "WebSocketHandshakeException httpStatus=" + handshakeError.getResponse().statusCode();
        }
        return error.getClass().getSimpleName();
    }

    @PreDestroy
    public void stop() {
        if (!stopping.compareAndSet(false, true)) {
            return;
        }
        CompletableFuture<Void> closed = new CompletableFuture<>();
        try {
            executor.execute(() -> {
                if (retry != null) {
                    retry.cancel(false);
                }
                if (watchdog != null) {
                    watchdog.cancel(false);
                }
                Session session = current;
                current = null;
                state = State.DISCONNECTED;
                if (session != null && session.socket != null) {
                    session.socket.sendClose(WebSocket.NORMAL_CLOSURE, "Application shutdown")
                            .thenCompose(socket -> session.closeReceived)
                            .orTimeout(2, TimeUnit.SECONDS).whenComplete((socket, error) -> {
                                session.abort();
                                if (error != null) {
                                    log.warn("[Binance WS] close acknowledgement timeout/error; connection aborted");
                                }
                                closed.complete(null);
                            });
                } else {
                    if (session != null) {
                        session.abort();
                    }
                    closed.complete(null);
                }
            });
            closed.get(3, TimeUnit.SECONDS);
            log.info("[Binance WS] graceful shutdown complete");
        } catch (Exception exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            Session session = current;
            if (session != null) {
                session.abort();
            }
            log.warn("[Binance WS] shutdown timeout/error; connection aborted");
        } finally {
            executor.shutdownNow();
        }
    }

    private final class Session implements WebSocket.Listener {
        private final BinanceMarkPriceProtocol protocol;
        private final StringBuilder text = new StringBuilder();
        private final CompletableFuture<Void> closeReceived = new CompletableFuture<>();
        private volatile WebSocket socket;
        private CompletableFuture<WebSocket> handshake;
        private long openedAt;
        private long lastDataAt;
        private boolean healthy;

        private Session(BinanceMarkPriceProtocol protocol) {
            this.protocol = protocol;
        }

        private void abort() {
            if (socket != null) {
                socket.abort();
            }
            if (handshake != null && !handshake.isDone()) {
                handshake.cancel(true);
            }
        }

        @Override
        public void onOpen(WebSocket webSocket) {
            socket = webSocket;
            execute(() -> opened(this, webSocket), webSocket);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            if (data.length() > MAX_MESSAGE_CHARS) {
                execute(() -> failed(this, "oversized Mark Price message"), webSocket);
                return null;
            }
            String fragment = data.toString();
            execute(() -> {
                if (stopping.get() || current != this) {
                    webSocket.abort();
                    return;
                }
                if (text.length() + fragment.length() > MAX_MESSAGE_CHARS) {
                    failed(this, "oversized Mark Price message");
                    return;
                }
                text.append(fragment);
                if (last) {
                    received(this, text.toString());
                    text.setLength(0);
                }
                webSocket.request(1);
            }, webSocket);
            return null;
        }

        // Java 17 automatically reciprocates ping with pong; default callbacks request more frames.
        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            closeReceived.complete(null);
            if (stopping.get()) {
                log.info("[Binance WS] shutdown close status={} reason={}", statusCode,
                        reason.replaceAll("[\\p{Cntrl}]", " "));
            }
            execute(() -> failed(this, "close status=" + statusCode + " reason="
                    + reason.replaceAll("[\\p{Cntrl}]", " ")), null);
            return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            execute(() -> failed(this, "network error=" + errorDescription(error)), null);
        }
    }
}
