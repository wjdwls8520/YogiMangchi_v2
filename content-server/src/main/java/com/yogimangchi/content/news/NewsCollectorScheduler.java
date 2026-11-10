package com.yogimangchi.content.news;

import java.util.concurrent.CompletableFuture;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
@ConditionalOnProperty(name = "content.news.collector.enabled", havingValue = "true", matchIfMissing = true)
public class NewsCollectorScheduler {
    private final NewsIngestionService ingestion;

    public NewsCollectorScheduler(NewsIngestionService ingestion) {
        this.ingestion = ingestion;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void collectOnStartup() {
        CompletableFuture.runAsync(ingestion::collectAllDefaultFeeds);
    }

    @Scheduled(
            fixedDelayString = "${content.news.collector.interval-ms:60000}",
            initialDelayString = "${content.news.collector.initial-delay-ms:60000}"
    )
    public void collectPeriodically() {
        ingestion.collectAllDefaultFeeds();
    }
}
