package com.yogimangchi.content.community;

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
public class CommunityUxSseService {
    private static final long SSE_TIMEOUT_MS = 30L * 60 * 1000;

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

    private final Set<SseEmitter> emitters = ConcurrentHashMap.newKeySet();

    public SseEmitter subscribeFeed() {
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
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event()
                        .name("UX_COMMUNITY_POST_CREATED")
                        .data(event, MediaType.APPLICATION_JSON));
            } catch (Exception e) {
                emitters.remove(emitter);
            }
        }
    }
}
