package com.yogimangchi.trading.marketdata.websocket;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.MarketDataEvent;
import com.yogimangchi.trading.marketdata.MarketDataFanout;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.tradingsymbol.service.TradingSymbolService;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.adapter.standard.StandardWebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/** Public domain-unit price delivery. Trading writes use separately authenticated REST APIs. */
@Component
public class MarketWebSocketHandler extends TextWebSocketHandler {
    static final int MAX_SUBSCRIPTIONS = 32;
    private static final int MAX_CLIENTS = 256;
    private static final int MAX_MESSAGE_BYTES = 8192;
    private static final long IDLE_NANOS = TimeUnit.SECONDS.toNanos(60);
    private static final long SEND_NANOS = TimeUnit.SECONDS.toNanos(5);
    private static final Logger log = LoggerFactory.getLogger(MarketWebSocketHandler.class);

    private final ObjectMapper mapper;
    private final TradingSymbolService symbols;
    private final LatestPriceStore prices;
    private final MarketDataFanout fanout;
    private final ObjectProvider<RedisMarketDataBridge> redis;
    private final Map<String, Client> clients = new ConcurrentHashMap<>();
    private final Semaphore capacity = new Semaphore(MAX_CLIENTS);
    private final ThreadPoolExecutor writers = pool(8, 256, "market-ws-writer");
    private final ThreadPoolExecutor closers = pool(2, MAX_CLIENTS, "market-ws-close");
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor(threads("market-ws-watchdog"));
    private AutoCloseable fanoutSubscription;

    public MarketWebSocketHandler(ObjectMapper mapper, TradingSymbolService symbols, LatestPriceStore prices,
                                  MarketDataFanout fanout, ObjectProvider<RedisMarketDataBridge> redis) {
        this.mapper = mapper;
        this.symbols = symbols;
        this.prices = prices;
        this.fanout = fanout;
        this.redis = redis;
    }

    @PostConstruct
    public void start() {
        fanoutSubscription = fanout.subscribe(this::onMarketEvent);
        watchdog.scheduleWithFixedDelay(this::sweep, 1, 1, TimeUnit.SECONDS);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws IOException {
        session.setTextMessageSizeLimit(MAX_MESSAGE_BYTES);
        if (session instanceof StandardWebSocketSession standard) {
            // This application uses Boot's embedded Tomcat; bound even a single blocking socket write/close.
            standard.getNativeSession().getUserProperties().put("org.apache.tomcat.websocket.BLOCKING_SEND_TIMEOUT", 5000L);
            standard.getNativeSession().getUserProperties().put("org.apache.tomcat.websocket.SESSION_CLOSE_TIMEOUT", 1000L);
        }
        if (!capacity.tryAcquire()) {
            session.close(new CloseStatus(1013, "WebSocket capacity exceeded"));
            return;
        }
        Client client = new Client(session);
        clients.put(session.getId(), client);
        send(client, "CONNECTED", Map.of("maxSubscriptions", MAX_SUBSCRIPTIONS, "heartbeatSeconds", 20,
                "idleTimeoutSeconds", 60));
        sendRedisHealth(client);
        log.info("[Market WS] connected sessionId={} clients={}", session.getId(), clients.size());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        Client client = clients.get(session.getId());
        if (client == null) {
            return;
        }
        synchronized (client) {
            long now = System.nanoTime();
            client.lastInbound = now;
            if (now - client.commandWindow >= TimeUnit.SECONDS.toNanos(1)) {
                client.commandWindow = now;
                client.commandCount = 0;
            }
            if (++client.commandCount > 20) {
                disconnect(client, new CloseStatus(1008, "Command rate exceeded"));
                return;
            }
        }
        try {
            JsonNode command = mapper.readTree(message.getPayload());
            if (command == null || !command.isObject() || !command.path("type").isTextual()) {
                error(client, "INVALID_COMMAND", "A JSON object with a type is required");
                return;
            }
            switch (command.path("type").asText()) {
                case "PING" -> send(client, "PONG", Map.of("serverTime", Instant.now()));
                case "SUBSCRIBE" -> subscribe(client, parseIds(command));
                case "UNSUBSCRIBE" -> unsubscribe(client, parseIds(command));
                default -> error(client, "UNKNOWN_COMMAND", "Supported commands: SUBSCRIBE, UNSUBSCRIBE, PING");
            }
        } catch (JsonProcessingException | IllegalArgumentException ex) {
            error(client, "INVALID_COMMAND", "tradingSymbolIds must contain 1 to 32 positive integer IDs");
        } catch (RuntimeException ex) {
            log.warn("[Market WS] command failed sessionId={} type={}", session.getId(), ex.getClass().getSimpleName());
            error(client, "TEMPORARILY_UNAVAILABLE", "The subscription could not be processed");
        }
    }

    private Set<Long> parseIds(JsonNode command) {
        JsonNode values = command.path("tradingSymbolIds");
        if (!values.isArray() || values.isEmpty() || values.size() > MAX_SUBSCRIPTIONS) {
            throw new IllegalArgumentException("Invalid subscription IDs");
        }
        Set<Long> ids = new LinkedHashSet<>();
        for (JsonNode value : values) {
            if (!value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() <= 0) {
                throw new IllegalArgumentException("Invalid subscription ID");
            }
            ids.add(value.longValue());
        }
        return ids;
    }

    private void subscribe(Client client, Set<Long> requested) {
        Set<Long> active = symbols.findActiveSymbols().stream().map(symbol -> symbol.id()).collect(Collectors.toSet());
        if (!active.containsAll(requested)) {
            error(client, "SYMBOL_NOT_AVAILABLE", "Every requested tradingSymbolId must be ACTIVE");
            return;
        }
        synchronized (client) {
            Set<Long> combined = new LinkedHashSet<>(client.symbols.keySet());
            combined.addAll(requested);
            if (combined.size() > MAX_SUBSCRIPTIONS) {
                error(client, "SUBSCRIPTION_LIMIT", "At most 32 symbols may be subscribed per connection");
                return;
            }
            List<PriceSnapshot> snapshots = new ArrayList<>();
            for (Long id : requested) {
                LatestPriceStore.Snapshot snapshot = prices.find(id);
                LatestMarkPrice price = snapshot.latestPrice().orElse(null);
                String state = snapshot.status() == LatestPriceStore.Status.MISSING ? "UNAVAILABLE" : snapshot.status().name();
                SymbolState previous = client.symbols.get(id);
                // A duplicate subscription is idempotent and must not roll back an already delivered Redis update.
                if (previous == null || price != null && (previous.price == null
                        || !price.eventTime().isBefore(previous.price.eventTime()))) {
                    previous = new SymbolState(price, state, price == null ? Instant.MIN : price.receivedAt());
                    client.symbols.put(id, previous);
                }
                snapshots.add(snapshot(id, previous));
            }
            send(client, "SUBSCRIBED", Map.of("tradingSymbolIds", sortedIds(client)));
            send(client, "SNAPSHOT", Map.of("prices", snapshots));
        }
        log.info("[Market WS] subscribe sessionId={} tradingSymbolIds={}", client.session.getId(), requested);
    }

    private void unsubscribe(Client client, Set<Long> requested) {
        synchronized (client) {
            requested.forEach(client.symbols::remove);
            send(client, "UNSUBSCRIBED", Map.of("tradingSymbolIds", sortedIds(client)));
        }
        log.info("[Market WS] unsubscribe sessionId={} tradingSymbolIds={}", client.session.getId(), requested);
    }

    private void onMarketEvent(MarketDataEvent event) {
        for (Client client : clients.values()) {
            synchronized (client) {
                for (Long id : event.tradingSymbolIds()) {
                    SymbolState previous = client.symbols.get(id);
                    if (previous == null || event.occurredAt().isBefore(previous.changedAt)) {
                        continue;
                    }
                    if (event.type() != MarketDataEvent.Type.PRICE) {
                        String status = event.type().name();
                        client.symbols.put(id, new SymbolState(previous.price, status, event.occurredAt()));
                        if (!status.equals(previous.status)) {
                            marketStatus(client, id, status);
                        }
                        continue;
                    }
                    LatestMarkPrice price = event.price();
                    if (previous.price != null && !price.eventTime().isAfter(previous.price.eventTime())) {
                        continue;
                    }
                    boolean fresh = LatestPriceStore.isFreshAt(price, Instant.now());
                    String status = fresh ? "FRESH" : "STALE";
                    client.symbols.put(id, new SymbolState(price, status, event.occurredAt()));
                    if (!status.equals(previous.status)) {
                        marketStatus(client, id, fresh ? "RECOVERED" : "STALE");
                    }
                    if (fresh) {
                        send(client, "MARKET_PRICE", priceFields(price));
                    }
                }
            }
        }
    }

    private void sweep() {
        long now = System.nanoTime();
        for (Client client : clients.values()) {
            if (now - client.lastInbound > IDLE_NANOS) {
                disconnect(client, new CloseStatus(1008, "Client heartbeat expired"));
            } else if (client.sender.sendingLongerThan(now, SEND_NANOS)) {
                disconnect(client, new CloseStatus(1013, "Slow client send timeout"));
            } else {
                synchronized (client) {
                    for (Map.Entry<Long, SymbolState> entry : client.symbols.entrySet()) {
                        SymbolState state = entry.getValue();
                        if ("FRESH".equals(state.status) && !LatestPriceStore.isFreshAt(state.price, Instant.now())) {
                            entry.setValue(new SymbolState(state.price, "STALE", state.changedAt));
                            marketStatus(client, entry.getKey(), "STALE");
                        }
                    }
                    sendRedisHealth(client);
                }
            }
        }
    }

    private void sendRedisHealth(Client client) {
        RedisMarketDataBridge bridge = redis.getIfAvailable();
        String state = bridge == null ? "UNAVAILABLE" : bridge.health().state().name();
        if (!state.equals(client.redisState)) {
            client.redisState = state;
            send(client, "INFRA_STATUS", Map.of("component", "REDIS", "status", state));
        }
    }

    private void marketStatus(Client client, Long id, String status) {
        send(client, "MARKET_STATUS", Map.of("status", status, "affectedTradingSymbolIds", List.of(id)));
    }

    private Map<String, Object> priceFields(LatestMarkPrice price) {
        return Map.of("tradingSymbolId", price.tradingSymbolId(), "price", price.domainMarkPrice().toPlainString(),
                "eventTime", price.eventTime(), "receivedAt", price.receivedAt(), "status", "FRESH");
    }

    private PriceSnapshot snapshot(Long id, SymbolState state) {
        LatestMarkPrice price = state.price;
        return new PriceSnapshot(id, price == null ? null : price.domainMarkPrice().toPlainString(), state.status,
                price == null ? null : price.eventTime(), price == null ? null : price.receivedAt());
    }

    private List<Long> sortedIds(Client client) {
        return client.symbols.keySet().stream().sorted().toList();
    }

    private void error(Client client, String code, String message) {
        send(client, "ERROR", Map.of("code", code, "message", message));
    }

    private void send(Client client, String type, Map<String, ?> fields) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("version", 1);
        message.put("type", type);
        message.putAll(fields);
        try {
            client.sender.enqueue(mapper.writeValueAsString(message));
        } catch (JsonProcessingException ex) {
            disconnect(client, new CloseStatus(1011, "WebSocket serialization failed"));
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        Client client = clients.get(session.getId());
        if (client != null) {
            disconnect(client, new CloseStatus(1011, "WebSocket transport failed"));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Client client = clients.remove(session.getId());
        if (client != null) {
            client.sender.discard();
            capacity.release();
            log.info("[Market WS] disconnected sessionId={} code={} clients={}", session.getId(), status.getCode(), clients.size());
        }
    }

    private void disconnect(Client client, CloseStatus status) {
        if (!clients.remove(client.session.getId(), client)) {
            return;
        }
        client.sender.discard();
        log.warn("[Market WS] disconnect sessionId={} code={} reason={} clients={}",
                client.session.getId(), status.getCode(), status.getReason(), clients.size());
        try {
            closers.execute(() -> {
                try {
                    client.session.close(status);
                } catch (IOException ex) {
                    log.debug("[Market WS] close failed sessionId={}", client.session.getId());
                } finally {
                    capacity.release();
                }
            });
        } catch (RejectedExecutionException ex) {
            capacity.release(); // Only possible during application shutdown; the servlet container closes remaining sockets.
        }
    }

    int connectedClients() {
        return clients.size();
    }

    @PreDestroy
    public void stop() {
        watchdog.shutdownNow();
        if (fanoutSubscription != null) {
            try {
                fanoutSubscription.close();
            } catch (Exception ex) {
                log.debug("[Market WS] fanout unsubscribe failed");
            }
        }
        clients.values().forEach(client -> disconnect(client, new CloseStatus(1001, "Server shutdown")));
        writers.shutdownNow();
        closers.shutdown();
    }

    private static ThreadPoolExecutor pool(int threads, int queue, String name) {
        return new ThreadPoolExecutor(threads, threads, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(queue), threads(name));
    }

    private static ThreadFactory threads(String name) {
        AtomicInteger sequence = new AtomicInteger();
        return runnable -> {
            Thread thread = new Thread(runnable, name + "-" + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    private record SymbolState(LatestMarkPrice price, String status, Instant changedAt) { }
    private record PriceSnapshot(Long tradingSymbolId, String price, String status, Instant eventTime, Instant receivedAt) { }

    private final class Client {
        private final WebSocketSession session;
        private final BoundedWebSocketSender sender;
        private final Map<Long, SymbolState> symbols = new HashMap<>();
        private volatile long lastInbound = System.nanoTime();
        private long commandWindow = lastInbound;
        private int commandCount;
        private String redisState;

        private Client(WebSocketSession session) {
            this.session = session;
            this.sender = new BoundedWebSocketSender(session, writers, status -> disconnect(this, status), 128);
        }
    }
}
