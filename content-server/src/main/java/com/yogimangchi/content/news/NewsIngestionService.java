package com.yogimangchi.content.news;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class NewsIngestionService {
    private static final Logger log = LoggerFactory.getLogger(NewsIngestionService.class);

    public record FeedSource(
            String section,
            String subCategory,
            String defaultSourceName,
            String url
    ) { }

    public static final List<FeedSource> DEFAULT_FEEDS = List.of(
            new FeedSource(
                    "BREAKING",
                    "COIN_FLASH",
                    "Google News 코인속보",
                    "https://news.google.com/rss/search?q=%EB%B9%84%ED%8A%B8%EC%BD%94%EC%9D%B8+%EC%86%8D%EB%B3%B4+OR+%EC%9D%B4%EB%8D%94%EB%A6%AC%EC%9B%80+%EA%B8%89%EB%93%B1+OR+%EC%86%94%EB%9D%BC%EB%82%98+%EB%8F%8C%ED%8C%8C+OR+%EB%A6%AC%ED%94%8C+%EA%B3%A0%EB%9E%98+OR+%EB%B0%94%EC%9D%B4%EB%82%B8%EC%8A%A4+%EC%83%81%EC%9E%A5+OR+%EC%BD%94%EC%9D%B8+%EC%B2%AD%EC%82%B0+when:1d&hl=ko&gl=KR&ceid=KR:ko"
            ),
            new FeedSource(
                    "BREAKING",
                    "ECONOMY_FLASH",
                    "Google News 경제속보",
                    "https://news.google.com/rss/search?q=%EB%AF%B8+%EC%97%B0%EC%A4%80+%EC%86%8D%EB%B3%B4+OR+FOMC+%EA%B8%88%EB%A6%AC+%EB%B0%9C%ED%91%9C+OR+%EB%AF%B8%EA%B5%AD+CPI+%EC%86%8D%EB%B3%B4+OR+%EB%82%98%EC%8A%A4%EB%8B%A5+%EC%9E%A5%EC%A4%91+OR+%EB%89%B4%EC%9A%95%EC%A6%9D%EC%8B%9C+%EC%86%8D%EB%B3%B4+when:1d&hl=ko&gl=KR&ceid=KR:ko"
            ),
            new FeedSource(
                    "NEWSROOM",
                    "CRYPTO",
                    "Google News 가상자산",
                    "https://news.google.com/rss/search?q=%EA%B0%80%EC%83%81%EC%9E%90%EC%82%B0+%EC%8B%9C%ED%99%A9+%EB%B6%84%EC%84%9D+OR+%EB%B9%84%ED%8A%B8%EC%BD%94%EC%9D%B8+%EA%B8%B0%EA%B4%80+%EC%88%98%EA%B8%89+OR+%EC%98%A8%EC%B2%B4%EC%9D%B8+%EB%A6%AC%ED%8F%AC%ED%8A%B8+OR+%EC%95%94%ED%98%88%ED%99%94%ED%8F%90+%EA%B7%9C%EC%A0%9C+%EB%8F%99%ED%96%A5+when:1d&hl=ko&gl=KR&ceid=KR:ko"
            ),
            new FeedSource(
                    "NEWSROOM",
                    "STOCKS",
                    "Google News 해외증시",
                    "https://news.google.com/rss/search?q=%EB%89%B4%EC%9A%95%EC%A6%9D%EC%8B%9C+%EC%8B%9C%ED%99%A9+%EB%B6%84%EC%84%9D+OR+%EB%82%98%EC%8A%A4%EB%8B%A5+%EB%B9%85%ED%85%8C%ED%81%AC+%EC%8B%A4%EC%A0%81+OR+S%26P500+%EC%9B%94%EA%B0%80+%EC%A0%84%EB%A7%9D+OR+%EB%AF%B8+%EC%A6%9D%EC%8B%9C+%EB%A7%88%EA%B0%90+when:1d&hl=ko&gl=KR&ceid=KR:ko"
            ),
            new FeedSource(
                    "NEWSROOM",
                    "FX_RATES",
                    "Google News 환율·금리",
                    "https://news.google.com/rss/search?q=%EC%9B%90%EB%8B%AC%EB%9F%AC+%ED%99%98%EC%9C%A8+%EC%A0%84%EB%A7%9D+OR+%EB%AF%B8%EA%B5%AD%EC%B1%84+%EA%B8%88%EB%A6%AC+%EB%B6%84%EC%84%9D+OR+%EA%B8%B0%EC%A4%80%EA%B8%88%EB%A6%AC+%ED%86%B5%ED%99%94%EC%A0%95%EC%B1%85+OR+%EC%99%B8%ED%99%98%EC%8B%9C%EC%9E%A5+%EB%8F%99%ED%96%A5+when:1d&hl=ko&gl=KR&ceid=KR:ko"
            )
    );

    private final JdbcTemplate jdbc;
    private final NewsSseService sse;
    private final boolean collectorEnabled;
    private final int maxItemsPerFeed;
    private final int breakingRetentionHours;
    private final HttpClient httpClient;
    private final Set<String> seenHashes = ConcurrentHashMap.newKeySet();
    private volatile int consecutiveFailures = 0;

    public NewsIngestionService(
            JdbcTemplate jdbc,
            NewsSseService sse,
            @Value("${content.news.collector.enabled:true}") boolean collectorEnabled,
            @Value("${content.news.collector.max-items-per-feed:8}") int maxItemsPerFeed,
            @Value("${content.news.collector.breaking-retention-hours:6}") int breakingRetentionHours) {
        this.jdbc = jdbc;
        this.sse = sse;
        this.collectorEnabled = collectorEnabled;
        this.maxItemsPerFeed = Math.max(1, Math.min(25, maxItemsPerFeed));
        this.breakingRetentionHours = Math.max(1, Math.min(24, breakingRetentionHours));
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(4))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    public int collectAllDefaultFeeds() {
        int totalInserted = 0;
        int succeededFeeds = 0;
        for (FeedSource feed : DEFAULT_FEEDS) {
            try {
                HttpRequest req = HttpRequest.newBuilder(URI.create(feed.url()))
                        .timeout(Duration.ofSeconds(5))
                        .header("User-Agent", "YogiMangchi-NewsReader/2.0 (+https://yogimangchi.com)")
                        .header("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8")
                        .GET()
                        .build();
                HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                if (res.statusCode() >= 200 && res.statusCode() < 300 && res.body() != null) {
                    succeededFeeds++;
                    List<NewsService.NewsItemResponse> inserted = ingestRssXml(
                            res.body(),
                            feed.section(),
                            feed.subCategory(),
                            maxItemsPerFeed);
                    totalInserted += inserted.size();
                } else {
                    log.debug("RSS feed returned non-200 status={} for subCategory={}", res.statusCode(), feed.subCategory());
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return totalInserted;
            } catch (Exception e) {
                log.debug("RSS feed fetch deferred for subCategory={}: {}", feed.subCategory(), e.getClass().getSimpleName());
            }
        }

        Instant now = Instant.now();
        purgeExpiredBreakingAndOverflowArticles(now);

        if (succeededFeeds > 0) {
            consecutiveFailures = 0;
            sse.updateLiveStatus(new NewsService.NewsLiveStatus(
                    collectorEnabled,
                    collectorEnabled,
                    breakingRetentionHours,
                    now
            ));
        } else {
            consecutiveFailures++;
            boolean stillLive = collectorEnabled && consecutiveFailures < 3;
            sse.updateLiveStatus(new NewsService.NewsLiveStatus(
                    stillLive,
                    collectorEnabled,
                    breakingRetentionHours,
                    sse.currentLiveStatus().lastCollectedAt()
            ));
        }

        if (totalInserted > 0) {
            log.info("Ingested {} new real-time RSS news articles across feeds", totalInserted);
        }
        return totalInserted;
    }

    public int purgeExpiredBreakingAndOverflowArticles(Instant now) {
        int purged = 0;
        try {
            Instant effectiveNow = now == null ? Instant.now() : now;
            Timestamp breakingCutoff = Timestamp.from(effectiveNow.minus(Duration.ofHours(breakingRetentionHours)));
            // Purge BREAKING flashes older than 6 hours (preserving seed rows with id <= 20 / seed-*)
            purged += jdbc.update(
                    "delete from content.news_article where id in ("
                            + "select id from content.news_article "
                            + "where section = 'BREAKING' and id > 20 "
                            + "and external_hash is not null and external_hash not like 'seed-%' "
                            + "and published_at < ? "
                            + "order by published_at asc, id asc limit 200"
                            + ")",
                    breakingCutoff);
            // Cap total external RSS rows at 1,000 to prevent unbounded DB growth
            purged += jdbc.update(
                    "delete from content.news_article where id in ("
                            + "select id from content.news_article "
                            + "where id > 20 and external_hash is not null and external_hash not like 'seed-%' "
                            + "order by id desc offset 1000 limit 200"
                            + ")");
        } catch (Exception e) {
            log.debug("News retention cleanup deferred: {}", e.getClass().getSimpleName());
        }
        return purged;
    }

    public List<NewsService.NewsItemResponse> ingestRssXml(String xmlContent, String section, String subCategory, int maxItems) {
        List<NewsRssParser.ParsedFeedItem> parsedItems = NewsRssParser.parse(xmlContent, "공식 뉴스 피드", subCategory, maxItems);
        if (parsedItems.isEmpty()) {
            return List.of();
        }

        // Reverse so older items in the feed are inserted first and newer items receive higher IDs
        List<NewsRssParser.ParsedFeedItem> chronological = new ArrayList<>(parsedItems);
        Collections.reverse(chronological);

        Instant breakingCutoff = Instant.now().minus(Duration.ofHours(breakingRetentionHours));
        List<NewsService.NewsItemResponse> newlyInserted = new ArrayList<>();
        for (NewsRssParser.ParsedFeedItem item : chronological) {
            // For BREAKING news, skip articles published more than 6 hours ago
            if ("BREAKING".equals(section) && item.publishedAt().isBefore(breakingCutoff)) {
                continue;
            }
            String externalHash = NewsAnalyzer.computeExternalHash(item.title(), item.sourceUrl());
            NewsAnalyzer.AnalysisResult analysis = NewsAnalyzer.analyze(item.title(), item.summary(), section, subCategory);
            String cleanContent = analysis.articleContent();

            var rows = jdbc.query(
                    "insert into content.news_article ("
                            + "category, section, sub_category, external_hash, title, summary, content, "
                            + "source_name, source_url, thumbnail_url, ai_summary, sentiment, "
                            + "bull_count, bear_count, view_count, symbol_tag, published_at"
                            + ") values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?) "
                            + "on conflict (external_hash) where external_hash is not null do nothing "
                            + "returning " + NewsService.SELECT_COLUMNS,
                    NewsService::mapRow,
                    analysis.category(),
                    section,
                    subCategory,
                    externalHash,
                    item.title(),
                    item.summary(),
                    cleanContent,
                    item.sourceName(),
                    item.sourceUrl(),
                    item.thumbnailUrl(),
                    analysis.aiSummary(),
                    analysis.sentiment(),
                    analysis.symbolTag(),
                    Timestamp.from(item.publishedAt())
            );

            if (!rows.isEmpty()) {
                NewsService.NewsItemResponse saved = rows.get(0);
                seenHashes.add(externalHash);
                newlyInserted.add(saved);
                sse.publishNewsCreatedAfterCommit(saved);
            }
        }
        return newlyInserted;
    }
}
