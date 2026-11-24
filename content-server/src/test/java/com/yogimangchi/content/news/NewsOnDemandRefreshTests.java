package com.yogimangchi.content.news;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class NewsOnDemandRefreshTests {

    @Test
    void disabledCollectorNeverTriggersOnDemandRefresh() {
        var service = new NewsIngestionService(mock(JdbcTemplate.class), mock(NewsSseService.class), null, false, 8, 6, 60_000L);
        try {
            var runs = new AtomicInteger();
            assertThat(service.triggerRefreshIfStale(Clock.systemUTC(), runs::incrementAndGet)).isFalse();
            assertThat(runs).hasValue(0);
        } finally {
            service.shutdown();
        }
    }

    @Test
    void enforcesSingleFlightAndCooldownWhileRunningAsynchronously() throws Exception {
        var now = new AtomicReference<>(Instant.parse("2026-11-23T00:00:00Z"));
        Clock clock = new Clock() {
            @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(java.time.ZoneId zone) { return this; }
            @Override public Instant instant() { return now.get(); }
        };

        var service = new NewsIngestionService(mock(JdbcTemplate.class), mock(NewsSseService.class), null, true, 8, 6, 60_000L);
        try {
            var runs = new AtomicInteger();
            var started = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            var finished = new CountDownLatch(1);

            // 1. First visitor triggers async refresh immediately.
            boolean triggered1 = service.triggerRefreshIfStale(clock, () -> {
                runs.incrementAndGet();
                started.countDown();
                try {
                    release.await(3, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    finished.countDown();
                }
            });
            assertThat(triggered1).isTrue();
            assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();

            // 2. Concurrent request while in-flight is rejected (single-flight).
            assertThat(service.triggerRefreshIfStale(clock, runs::incrementAndGet)).isFalse();

            release.countDown();
            assertThat(finished.await(2, TimeUnit.SECONDS)).isTrue();
            // Brief sync wait so finally block updates lastCollectionCompletedAt and clears in-flight.
            now.set(now.get().plusSeconds(30));
            Thread.sleep(50);

            // 3. Within 60s cooldown -> skipped.
            assertThat(service.triggerRefreshIfStale(clock, runs::incrementAndGet)).isFalse();
            assertThat(runs).hasValue(1);

            // 4. After 60s cooldown elapses -> next visitor triggers fresh async refresh.
            now.set(now.get().plusSeconds(31));
            var secondFinished = new CountDownLatch(1);
            assertThat(service.triggerRefreshIfStale(clock, () -> {
                runs.incrementAndGet();
                secondFinished.countDown();
            })).isTrue();
            assertThat(secondFinished.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(runs).hasValue(2);
        } finally {
            service.shutdown();
        }
    }

    @Test
    void newsControllerTriggersOnDemandRefreshOnListHighlightsAndStream() {
        NewsService newsService = mock(NewsService.class);
        NewsSseService sseService = mock(NewsSseService.class);
        NewsIngestionService ingestion = mock(NewsIngestionService.class);
        when(sseService.subscribe(null)).thenReturn(new SseEmitter());

        var controller = new NewsController(newsService, sseService, null, ingestion);
        HttpServletRequest req = mock(HttpServletRequest.class);

        controller.list(null, null, null, null, null, null, null, null, null, req);
        controller.highlights();
        controller.stream(req);

        verify(ingestion, times(3)).triggerRefreshIfStale();
    }
}
