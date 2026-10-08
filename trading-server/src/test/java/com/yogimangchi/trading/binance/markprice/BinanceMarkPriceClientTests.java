package com.yogimangchi.trading.binance.markprice;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import java.net.URI;
import java.net.http.WebSocket;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BinanceMarkPriceClientTests {

    private final ScheduledExecutorService executor = mock(ScheduledExecutorService.class);
    private final AtomicLong now = new AtomicLong();
    private final List<Connection> connections = new ArrayList<>();
    private final List<Retry> retries = new ArrayList<>();
    private final List<BinanceSubscriptionTarget> targets = new ArrayList<>(List.of(
            new BinanceSubscriptionTarget(42L, "BTC", "BTCUSDT", 1L)));
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();
    private Runnable healthCheck;
    private boolean databaseUnavailable;
    private BinanceMarkPriceClient client;
    private final Clock clock = Clock.fixed(Instant.ofEpochMilli(1562305380000L), ZoneOffset.UTC);
    private final LatestPriceStore latestPrices = new LatestPriceStore(clock);

    @BeforeEach
    void setUp() {
        // Execute lifecycle work deterministically; timer callbacks run only when the test advances them.
        doAnswer(call -> {
            call.<Runnable>getArgument(0).run();
            return null;
        }).when(executor).execute(any(Runnable.class));
        doAnswer(call -> {
            healthCheck = call.getArgument(0);
            return mock(ScheduledFuture.class);
        }).when(executor).scheduleWithFixedDelay(any(Runnable.class), anyLong(), anyLong(), any(TimeUnit.class));
        doAnswer(call -> {
            ScheduledFuture<?> future = mock(ScheduledFuture.class);
            retries.add(new Retry(call.getArgument(0), call.getArgument(1), call.getArgument(2), future));
            return future;
        }).when(executor).schedule(any(Runnable.class), anyLong(), any(TimeUnit.class));
        logs.start();
        ((Logger) LoggerFactory.getLogger(BinanceMarkPriceClient.class)).addAppender(logs);
        client = new BinanceMarkPriceClient(() -> {
            if (databaseUnavailable) {
                throw new IllegalStateException("Database unavailable");
            }
            return List.copyOf(targets);
        }, new ObjectMapper(), (uri, listener) -> {
            var connection = new Connection(uri, listener, mock(WebSocket.class), new CompletableFuture<>());
            when(connection.socket.sendClose(eq(1000), any(String.class))).thenAnswer(call -> {
                listener.onClose(connection.socket, 1000, "normal");
                return CompletableFuture.completedFuture(connection.socket);
            });
            connections.add(connection);
            return connection.handshake;
        }, executor, clock, now::get, new ReconnectBackoff(() -> 1.0), true, latestPrices);
    }

    @AfterEach
    void tearDown() {
        client.stop();
        ((Logger) LoggerFactory.getLogger(BinanceMarkPriceClient.class)).detachAppender(logs);
        logs.stop();
    }

    @Test
    void startsOnlyOnceAndReconnectsOnceDespiteDuplicateCallbacks() {
        client.start();
        client.start();
        assertThat(connections).hasSize(1);
        Connection first = openLatest();
        first.listener.onError(first.socket, new IllegalStateException("network"));
        first.listener.onClose(first.socket, 1006, "abnormal");
        assertThat(retries).hasSize(1);
        assertThat(retries.get(0).delay).isEqualTo(1000);
        verify(first.socket).abort();
        targets.add(new BinanceSubscriptionTarget(77L, "ETH", "ETHUSDT", 1L));
        now.set(Duration.ofSeconds(2).toNanos());
        retries.get(0).action.run();
        Connection second = openLatest();
        assertThat(second.uri.toString()).endsWith("btcusdt@markPrice@1s/ethusdt@markPrice@1s");
        first.listener.onError(first.socket, new IllegalStateException("late callback"));
        assertThat(retries).hasSize(1);
        second.listener.onText(second.socket, BinanceMarkPriceProtocolTests.message("BTCUSDT", "123"), true);
        second.listener.onClose(second.socket, 1000, "server rotation");
        assertThat(retries).hasSize(2);
        assertThat(retries.get(1).delay).isEqualTo(1000);
        assertThat(messages()).anyMatch(text -> text.contains("reconnectAttempt=1 disconnectedDurationMs=2000"));
    }

    @Test
    void initialHandshakeFailuresBackOffWithoutTerminatingApplication() {
        client.start();
        connections.get(0).handshake.completeExceptionally(new java.io.IOException("unreachable"));
        retries.get(0).action.run();
        connections.get(1).handshake.completeExceptionally(new java.io.IOException("unreachable"));
        assertThat(retries).extracting(Retry::delay).containsExactly(1000L, 2000L);
    }

    @Test
    void openWithoutValidDataDoesNotResetBackoffButFirstStoredPriceDoes() {
        client.start();
        Connection first = openLatest();
        first.listener.onClose(first.socket, 1000, "unstable");
        retries.get(0).action.run();
        Connection second = openLatest();
        second.listener.onText(second.socket, "invalid", true);
        second.listener.onClose(second.socket, 1000, "unstable");
        assertThat(retries).extracting(Retry::delay).containsExactly(1000L, 2000L);
        retries.get(1).action.run();
        Connection third = openLatest();
        third.listener.onText(third.socket, BinanceMarkPriceProtocolTests.message("BTCUSDT", "10"), true);
        assertThat(latestPrices.find(42L).status()).isEqualTo(LatestPriceStore.Status.FRESH);
        third.listener.onClose(third.socket, 1000, "after healthy price");
        assertThat(retries).extracting(Retry::delay).containsExactly(1000L, 2000L, 1000L);
        assertThat(latestPrices.find(42L).status()).isEqualTo(LatestPriceStore.Status.UNAVAILABLE);
    }

    @Test
    void unknownInvalidAndOldMessagesCannotUpdateLatestPriceOrRestoreHealth() {
        client.start();
        Connection connection = openLatest();
        connection.listener.onText(connection.socket, "{}", true);
        connection.listener.onText(connection.socket, BinanceMarkPriceProtocolTests.message("ETHUSDT", "1"), true);
        connection.listener.onText(connection.socket,
                BinanceMarkPriceProtocolTests.message("BTCUSDT", "1").replace("1562305380000", "1562305370000"), true);
        assertThat(latestPrices.find(42L).status()).isEqualTo(LatestPriceStore.Status.MISSING);
        assertThat(messages()).noneMatch(text -> text.contains("HEALTHY"));
        String valid = BinanceMarkPriceProtocolTests.message("BTCUSDT", "10");
        connection.listener.onText(connection.socket, valid, true);
        connection.listener.onText(connection.socket, valid.replace("\"10\"", "\"999\""), true);
        connection.listener.onText(connection.socket, "{", true);
        assertThat(latestPrices.find(42L).latestPrice().orElseThrow().domainMarkPrice()).isEqualByComparingTo("10");
        client.stop();
        assertThat(latestPrices.find(42L).status()).isEqualTo(LatestPriceStore.Status.UNAVAILABLE);
    }

    @Test
    void databaseFailureRetriesAndRestoresSubscription() {
        databaseUnavailable = true;
        client.start();
        assertThat(connections).isEmpty();
        assertThat(retries).hasSize(1);
        databaseUnavailable = false;
        retries.get(0).action.run();
        openLatest();
        assertThat(connections).hasSize(1);
    }

    @Test
    void openedConnectionWithoutAnyDataIsDetectedAsStale() {
        client.start();
        openLatest();
        now.set(Duration.ofSeconds(15).toNanos());
        healthCheck.run();
        assertThat(retries).hasSize(1);
    }

    @Test
    void onlyValidCompleteMessagesRefreshStaleDeadlineAndLateMessagesAreIgnored() {
        client.start();
        Connection connection = openLatest();
        String message = BinanceMarkPriceProtocolTests.message("BTCUSDT", "123.45000000");
        now.set(Duration.ofSeconds(14).toNanos());
        connection.listener.onText(connection.socket, message.substring(0, 20), false);
        connection.listener.onText(connection.socket, message.substring(20), true);
        assertThat(messages()).anyMatch(text -> text.contains("tradingSymbolId=42 symbol=BTC")
                && text.contains("domainMarkPrice=123.45000000"));
        now.set(Duration.ofSeconds(20).toNanos());
        connection.listener.onText(connection.socket, "invalid JSON", true);
        healthCheck.run();
        assertThat(retries).isEmpty();
        now.set(Duration.ofSeconds(29).toNanos());
        healthCheck.run();
        assertThat(retries).hasSize(1);
        assertThat(messages()).anyMatch(text -> text.contains("STALE"));
        long priceLogs = messages().stream().filter(text -> text.contains("[MARK PRICE]")).count();
        connection.listener.onText(connection.socket, message, true);
        assertThat(messages().stream().filter(text -> text.contains("[MARK PRICE]")).count()).isEqualTo(priceLogs);
    }

    @Test
    void rotatesBeforeTwentyFourHoursEvenWhileReceivingValidData() {
        client.start();
        Connection connection = openLatest();
        now.set(Duration.ofMinutes(1430).toNanos());
        connection.listener.onText(connection.socket, BinanceMarkPriceProtocolTests.message("BTCUSDT", "1"), true);
        healthCheck.run();
        assertThat(retries).hasSize(1);
        assertThat(messages()).anyMatch(text -> text.contains("planned rotation"));
    }

    @Test
    void oversizedMessagesCloseConnectionWithoutAccumulatingUnboundedText() {
        client.start();
        Connection connection = openLatest();
        connection.listener.onText(connection.socket, "x".repeat(16_385), false);
        assertThat(retries).hasSize(1);
        verify(connection.socket).abort();
    }

    @Test
    void emptySubscriptionsWaitAndReloadWithoutConnecting() {
        targets.clear();
        client.start();
        assertThat(connections).isEmpty();
        assertThat(retries.get(0).delay).isEqualTo(30);
        assertThat(retries.get(0).unit).isEqualTo(TimeUnit.SECONDS);
        targets.add(new BinanceSubscriptionTarget(5L, "SOL", "SOLUSDT", 1L));
        retries.get(0).action.run();
        assertThat(connections).hasSize(1);
    }

    @Test
    void shutdownSendsCloseAndNeverReconnects() {
        client.start();
        Connection connection = openLatest();
        client.stop();
        client.stop();
        connection.listener.onError(connection.socket, new IllegalStateException("after shutdown"));
        verify(connection.socket, times(1)).sendClose(1000, "Application shutdown");
        verify(executor, times(1)).shutdownNow();
        assertThat(retries).isEmpty();
    }

    @Test
    void shutdownCancelsPendingRetryAndRejectsLateOpen() {
        client.start();
        Connection connection = connections.get(0);
        connection.handshake.completeExceptionally(new java.io.IOException());
        client.stop();
        verify(retries.get(0).future).cancel(false);
        retries.get(0).action.run();
        connection.listener.onOpen(connection.socket);
        verify(connection.socket).abort();
        assertThat(connections).hasSize(1);
    }

    @Test
    void shutdownCancelsInFlightHandshake() {
        client.start();
        Connection connection = connections.get(0);
        client.stop();
        assertThat(connection.handshake).isCancelled();
        connection.listener.onOpen(connection.socket);
        verify(connection.socket).abort();
    }

    private Connection openLatest() {
        Connection connection = connections.get(connections.size() - 1);
        connection.listener.onOpen(connection.socket);
        connection.handshake.complete(connection.socket);
        return connection;
    }

    private List<String> messages() {
        return logs.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
    }

    private record Connection(URI uri, WebSocket.Listener listener, WebSocket socket,
                              CompletableFuture<WebSocket> handshake) { }

    private record Retry(Runnable action, long delay, TimeUnit unit, ScheduledFuture<?> future) { }
}
