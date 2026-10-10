package com.yogimangchi.trading.marketdata.websocket;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class BoundedWebSocketSenderTests {

    @Test
    void oneWriterDrainsMessagesInOrderIncludingMessagesArrivingDuringSend() throws Exception {
        var jobs = new ArrayList<Runnable>();
        var delivered = new ArrayList<String>();
        var session = mock(WebSocketSession.class);
        var sender = new BoundedWebSocketSender(session, jobs::add, status -> {
            throw new AssertionError(status);
        }, 4);
        doAnswer(invocation -> {
            String value = ((TextMessage) invocation.getArgument(0)).getPayload();
            delivered.add(value);
            if (value.equals("one")) sender.enqueue("three");
            return null;
        }).when(session).sendMessage(any());

        sender.enqueue("one");
        sender.enqueue("two");
        assertThat(jobs).hasSize(1);
        jobs.remove(0).run();
        assertThat(delivered).containsExactly("one", "two", "three");
        assertThat(jobs).isEmpty();
        assertThat(sender.sendingLongerThan(System.nanoTime(), 0)).isFalse();
    }

    @Test
    void slowNetworkDoesNotBlockProducerAndOverflowDisconnectsOnlyOnce() throws Exception {
        var writing = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var writers = Executors.newSingleThreadExecutor();
        var session = mock(WebSocketSession.class);
        List<CloseStatus> closed = new java.util.concurrent.CopyOnWriteArrayList<>();
        var sender = new BoundedWebSocketSender(session, writers, closed::add, 2);
        doAnswer(invocation -> {
            writing.countDown();
            if (!release.await(5, TimeUnit.SECONDS)) throw new AssertionError("writer not released");
            return null;
        }).when(session).sendMessage(any());
        try {
            sender.enqueue("blocking");
            assertThat(writing.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(sender.sendingLongerThan(System.nanoTime() + TimeUnit.SECONDS.toNanos(6),
                    TimeUnit.SECONDS.toNanos(5))).isTrue();
            sender.enqueue("queued one");
            sender.enqueue("queued two");
            sender.enqueue("overflow");
            sender.enqueue("after closure");
            assertThat(closed).extracting(CloseStatus::getCode).containsExactly(1013);
        } finally {
            release.countDown();
            writers.shutdown();
            assertThat(writers.awaitTermination(3, TimeUnit.SECONDS)).isTrue();
        }
        verify(session, times(1)).sendMessage(any());
    }

    @Test
    void exhaustedSharedExecutorDisconnectsInsteadOfRunningOnProducer() throws Exception {
        var session = mock(WebSocketSession.class);
        var closed = new ArrayList<CloseStatus>();
        var sender = new BoundedWebSocketSender(session, task -> {
            throw new RejectedExecutionException();
        }, closed::add, 2);
        sender.enqueue("one");
        sender.enqueue("two");
        assertThat(closed).extracting(CloseStatus::getCode).containsExactly(1013);
        verifyNoInteractions(session);
    }

    @Test
    void sendFailureClearsPendingMessagesAndDoesNotRetry() throws Exception {
        var session = mock(WebSocketSession.class);
        var jobs = new ArrayList<Runnable>();
        var closed = new ArrayList<CloseStatus>();
        var sender = new BoundedWebSocketSender(session, jobs::add, closed::add, 2);
        doThrow(new IOException("closed socket")).when(session).sendMessage(any());
        sender.enqueue("one");
        sender.enqueue("two");
        jobs.remove(0).run();
        sender.enqueue("three");
        assertThat(closed).extracting(CloseStatus::getCode).containsExactly(1011);
        assertThat(jobs).isEmpty();
        verify(session, times(1)).sendMessage(any());
    }

    @Test
    void disconnectedClientDiscardsQueuedDelivery() {
        var session = mock(WebSocketSession.class);
        var jobs = new ArrayList<Runnable>();
        var sender = new BoundedWebSocketSender(session, jobs::add, status -> { }, 2);
        sender.enqueue("one");
        sender.discard();
        jobs.remove(0).run();
        sender.enqueue("two");
        assertThat(jobs).isEmpty();
        verifyNoInteractions(session);
    }
}
