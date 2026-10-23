package com.yogimangchi.trading.websocket;

import java.io.IOException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.BooleanSupplier;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/** Exactly one writer per session; producers never perform network I/O or wait for a slow browser. */
public final class BoundedWebSocketSender {
    private final WebSocketSession session;
    private final Executor writers;
    private final Consumer<CloseStatus> disconnect;
    private final ArrayBlockingQueue<TextMessage> messages;
    private final BooleanSupplier maySend;
    private final AtomicBoolean draining = new AtomicBoolean();
    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile long sendStarted;

    public BoundedWebSocketSender(WebSocketSession session, Executor writers,
                          Consumer<CloseStatus> disconnect, int capacity) {
        this(session,writers,disconnect,capacity,() -> true);
    }

    public BoundedWebSocketSender(WebSocketSession session, Executor writers,
                          Consumer<CloseStatus> disconnect, int capacity, BooleanSupplier maySend) {
        this.session = session;
        this.writers = writers;
        this.disconnect = disconnect;
        this.messages = new ArrayBlockingQueue<>(capacity);
        this.maySend = maySend;
    }

    public void enqueue(String payload) {
        if (closed.get()) {
            return;
        }
        if (!messages.offer(new TextMessage(payload))) {
            fail(new CloseStatus(1013, "Slow client queue exceeded"));
            return;
        }
        schedule();
    }

    public boolean sendingLongerThan(long nowNanos, long maxNanos) {
        long started = sendStarted;
        return started != 0 && nowNanos - started > maxNanos;
    }

    public void discard() {
        closed.set(true);
        messages.clear();
    }

    private void schedule() {
        if (closed.get() || !draining.compareAndSet(false, true)) {
            return;
        }
        try {
            writers.execute(this::drain);
        } catch (RejectedExecutionException ex) {
            draining.set(false);
            fail(new CloseStatus(1013, "WebSocket capacity exceeded"));
        }
    }

    private void drain() {
        try {
            TextMessage message;
            while (!closed.get() && (message = messages.poll()) != null) {
                if (!maySend.getAsBoolean()) {
                    fail(new CloseStatus(1008,"Delivery authorization expired"));
                    return;
                }
                sendStarted = System.nanoTime();
                session.sendMessage(message);
                sendStarted = 0;
            }
        } catch (IOException | RuntimeException ex) {
            fail(new CloseStatus(1011, "WebSocket delivery failed"));
        } finally {
            sendStarted = 0;
            draining.set(false);
            if (!messages.isEmpty()) {
                schedule();
            }
        }
    }

    private void fail(CloseStatus status) {
        if (closed.compareAndSet(false, true)) {
            messages.clear();
            disconnect.accept(status);
        }
    }
}
