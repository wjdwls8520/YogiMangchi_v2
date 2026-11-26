package com.yogimangchi.content.notification;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class ContentNotificationSseService {
    private static final long SSE_TIMEOUT_MS = 30L * 60 * 1000;
    private static final int MAX_EMITTERS_PER_MEMBER = 5;

    private final Map<Long, Set<SseEmitter>> emittersByMember = new ConcurrentHashMap<>();
    private final Map<SseEmitter, Runnable> releaseCallbacks = new ConcurrentHashMap<>();
    private final ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "content-notification-sse-heartbeat");
        thread.setDaemon(true);
        return thread;
    });

    public ContentNotificationSseService() {
        heartbeatExecutor.scheduleWithFixedDelay(this::sendHeartbeat, 25, 25, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void shutdown() {
        heartbeatExecutor.shutdownNow();
        for (Set<SseEmitter> set : emittersByMember.values()) {
            for (SseEmitter emitter : set) {
                try {
                    emitter.complete();
                } catch (Exception ignored) {
                }
            }
        }
        emittersByMember.clear();
    }

    public SseEmitter subscribe(
            Long memberId,
            ContentNotificationService.NotificationStatusResponse initialStatus,
            List<ContentNotificationService.ReplayEvent> missedEvents) {
        return subscribe(memberId, initialStatus, missedEvents, null);
    }

    public SseEmitter subscribe(
            Long memberId,
            ContentNotificationService.NotificationStatusResponse initialStatus,
            List<ContentNotificationService.ReplayEvent> missedEvents,
            Runnable onRelease) {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        Set<SseEmitter> memberEmitters = emittersByMember.computeIfAbsent(memberId, k -> ConcurrentHashMap.newKeySet());
        if (memberEmitters.size() >= MAX_EMITTERS_PER_MEMBER) {
            SseEmitter oldest = memberEmitters.iterator().next();
            removeEmitter(memberId, oldest);
            try {
                oldest.complete();
            } catch (Exception ignored) {
            }
        }
        memberEmitters.add(emitter);
        if (onRelease != null) {
            releaseCallbacks.put(emitter, onRelease);
        }

        Runnable cleanup = () -> removeEmitter(memberId, emitter);
        emitter.onCompletion(cleanup);
        emitter.onTimeout(() -> {
            cleanup.run();
            try {
                emitter.complete();
            } catch (Exception ignored) {
            }
        });
        emitter.onError(e -> cleanup.run());

        try {
            emitter.send(SseEmitter.event()
                    .name("CONNECTED")
                    .data(Map.of("status", "CONNECTED", "source", "CONTENT", "timestamp", Instant.now().toString()), MediaType.APPLICATION_JSON));
            if (initialStatus != null) {
                emitter.send(SseEmitter.event()
                        .name("STATUS")
                        .data(initialStatus, MediaType.APPLICATION_JSON));
            }
            if (missedEvents != null) {
                for (ContentNotificationService.ReplayEvent replay : missedEvents) {
                    emitter.send(SseEmitter.event()
                            .id(String.valueOf(replay.notification().notificationId()))
                            .name(replay.eventName())
                            .data(replay.notification(), MediaType.APPLICATION_JSON));
                }
            }
        } catch (IOException e) {
            cleanup.run();
        }
        return emitter;
    }

    public void sendNotification(
            Long memberId,
            String eventName,
            ContentNotificationService.NotificationItemResponse notification,
            ContentNotificationService.NotificationStatusResponse status) {
        Set<SseEmitter> memberEmitters = emittersByMember.get(memberId);
        if (memberEmitters == null || memberEmitters.isEmpty()) {
            return;
        }
        for (SseEmitter emitter : memberEmitters) {
            try {
                if (notification != null && eventName != null) {
                    emitter.send(SseEmitter.event()
                            .id(String.valueOf(notification.notificationId()))
                            .name(eventName)
                            .data(notification, MediaType.APPLICATION_JSON));
                }
                if (status != null) {
                    emitter.send(SseEmitter.event()
                            .name("STATUS")
                            .data(status, MediaType.APPLICATION_JSON));
                }
            } catch (Exception e) {
                removeEmitter(memberId, emitter);
            }
        }
    }

    public void sendStatus(Long memberId, ContentNotificationService.NotificationStatusResponse status) {
        if (status == null) {
            return;
        }
        Set<SseEmitter> memberEmitters = emittersByMember.get(memberId);
        if (memberEmitters == null || memberEmitters.isEmpty()) {
            return;
        }
        for (SseEmitter emitter : memberEmitters) {
            try {
                emitter.send(SseEmitter.event()
                        .name("STATUS")
                        .data(status, MediaType.APPLICATION_JSON));
            } catch (Exception e) {
                removeEmitter(memberId, emitter);
            }
        }
    }

    public boolean hasActiveConnection(Long memberId) {
        if (memberId == null) {
            return false;
        }
        Set<SseEmitter> memberEmitters = emittersByMember.get(memberId);
        return memberEmitters != null && !memberEmitters.isEmpty();
    }

    public int activeConnectionCount() {
        return emittersByMember.values().stream().mapToInt(Set::size).sum();
    }

    public void disconnectMember(Long memberId) {
        if (memberId == null) {
            return;
        }
        Set<SseEmitter> removed = emittersByMember.remove(memberId);
        if (removed != null) {
            for (SseEmitter emitter : removed) {
                Runnable release = releaseCallbacks.remove(emitter);
                if (release != null) {
                    try {
                        release.run();
                    } catch (Exception ignored) {
                    }
                }
                try {
                    emitter.complete();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private void removeEmitter(Long memberId, SseEmitter emitter) {
        Set<SseEmitter> set = emittersByMember.get(memberId);
        if (set != null) {
            set.remove(emitter);
            if (set.isEmpty()) {
                emittersByMember.remove(memberId, set);
            }
        }
        Runnable release = releaseCallbacks.remove(emitter);
        if (release != null) {
            try {
                release.run();
            } catch (Exception ignored) {
            }
        }
    }

    private void sendHeartbeat() {
        for (Map.Entry<Long, Set<SseEmitter>> entry : emittersByMember.entrySet()) {
            Long memberId = entry.getKey();
            for (SseEmitter emitter : entry.getValue()) {
                try {
                    emitter.send(SseEmitter.event().comment("heartbeat"));
                } catch (Exception e) {
                    removeEmitter(memberId, emitter);
                }
            }
        }
    }
}
