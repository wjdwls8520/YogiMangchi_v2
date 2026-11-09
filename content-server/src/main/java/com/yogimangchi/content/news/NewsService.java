package com.yogimangchi.content.news;

import com.yogimangchi.content.error.AuthFailure;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NewsService {
    private static final Set<String> CATEGORIES = Set.of("CRYPTO", "MACRO", "ONCHAIN", "REGULATION");
    private static final Set<String> SECTIONS = Set.of("BREAKING", "NEWSROOM");
    private static final Set<String> SUB_CATEGORIES = Set.of("COIN_FLASH", "ECONOMY_FLASH", "CRYPTO", "STOCKS", "FX_RATES");
    private static final Set<String> SORTS = Set.of("LATEST", "POPULAR");

    static final String SELECT_COLUMNS =
            "id, category, section, sub_category, title, summary, content, source_name, source_url, "
                    + "thumbnail_url, ai_summary, sentiment, bull_count, bear_count, view_count, symbol_tag, published_at";

    public record NewsItemResponse(
            Long id,
            String category,
            String section,
            String subCategory,
            String title,
            String summary,
            String content,
            String sourceName,
            String sourceUrl,
            String thumbnailUrl,
            String aiSummary,
            String sentiment,
            int bullCount,
            int bearCount,
            int viewCount,
            String symbolTag,
            Instant publishedAt
    ) { }

    public record NewsPageResponse(
            List<NewsItemResponse> items,
            boolean hasNext,
            Long nextCursorId
    ) { }

    public record NewsReactionRequest(
            String reaction
    ) { }

    public record NewsReactionResponse(
            Long newsId,
            String reaction,
            int bullCount,
            int bearCount,
            int bullPct,
            int bearPct
    ) { }

    public record KeywordIssueItem(
            String keyword,
            String label,
            int articleCount,
            String sentiment,
            List<NewsItemResponse> articles
    ) { }

    public record SentimentSummary(
            long totalBullVotes,
            long totalBearVotes,
            int bullPct,
            int bearPct,
            String dominantSentiment
    ) { }

    public record NewsLiveStatus(
            boolean live,
            boolean collectorEnabled,
            int retentionHours,
            Instant lastCollectedAt
    ) { }

    public record NewsHighlightsResponse(
            List<NewsItemResponse> mustReadBreaking,
            List<NewsItemResponse> popularByViews,
            List<NewsItemResponse> popularByReactions,
            List<KeywordIssueItem> keywordIssues,
            List<NewsItemResponse> recommendedNewsroom,
            SentimentSummary sentimentSummary,
            NewsLiveStatus liveStatus
    ) { }

    private final JdbcTemplate jdbc;
    private final NewsSseService sse;

    public NewsService(JdbcTemplate jdbc, NewsSseService sse) {
        this.jdbc = jdbc;
        this.sse = sse;
    }

    @Transactional(readOnly = true, timeout = 3)
    public NewsPageResponse list(String category, String symbolTag, String keyword, Long cursorId, Integer size) {
        return list(category, null, null, "LATEST", symbolTag, keyword, cursorId, size);
    }

    @Transactional(readOnly = true, timeout = 3)
    public NewsPageResponse list(
            String category,
            String section,
            String subCategory,
            String sort,
            String symbolTag,
            String keyword,
            Long cursorId,
            Integer size) {
        int limit = size == null ? 10 : size;
        if (limit < 1 || limit > 30 || cursorId != null && cursorId <= 0) {
            throw invalidRequest();
        }

        String normalizedCategory = null;
        if (category != null && !category.isBlank()) {
            normalizedCategory = category.strip().toUpperCase(Locale.ROOT);
            if (!CATEGORIES.contains(normalizedCategory)) {
                throw invalidRequest();
            }
        }

        String normalizedSection = null;
        if (section != null && !section.isBlank()) {
            normalizedSection = section.strip().toUpperCase(Locale.ROOT);
            if (!SECTIONS.contains(normalizedSection)) {
                throw invalidRequest();
            }
        }

        String normalizedSubCategory = null;
        if (subCategory != null && !subCategory.isBlank()) {
            normalizedSubCategory = subCategory.strip().toUpperCase(Locale.ROOT);
            if (!SUB_CATEGORIES.contains(normalizedSubCategory)) {
                throw invalidRequest();
            }
        }

        String normalizedSort = "LATEST";
        if (sort != null && !sort.isBlank()) {
            normalizedSort = sort.strip().toUpperCase(Locale.ROOT);
            if (!SORTS.contains(normalizedSort)) {
                throw invalidRequest();
            }
        }

        String normalizedSymbol = null;
        if (symbolTag != null && !symbolTag.isBlank()) {
            normalizedSymbol = symbolTag.strip().toUpperCase(Locale.ROOT);
            if (normalizedSymbol.length() > 24 || normalizedSymbol.indexOf('\0') >= 0 || !normalizedSymbol.matches("[A-Z0-9]{1,24}")) {
                throw invalidRequest();
            }
        }

        String search = "";
        if (keyword != null) {
            if (keyword.codePointCount(0, keyword.length()) > 40 || keyword.indexOf('\0') >= 0) {
                throw invalidRequest();
            }
            search = keyword.strip();
        }

        StringBuilder sql = new StringBuilder("select ")
                .append(SELECT_COLUMNS)
                .append(" from content.news_article where id < ?");
        List<Object> params = new ArrayList<>();
        params.add(cursorId == null ? Long.MAX_VALUE : cursorId);

        if (normalizedCategory != null) {
            sql.append(" and category = ?");
            params.add(normalizedCategory);
        }
        if (normalizedSection != null) {
            sql.append(" and section = ?");
            params.add(normalizedSection);
        }
        if (normalizedSubCategory != null) {
            sql.append(" and sub_category = ?");
            params.add(normalizedSubCategory);
        }
        if (normalizedSymbol != null) {
            sql.append(" and symbol_tag = ?");
            params.add(normalizedSymbol);
        }
        if (!search.isEmpty()) {
            sql.append(" and (position(lower(?) in lower(title)) > 0 or position(lower(?) in lower(summary)) > 0)");
            params.add(search);
            params.add(search);
        }
        if ("POPULAR".equals(normalizedSort)) {
            sql.append(" order by (bull_count + bear_count + view_count) desc, id desc limit ?");
        } else {
            sql.append(" order by id desc limit ?");
        }
        params.add(limit + 1);

        var rows = jdbc.query(sql.toString(), NewsService::mapRow, params.toArray());
        boolean hasNext = rows.size() > limit;
        var page = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;
        return new NewsPageResponse(page, hasNext, nextCursorId);
    }

    @Transactional(timeout = 3)
    public NewsItemResponse get(Long newsId) {
        if (newsId == null || newsId <= 0) {
            throw notFound();
        }
        var rows = jdbc.query(
                "update content.news_article set view_count = view_count + 1 where id = ? returning " + SELECT_COLUMNS,
                NewsService::mapRow,
                newsId);
        if (rows.isEmpty()) {
            throw notFound();
        }
        return rows.get(0);
    }

    @Transactional(timeout = 3)
    public NewsReactionResponse react(Long newsId, String rawReaction) {
        if (newsId == null || newsId <= 0) {
            throw notFound();
        }
        if (rawReaction == null || rawReaction.isBlank()) {
            throw invalidRequest();
        }
        String normalized = rawReaction.strip().toUpperCase(Locale.ROOT);
        boolean isBull;
        if ("BULL".equals(normalized) || "BULLISH".equals(normalized) || "UP".equals(normalized)) {
            isBull = true;
        } else if ("BEAR".equals(normalized) || "BEARISH".equals(normalized) || "DOWN".equals(normalized)) {
            isBull = false;
        } else {
            throw invalidRequest();
        }

        String updateSql = isBull
                ? "update content.news_article set bull_count = bull_count + 1 where id = ? returning id, bull_count, bear_count"
                : "update content.news_article set bear_count = bear_count + 1 where id = ? returning id, bull_count, bear_count";

        var rows = jdbc.query(updateSql, (rs, rowNum) -> {
            int bull = rs.getInt("bull_count");
            int bear = rs.getInt("bear_count");
            int total = bull + bear;
            int bullPct = total > 0 ? Math.round((bull * 100.0f) / total) : 50;
            int bearPct = total > 0 ? (100 - bullPct) : 50;
            return new NewsReactionResponse(
                    rs.getLong("id"),
                    isBull ? "BULL" : "BEAR",
                    bull,
                    bear,
                    bullPct,
                    bearPct
            );
        }, newsId);

        if (rows.isEmpty()) {
            throw notFound();
        }
        NewsReactionResponse response = rows.get(0);
        sse.publishReactionUpdatedAfterCommit(response);
        return response;
    }

    @Transactional(readOnly = true, timeout = 3)
    public NewsHighlightsResponse highlights() {
        List<NewsItemResponse> mustReadBreaking = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article "
                        + "where section = 'BREAKING' "
                        + "order by (bull_count + bear_count + view_count) desc, id desc limit 3",
                NewsService::mapRow);

        List<NewsItemResponse> popularByViews = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article "
                        + "order by view_count desc, id desc limit 4",
                NewsService::mapRow);

        List<NewsItemResponse> popularByReactions = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article "
                        + "order by (bull_count + bear_count) desc, id desc limit 4",
                NewsService::mapRow);

        List<NewsItemResponse> recommendedNewsroom = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article "
                        + "where section = 'NEWSROOM' "
                        + "order by (bull_count + bear_count + view_count) desc, id desc limit 3",
                NewsService::mapRow);

        List<NewsItemResponse> recentPool = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article order by id desc limit 40",
                NewsService::mapRow);

        List<KeywordIssueItem> keywordIssues = buildKeywordIssues(recentPool);
        SentimentSummary sentimentSummary = buildSentimentSummary(recentPool);

        return new NewsHighlightsResponse(
                mustReadBreaking,
                popularByViews,
                popularByReactions,
                keywordIssues,
                recommendedNewsroom,
                sentimentSummary,
                sse.currentLiveStatus()
        );
    }

    private static List<KeywordIssueItem> buildKeywordIssues(List<NewsItemResponse> recentPool) {
        List<NewsItemResponse> btcArticles = recentPool.stream()
                .filter(a -> "BTC".equals(a.symbolTag()) || a.title().contains("비트코인"))
                .limit(3)
                .toList();
        List<NewsItemResponse> macroArticles = recentPool.stream()
                .filter(a -> "MACRO".equals(a.category()) || "ECONOMY_FLASH".equals(a.subCategory()) || "STOCKS".equals(a.subCategory()) || "FX_RATES".equals(a.subCategory()))
                .limit(3)
                .toList();
        List<NewsItemResponse> altArticles = recentPool.stream()
                .filter(a -> "ETH".equals(a.symbolTag()) || "SOL".equals(a.symbolTag()) || "XRP".equals(a.symbolTag()) || "ONCHAIN".equals(a.category()))
                .limit(3)
                .toList();

        List<KeywordIssueItem> result = new ArrayList<>(3);
        result.add(new KeywordIssueItem(
                "#BTC 수급·미결제약정",
                "비트코인 현물·선물 수급 동향",
                Math.max(1, btcArticles.size()),
                dominantSentimentOf(btcArticles),
                btcArticles.isEmpty() ? recentPool.stream().limit(2).toList() : btcArticles
        ));
        result.add(new KeywordIssueItem(
                "#연준·나스닥·환율",
                "거시경제 지표 및 글로벌 증시 동조화",
                Math.max(1, macroArticles.size()),
                dominantSentimentOf(macroArticles),
                macroArticles.isEmpty() ? recentPool.stream().limit(2).toList() : macroArticles
        ));
        result.add(new KeywordIssueItem(
                "#ETH·SOL 온체인",
                "메이저 알트코인 생태계 및 스테이킹",
                Math.max(1, altArticles.size()),
                dominantSentimentOf(altArticles),
                altArticles.isEmpty() ? recentPool.stream().limit(2).toList() : altArticles
        ));
        return result;
    }

    private static String dominantSentimentOf(List<NewsItemResponse> items) {
        int bull = 0;
        int bear = 0;
        for (NewsItemResponse item : items) {
            if ("BULLISH".equals(item.sentiment())) {
                bull++;
            } else if ("BEARISH".equals(item.sentiment())) {
                bear++;
            }
        }
        return bull >= bear ? "BULLISH" : "BEARISH";
    }

    private static SentimentSummary buildSentimentSummary(List<NewsItemResponse> recentPool) {
        long totalBull = 0L;
        long totalBear = 0L;
        for (NewsItemResponse item : recentPool) {
            totalBull += item.bullCount();
            totalBear += item.bearCount();
        }
        long sum = totalBull + totalBear;
        int bullPct = sum > 0 ? Math.round((totalBull * 100.0f) / sum) : 50;
        int bearPct = sum > 0 ? (100 - bullPct) : 50;
        String dominant = bullPct >= 55 ? "BULLISH" : (bearPct >= 55 ? "BEARISH" : "NEUTRAL");
        return new SentimentSummary(totalBull, totalBear, bullPct, bearPct, dominant);
    }

    static NewsItemResponse mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new NewsItemResponse(
                rs.getLong("id"),
                rs.getString("category"),
                rs.getString("section"),
                rs.getString("sub_category"),
                rs.getString("title"),
                rs.getString("summary"),
                rs.getString("content"),
                rs.getString("source_name"),
                rs.getString("source_url"),
                rs.getString("thumbnail_url"),
                rs.getString("ai_summary"),
                rs.getString("sentiment"),
                rs.getInt("bull_count"),
                rs.getInt("bear_count"),
                rs.getInt("view_count"),
                rs.getString("symbol_tag"),
                rs.getTimestamp("published_at").toInstant()
        );
    }

    private static AuthFailure invalidRequest() {
        return new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
    }

    private static AuthFailure notFound() {
        return new AuthFailure("RESOURCE_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
}
