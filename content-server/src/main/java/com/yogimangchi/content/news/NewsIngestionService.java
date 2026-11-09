package com.yogimangchi.content.news;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
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
                    "https://news.google.com/rss/search?q=%EB%B9%84%ED%8A%B8%EC%BD%94%EC%9D%B8+OR+%EC%9D%B4%EB%8D%94%EB%A6%AC%EC%9B%80+OR+%EC%86%94%EB%9D%BC%EB%82%98+OR+%EB%A6%AC%ED%94%8C+when:1d&hl=ko&gl=KR&ceid=KR:ko"
            ),
            new FeedSource(
                    "BREAKING",
                    "ECONOMY_FLASH",
                    "Google News 경제속보",
                    "https://news.google.com/rss/search?q=%EC%97%B0%EC%A4%80+OR+FOMC+OR+%EB%82%98%EC%8A%A4%EB%8B%A5+OR+%EB%AC%BC%EA%B0%80+when:1d&hl=ko&gl=KR&ceid=KR:ko"
            ),
            new FeedSource(
                    "NEWSROOM",
                    "CRYPTO",
                    "Google News 가상자산",
                    "https://news.google.com/rss/search?q=%EA%B0%80%EC%83%81%EC%9E%90%EC%82%B0+OR+%EC%95%94%ED%98%88%ED%99%94%ED%8F%90+OR+%EC%98%A8%EC%B2%B4%EC%9D%B8+when:1d&hl=ko&gl=KR&ceid=KR:ko"
            ),
            new FeedSource(
                    "NEWSROOM",
                    "STOCKS",
                    "Google News 해외증시",
                    "https://news.google.com/rss/search?q=%ED%95%B4%EC%99%B8%EC%A6%9D%EC%8B%9C+OR+%EB%89%B4%EC%9A%95%EC%A6%9D%EC%8B%9C+OR+S%26P500+OR+%EC%97%94%EB%B9%84%EB%94%94%EC%95%84+when:1d&hl=ko&gl=KR&ceid=KR:ko"
            ),
            new FeedSource(
                    "NEWSROOM",
                    "FX_RATES",
                    "Google News 환율·금리",
                    "https://news.google.com/rss/search?q=%EC%9B%90%EB%8B%AC%EB%9F%AC+%ED%99%98%EC%9C%A8+OR+%EA%B5%AD%EC%B1%84%EA%B8%88%EB%A6%AC+OR+%EA%B8%B0%EC%A4%80%EA%B8%88%EB%A6%AC+when:1d&hl=ko&gl=KR&ceid=KR:ko"
            )
    );

    private final JdbcTemplate jdbc;
    private final NewsSseService sse;
    private final int maxItemsPerFeed;
    private final HttpClient httpClient;
    private final Set<String> seenHashes = ConcurrentHashMap.newKeySet();

    public NewsIngestionService(
            JdbcTemplate jdbc,
            NewsSseService sse,
            @Value("${content.news.collector.max-items-per-feed:8}") int maxItemsPerFeed) {
        this.jdbc = jdbc;
        this.sse = sse;
        this.maxItemsPerFeed = Math.max(1, Math.min(25, maxItemsPerFeed));
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(4))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    public int collectAllDefaultFeeds() {
        int totalInserted = 0;
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
        if (totalInserted > 0) {
            log.info("Ingested {} new real-time RSS news articles across feeds", totalInserted);
        }
        return totalInserted;
    }

    public List<NewsService.NewsItemResponse> ingestRssXml(String xmlContent, String section, String subCategory, int maxItems) {
        List<NewsRssParser.ParsedFeedItem> parsedItems = NewsRssParser.parse(xmlContent, "공식 뉴스 피드", subCategory, maxItems);
        if (parsedItems.isEmpty()) {
            return List.of();
        }

        // Reverse so older items in the feed are inserted first and newer items receive higher IDs
        List<NewsRssParser.ParsedFeedItem> chronological = new ArrayList<>(parsedItems);
        Collections.reverse(chronological);

        List<NewsService.NewsItemResponse> newlyInserted = new ArrayList<>();
        for (NewsRssParser.ParsedFeedItem item : chronological) {
            String externalHash = NewsAnalyzer.computeExternalHash(item.title(), item.sourceUrl());
            NewsAnalyzer.AnalysisResult analysis = NewsAnalyzer.analyze(item.title(), item.summary(), section, subCategory);
            String legalContent = item.summary()
                    + "\n\n" + analysis.aiSummary()
                    + "\n\n[출처: " + item.sourceName() + "] 본 기사는 공개 RSS 메타데이터 기반 요약 브리핑이며, 전체 기사 전문은 언론사 원문 링크에서 확인하실 수 있습니다.";

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
                    legalContent,
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
