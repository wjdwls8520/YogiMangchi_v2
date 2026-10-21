package com.yogimangchi.trading.tradingevent.websocket;

import com.fasterxml.jackson.databind.*;
import com.yogimangchi.trading.tradingaccount.security.*;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import com.yogimangchi.trading.websocket.BoundedWebSocketSender;
import jakarta.annotation.*;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.socket.*;
import org.springframework.web.socket.adapter.standard.StandardWebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/** Authenticated private account delivery. Never carries credentials in URLs or public market frames. */
@Component
public class TradingEventWebSocketHandler extends TextWebSocketHandler {
    private static final Logger log=LoggerFactory.getLogger(TradingEventWebSocketHandler.class);
    private static final int MAX_CLIENTS=256, MAX_PER_ACCOUNT=3;
    private static final long SECOND=TimeUnit.SECONDS.toNanos(1);
    private final ObjectMapper mapper;
    private final GuestCredentialService credentials;
    private final TradingEvents events;
    private final Map<String,Client> clients=new ConcurrentHashMap<>();
    private final Object registrations=new Object();
    private final Semaphore capacity=new Semaphore(MAX_CLIENTS);
    private final ThreadPoolExecutor readers=pool(4,256,"trading-event-reader");
    private final ThreadPoolExecutor writers=pool(8,256,"trading-event-writer");
    private final ThreadPoolExecutor closers=pool(2,256,"trading-event-close");
    private final ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor(threads("trading-event-watch"));

    public TradingEventWebSocketHandler(ObjectMapper mapper,GuestCredentialService credentials,TradingEvents events) {
        this.mapper=mapper; this.credentials=credentials; this.events=events;
    }
    @PostConstruct public void start() { clock.scheduleWithFixedDelay(this::sweep,250,250,TimeUnit.MILLISECONDS); }

    @Override public void afterConnectionEstablished(WebSocketSession session) throws IOException {
        session.setTextMessageSizeLimit(8192);
        if(session instanceof StandardWebSocketSession standard) {
            standard.getNativeSession().getUserProperties().put("org.apache.tomcat.websocket.BLOCKING_SEND_TIMEOUT",5000L);
            standard.getNativeSession().getUserProperties().put("org.apache.tomcat.websocket.SESSION_CLOSE_TIMEOUT",1000L);
        }
        if(session.getUri()==null || session.getUri().getRawQuery()!=null) {
            session.close(new CloseStatus(1008,"Query parameters are not allowed")); return;
        }
        if(!capacity.tryAcquire()) { session.close(new CloseStatus(1013,"Trading stream capacity exceeded")); return; }
        var client=new Client(session);
        clients.put(session.getId(),client);
        send(client,"CONNECTED",Map.of("authenticationDeadlineSeconds",5,"heartbeatSeconds",20,"delivery","AT_LEAST_ONCE"));
    }

    @Override protected void handleTextMessage(WebSocketSession session,TextMessage message) {
        Client client=clients.get(session.getId());
        if(client==null || client.closed.get()) return;
        try {
            long now=System.nanoTime();
            synchronized(client) {
                if(now-client.rateWindow>=SECOND) { client.rateWindow=now; client.messages=0; }
                if(++client.messages>10) { disconnect(client,new CloseStatus(1008,"Message rate exceeded")); return; }
                client.activity=now;
            }
            JsonNode frame=mapper.readTree(message.getPayload());
            if(frame==null || !frame.isObject() || !frame.path("type").isTextual()) throw new IllegalArgumentException();
            String type=frame.path("type").asText();
            if(client.principal==null && type.equals("AUTHENTICATE")) {
                if(!client.authenticating.compareAndSet(false,true)) throw new IllegalArgumentException();
                Set<String> allowed=Set.of("type","credential","afterEventId");
                frame.fieldNames().forEachRemaining(key -> { if(!allowed.contains(key)) throw new IllegalArgumentException(); });
                if(!frame.path("credential").isTextual()) throw new IllegalArgumentException();
                String token=frame.path("credential").asText();
                long cursor=cursor(frame.get("afterEventId"));
                readers.execute(() -> authenticate(client,token,cursor));
            } else if(client.principal!=null && type.equals("PING") && frame.size()==1) {
                if(!client.principal.expiresAt().isAfter(Instant.now())) { disconnect(client,new CloseStatus(1008,"Credential expired")); return; }
                send(client,"PONG",Map.of());
            } else throw new IllegalArgumentException();
        } catch(RejectedExecutionException e) { disconnect(client,new CloseStatus(1013,"Trading stream busy")); }
        catch(Exception e) { disconnect(client,new CloseStatus(1008,"Invalid trading stream message")); }
    }

    private void authenticate(Client client,String token,long cursor) {
        try {
            var principal=credentials.authenticate(token).filter(p -> p.expiresAt().isAfter(Instant.now())).orElse(null);
            if(principal==null) { disconnect(client,new CloseStatus(1008,"Invalid or expired credential")); return; }
            synchronized(registrations) {
                if(client.closed.get()) return;
                long count=clients.values().stream().filter(c -> c.principal!=null && c.principal.accountId().equals(principal.accountId())).count();
                if(count>=MAX_PER_ACCOUNT) { disconnect(client,new CloseStatus(1013,"Account stream capacity exceeded")); return; }
                client.cursor=cursor;
                // Queue the acknowledgement before making the account visible to the replay sweep.
                send(client,"AUTHENTICATED",Map.of("afterEventId",Long.toString(cursor),"expiresAt",principal.expiresAt()));
                if(client.closed.get()) return;
                events.watch(principal.accountId());
                client.principal=principal;
            }
        } catch(RuntimeException e) { disconnect(client,new CloseStatus(1011,"Authentication unavailable")); }
    }

    private void sweep() {
        try {
            long now=System.nanoTime();
            Set<Long> dirty=new HashSet<>();
            clients.values().stream().filter(c -> c.principal!=null).map(c -> c.principal.accountId()).distinct()
                    .forEach(id -> { if(events.consumeDirty(id)) dirty.add(id); });
            for(Client client:clients.values()) {
                if(client.closed.get()) continue;
                if(client.sender.sendingLongerThan(now,5*SECOND) || now-client.activity>60*SECOND) {
                    disconnect(client,new CloseStatus(1013,"Trading stream timed out")); continue;
                }
                GuestPrincipal principal=client.principal;
                if(principal==null) {
                    if(now-client.connected>5*SECOND) disconnect(client,new CloseStatus(1008,"Authentication timed out"));
                    continue;
                }
                if(!principal.expiresAt().isAfter(Instant.now())) { disconnect(client,new CloseStatus(1008,"Credential expired")); continue; }
                if(now-client.heartbeat>20*SECOND) { send(client,"HEARTBEAT",Map.of("at",Instant.now())); client.heartbeat=now; }
                if((now>=client.nextPoll || dirty.contains(principal.accountId())) && client.reading.compareAndSet(false,true)) {
                    try { readers.execute(() -> replay(client)); }
                    catch(RejectedExecutionException e) { client.reading.set(false); disconnect(client,new CloseStatus(1013,"Trading stream busy")); }
                }
            }
        } catch(RuntimeException failure) {
            log.warn("[Trading events] Delivery sweep failed",failure);
        }
    }

    private void replay(Client client) {
        try {
            if(client.closed.get()) return;
            var batch=events.after(client.principal.accountId(),client.cursor,50);
            for(var event:batch) {
                if(client.closed.get() || !client.principal.expiresAt().isAfter(Instant.now())) {
                    disconnect(client,new CloseStatus(1008,"Credential expired")); return;
                }
                send(client,"TRADING_EVENT",event);
                client.cursor=Long.parseLong(event.eventId());
            }
            client.nextPoll=System.nanoTime()+(batch.size()==50 ? 0 : 5*SECOND);
        } catch(RuntimeException e) {
            log.warn("[Trading events] Replay failed accountId={}",client.principal.accountId(),e);
            disconnect(client,new CloseStatus(1011,"Trading event replay unavailable"));
        }
        finally { client.reading.set(false); }
    }

    private static long cursor(JsonNode node) {
        if(node==null) return 0;
        if(!node.isTextual() || !node.asText().matches("0|[1-9][0-9]{0,18}")) throw new IllegalArgumentException();
        return Long.parseLong(node.asText());
    }
    private void send(Client client,String type,Object data) {
        if(client.closed.get()) return;
        try { client.sender.enqueue(mapper.writeValueAsString(Map.of("type",type,"data",data))); }
        catch(IOException e) { disconnect(client,new CloseStatus(1011,"Trading event encoding unavailable")); }
    }
    private void disconnect(Client client,CloseStatus reason) {
        if(!client.closed.compareAndSet(false,true)) return;
        synchronized(registrations) {
            clients.remove(client.session.getId(),client);
            client.sender.discard();
            capacity.release();
            if(client.principal!=null && clients.values().stream().noneMatch(c -> c.principal!=null && c.principal.accountId().equals(client.principal.accountId())))
                events.unwatch(client.principal.accountId());
        }
        Runnable close=() -> { try { if(client.session.isOpen()) client.session.close(reason); } catch(IOException ignored) { } };
        try { closers.execute(close); } catch(RejectedExecutionException ignored) { close.run(); }
    }
    @Override public void afterConnectionClosed(WebSocketSession session,CloseStatus status) {
        Client client=clients.get(session.getId()); if(client!=null) disconnect(client,status);
    }
    @Override public void handleTransportError(WebSocketSession session,Throwable exception) {
        Client client=clients.get(session.getId()); if(client!=null) disconnect(client,new CloseStatus(1011,"Trading stream transport failed"));
    }
    @PreDestroy public void close() {
        clock.shutdownNow();
        List.copyOf(clients.values()).forEach(c -> disconnect(c,CloseStatus.GOING_AWAY));
        readers.shutdownNow(); writers.shutdownNow(); closers.shutdown();
    }
    private static ThreadFactory threads(String prefix) {
        AtomicInteger sequence=new AtomicInteger();
        return task -> { Thread thread=new Thread(task,prefix+"-"+sequence.incrementAndGet()); thread.setDaemon(true); return thread; };
    }
    private static ThreadPoolExecutor pool(int count,int queue,String name) {
        return new ThreadPoolExecutor(count,count,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(queue),threads(name));
    }
    private final class Client {
        final WebSocketSession session;
        final BoundedWebSocketSender sender;
        final AtomicBoolean closed=new AtomicBoolean(),authenticating=new AtomicBoolean(),reading=new AtomicBoolean();
        final long connected=System.nanoTime();
        volatile long activity=connected,heartbeat=connected,cursor,nextPoll;
        volatile GuestPrincipal principal;
        long rateWindow=connected; int messages;
        Client(WebSocketSession session) {
            this.session=session;
            this.sender=new BoundedWebSocketSender(session,writers,status -> disconnect(this,status),128,
                    () -> principal==null ? System.nanoTime()-connected<5*SECOND : principal.expiresAt().isAfter(Instant.now()));
        }
    }
}
