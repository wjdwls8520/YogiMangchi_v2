package com.yogimangchi.content.community;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class CommunityUxSseService {
    private static final long SSE_TIMEOUT_MS = 30L * 60 * 1000;
    public static final int DEFAULT_MAX_EMITTERS = 2000;

    public record PostCreatedUxEvent(
            Long postId,
            String title,
            Long authorId,
            String authorNickname,
            String category,
            String symbolTag,
            Instant createdAt,
            CommunityService.CommunityPostResponse post
    ) { }

    private final int maxEmitters;
    private final AtomicLong emitterSequence = new AtomicLong();
    private final ConcurrentSkipListMap<Long, SseEmitter> emitters = new ConcurrentSkipListMap<>();
    private final ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "community-ux-sse-heartbeat");
        thread.setDaemon(true);
        return thread;
    });

    public CommunityUxSseService() {
        this(DEFAULT_MAX_EMITTERS);
    }

    @Autowired
    public CommunityUxSseService(@Value("${content.sse.max-emitters:2000}") int maxEmitters) {
        this.maxEmitters = Math.max(1, maxEmitters);
        this.heartbeatExecutor.scheduleWithFixedDelay(this::sendHeartbeat, 25, 25, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void shutdown() {
        heartbeatExecutor.shutdownNow();
        while (!emitters.isEmpty()) {
            Map.Entry<Long, SseEmitter> entry = emitters.pollFirstEntry();
            if (entry != null) {
                completeQuietly(entry.getValue());
            }
        }
    }

    public int activeConnectionCount() {
        return emitters.size();
    }

    public int maxEmitters() {
        return maxEmitters;
    }

    public SseEmitter subscribeFeed() {
        SseEmitter emitter = newEmitter();
        long id = registerEmitter(emitter);

        try {
            emitter.send(SseEmitter.event()
                    .name("CONNECTED")
                    .data(Map.of("status", "CONNECTED", "timestamp", Instant.now().toString()), MediaType.APPLICATION_JSON));
        } catch (IOException e) {
            emitters.remove(id, emitter);
            completeQuietly(emitter);
        }
        return emitter;
    }

    public void sendHeartbeat() {
        for (Map.Entry<Long, SseEmitter> entry : emitters.entrySet()) {
            SseEmitter emitter = entry.getValue();
            try {
                emitter.send(SseEmitter.event().comment("heartbeat"));
            } catch (Exception e) {
                emitters.remove(entry.getKey(), emitter);
                completeQuietly(emitter);
            }
        }
    }

    public void publishPostCreatedAfterCommit(PostCreatedUxEvent event) {
        if (event == null) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    broadcastPostCreated(event);
                }
            });
        } else {
            broadcastPostCreated(event);
        }
    }

    public void broadcastPostCreated(PostCreatedUxEvent event) {
        for (Map.Entry<Long, SseEmitter> entry : emitters.entrySet()) {
            SseEmitter emitter = entry.getValue();
            try {
                emitter.send(SseEmitter.event()
                        .name("UX_COMMUNITY_POST_CREATED")
                        .data(event, MediaType.APPLICATION_JSON));
            } catch (Exception e) {
                emitters.remove(entry.getKey(), emitter);
                completeQuietly(emitter);
            }
        }
    }

    protected SseEmitter newEmitter() {
        return new SseEmitter(SSE_TIMEOUT_MS);
    }

    long registerEmitter(SseEmitter emitter) {
        long id = emitterSequence.incrementAndGet();
        emitters.put(id, emitter);
        while (emitters.size() > maxEmitters) {
            Map.Entry<Long, SseEmitter> oldest = emitters.pollFirstEntry();
            if (oldest == null) {
                break;
            }
            if (oldest.getKey().longValue() == id) {
                emitters.put(id, emitter);
                break;
            }
            completeQuietly(oldest.getValue());
        }

        Runnable cleanup = () -> emitters.remove(id, emitter);
        emitter.onCompletion(cleanup);
        emitter.onTimeout(() -> {
            cleanup.run();
            completeQuietly(emitter);
        });
        emitter.onError(e -> cleanup.run());
        return id;
    }

    private static void completeQuietly(SseEmitter emitter) {
        try {
            emitter.complete();
        } catch (Exception ignored) {
        }
    }
}
