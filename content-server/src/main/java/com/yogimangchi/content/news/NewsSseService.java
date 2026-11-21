package com.yogimangchi.content.news;

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
public class NewsSseService {
    private static final long SSE_TIMEOUT_MS = 30L * 60 * 1000;
    public static final int DEFAULT_MAX_EMITTERS = 2000;

    private final int maxEmitters;
    private final AtomicLong emitterSequence = new AtomicLong();
    private final ConcurrentSkipListMap<Long, SseEmitter> emitters = new ConcurrentSkipListMap<>();
    private final ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "news-sse-heartbeat");
        thread.setDaemon(true);
        return thread;
    });
    private volatile NewsService.NewsLiveStatus liveStatus;

    public NewsSseService(boolean collectorEnabled, int retentionHours) {
        this(collectorEnabled, retentionHours, DEFAULT_MAX_EMITTERS);
    }

    @Autowired
    public NewsSseService(
            @Value("${content.news.collector.enabled:true}") boolean collectorEnabled,
            @Value("${content.news.collector.breaking-retention-hours:6}") int retentionHours,
            @Value("${content.sse.max-emitters:2000}") int maxEmitters) {
        this.maxEmitters = Math.max(1, maxEmitters);
        int effectiveHours = Math.max(1, Math.min(24, retentionHours));
        this.liveStatus = new NewsService.NewsLiveStatus(
                collectorEnabled,
                collectorEnabled,
                effectiveHours,
                collectorEnabled ? Instant.now() : null
        );
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

    public NewsService.NewsLiveStatus currentLiveStatus() {
        return liveStatus;
    }

    public int activeConnectionCount() {
        return emitters.size();
    }

    public int maxEmitters() {
        return maxEmitters;
    }

    public void updateLiveStatus(NewsService.NewsLiveStatus updated) {
        if (updated == null) {
            return;
        }
        this.liveStatus = updated;
        broadcastEvent("NEWS_LIVE_STATUS", updated);
    }

    public SseEmitter subscribe() {
        SseEmitter emitter = newEmitter();
        long id = registerEmitter(emitter);

        try {
            emitter.send(SseEmitter.event()
                    .name("CONNECTED")
                    .data(Map.of(
                            "status", "CONNECTED",
                            "timestamp", Instant.now().toString(),
                            "liveStatus", liveStatus
                    ), MediaType.APPLICATION_JSON));
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

    public void publishNewsCreatedAfterCommit(NewsService.NewsItemResponse item) {
        if (item == null) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    broadcastNewsCreated(item);
                }
            });
        } else {
            broadcastNewsCreated(item);
        }
    }

    public void broadcastNewsCreated(NewsService.NewsItemResponse item) {
        broadcastEvent("NEWS_CREATED", item);
    }

    public void publishReactionUpdatedAfterCommit(NewsService.NewsReactionResponse reaction) {
        if (reaction == null) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    broadcastReactionUpdated(reaction);
                }
            });
        } else {
            broadcastReactionUpdated(reaction);
        }
    }

    public void broadcastReactionUpdated(NewsService.NewsReactionResponse reaction) {
        broadcastEvent("NEWS_REACTION_UPDATED", reaction);
    }

    public void publishSentimentUpdatedAfterCommit(NewsService.SentimentSummary summary) {
        if (summary == null) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    broadcastSentimentUpdated(summary);
                }
            });
        } else {
            broadcastSentimentUpdated(summary);
        }
    }

    public void broadcastSentimentUpdated(NewsService.SentimentSummary summary) {
        broadcastEvent("NEWS_SENTIMENT_UPDATED", summary);
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

    private void broadcastEvent(String eventName, Object payload) {
        for (Map.Entry<Long, SseEmitter> entry : emitters.entrySet()) {
            SseEmitter emitter = entry.getValue();
            try {
                emitter.send(SseEmitter.event()
                        .name(eventName)
                        .data(payload, MediaType.APPLICATION_JSON));
            } catch (Exception e) {
                emitters.remove(entry.getKey(), emitter);
                completeQuietly(emitter);
            }
        }
    }

    private static void completeQuietly(SseEmitter emitter) {
        try {
            emitter.complete();
        } catch (Exception ignored) {
        }
    }
}
