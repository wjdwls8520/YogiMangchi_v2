package com.yogimangchi.content.news;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class NewsSseService {
    private static final long SSE_TIMEOUT_MS = 30L * 60 * 1000;

    private final Set<SseEmitter> emitters = ConcurrentHashMap.newKeySet();

    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> {
            emitters.remove(emitter);
            emitter.complete();
        });
        emitter.onError(e -> emitters.remove(emitter));

        try {
            emitter.send(SseEmitter.event()
                    .name("CONNECTED")
                    .data(Map.of("status", "CONNECTED", "timestamp", Instant.now().toString()), MediaType.APPLICATION_JSON));
        } catch (IOException e) {
            emitters.remove(emitter);
        }
        return emitter;
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
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event()
                        .name("NEWS_CREATED")
                        .data(item, MediaType.APPLICATION_JSON));
            } catch (Exception e) {
                emitters.remove(emitter);
            }
        }
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
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event()
                        .name("NEWS_REACTION_UPDATED")
                        .data(reaction, MediaType.APPLICATION_JSON));
            } catch (Exception e) {
                emitters.remove(emitter);
            }
        }
    }
}
