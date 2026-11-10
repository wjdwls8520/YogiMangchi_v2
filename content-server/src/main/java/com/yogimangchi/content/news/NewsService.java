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
    private static final Set<String> SORTS = Set.of("LATEST", "OLDEST", "POPULAR");

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
            String dominantSentiment,
            int bullishArticleCount,
            int bearishArticleCount,
            int neutralArticleCount,
            String summary
    ) {
        public SentimentSummary(
                long totalBullVotes,
                long totalBearVotes,
                int bullPct,
                int bearPct,
                String dominantSentiment) {
            this(totalBullVotes, totalBearVotes, bullPct, bearPct, dominantSentiment, 0, 0, 0, "");
        }
    }

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
                .append(" from content.news_article where 1 = 1");
        List<Object> params = new ArrayList<>();

        if (cursorId != null) {
            if ("OLDEST".equals(normalizedSort)) {
                sql.append(" and (published_at > coalesce((select c.published_at from content.news_article c where c.id = ?), TIMESTAMPTZ '-infinity') "
                        + "or (published_at = coalesce((select c.published_at from content.news_article c where c.id = ?), TIMESTAMPTZ '-infinity') and id > ?))");
                params.add(cursorId);
                params.add(cursorId);
                params.add(cursorId);
            } else if ("POPULAR".equals(normalizedSort)) {
                sql.append(" and (view_count < coalesce((select c.view_count from content.news_article c where c.id = ?), 2147483647) "
                        + "or (view_count = coalesce((select c.view_count from content.news_article c where c.id = ?), 2147483647) "
                        + "and (published_at < coalesce((select c.published_at from content.news_article c where c.id = ?), TIMESTAMPTZ 'infinity') "
                        + "or (published_at = coalesce((select c.published_at from content.news_article c where c.id = ?), TIMESTAMPTZ 'infinity') and id < ?))))");
                params.add(cursorId);
                params.add(cursorId);
                params.add(cursorId);
                params.add(cursorId);
                params.add(cursorId);
            } else {
                sql.append(" and (published_at < coalesce((select c.published_at from content.news_article c where c.id = ?), TIMESTAMPTZ 'infinity') "
                        + "or (published_at = coalesce((select c.published_at from content.news_article c where c.id = ?), TIMESTAMPTZ 'infinity') and id < ?))");
                params.add(cursorId);
                params.add(cursorId);
                params.add(cursorId);
            }
        }

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
            sql.append(" order by view_count desc, published_at desc, id desc limit ?");
        } else if ("OLDEST".equals(normalizedSort)) {
            sql.append(" order by published_at asc, id asc limit ?");
        } else {
            sql.append(" order by published_at desc, id desc limit ?");
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
        return get(newsId, null, "direct-call", true);
    }

    @Transactional(timeout = 3)
    public NewsItemResponse get(Long newsId, Long memberId, String anonViewerKey, boolean countView) {
        if (newsId == null || newsId <= 0) {
            throw notFound();
        }
        if (countView) {
            if (memberId != null && memberId > 0) {
                int inserted = jdbc.update(
                        "insert into content.news_article_member_view (news_id, member_id, viewed_at) "
                                + "select id, ?, now() from content.news_article where id = ? "
                                + "on conflict (news_id, member_id) do nothing",
                        memberId,
                        newsId);
                if (inserted > 0) {
                    jdbc.update("update content.news_article set view_count = view_count + 1 where id = ?", newsId);
                }
            } else {
                java.time.LocalDate kstToday = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Seoul"));
                String effectiveAnonKey = (anonViewerKey == null || anonViewerKey.isBlank())
                        ? "anonymous-default"
                        : anonViewerKey.strip();
                String viewerHash = sha256Hex(effectiveAnonKey);
                int inserted = jdbc.update(
                        "insert into content.news_article_anon_daily_view (news_id, viewed_date, viewer_hash, viewed_at) "
                                + "select id, ?, ?, now() from content.news_article where id = ? "
                                + "on conflict (news_id, viewed_date, viewer_hash) do nothing",
                        java.sql.Date.valueOf(kstToday),
                        viewerHash,
                        newsId);
                if (inserted > 0) {
                    jdbc.update("update content.news_article set view_count = view_count + 1 where id = ?", newsId);
                }
            }
        }
        var rows = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article where id = ?",
                NewsService::mapRow,
                newsId);
        if (rows.isEmpty()) {
            throw notFound();
        }
        return rows.get(0);
    }

    private static String sha256Hex(String input) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
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
            int bullPct = total > 0
                    ? java.math.BigDecimal.valueOf(bull * 100L)
                            .divide(java.math.BigDecimal.valueOf(total), 0, java.math.RoundingMode.HALF_UP)
                            .intValue()
                    : 50;
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
        sse.publishSentimentUpdatedAfterCommit(currentSentimentSummary());
        return response;
    }

    @Transactional(readOnly = true, timeout = 3)
    public SentimentSummary currentSentimentSummary() {
        List<NewsItemResponse> recentPool = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article order by published_at desc, id desc limit 40",
                NewsService::mapRow);
        return buildSentimentSummary(recentPool);
    }

    @Transactional(readOnly = true, timeout = 3)
    public NewsHighlightsResponse highlights() {
        List<NewsItemResponse> mustReadBreaking = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article "
                        + "where section = 'BREAKING' "
                        + "order by published_at desc, id desc limit 3",
                NewsService::mapRow);

        List<NewsItemResponse> popularByViews = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article "
                        + "order by view_count desc, published_at desc, id desc limit 4",
                NewsService::mapRow);

        List<NewsItemResponse> popularByReactions = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article "
                        + "order by (bull_count + bear_count) desc, published_at desc, id desc limit 4",
                NewsService::mapRow);

        List<NewsItemResponse> recommendedNewsroom = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article "
                        + "where section = 'NEWSROOM' "
                        + "order by (bull_count + bear_count + view_count) desc, published_at desc, id desc limit 3",
                NewsService::mapRow);

        List<NewsItemResponse> recentPool = jdbc.query(
                "select " + SELECT_COLUMNS + " from content.news_article order by published_at desc, id desc limit 40",
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

    static SentimentSummary buildSentimentSummary(List<NewsItemResponse> recentPool) {
        if (recentPool == null || recentPool.isEmpty()) {
            return new SentimentSummary(
                    0L,
                    0L,
                    50,
                    50,
                    "NEUTRAL",
                    0,
                    0,
                    0,
                    "실시간 뉴스 데이터를 수집 중이며 현재 강·약세 중립(50% · 50%) 관망 구간입니다.");
        }

        List<NewsItemResponse> liveArticles = recentPool.stream()
                .filter(a -> a.sourceUrl() != null && !a.sourceUrl().isBlank())
                .toList();
        List<NewsItemResponse> targetPool = liveArticles.size() >= 5 ? liveArticles : recentPool;

        long totalBullVotes = 0L;
        long totalBearVotes = 0L;
        int bullishArticleCount = 0;
        int bearishArticleCount = 0;
        int neutralArticleCount = 0;

        java.util.Map<String, Integer> categoryCounts = new java.util.LinkedHashMap<>();
        java.util.Map<String, Integer> symbolCounts = new java.util.LinkedHashMap<>();

        for (NewsItemResponse item : targetPool) {
            totalBullVotes += Math.max(0, item.bullCount());
            totalBearVotes += Math.max(0, item.bearCount());
            if ("BULLISH".equals(item.sentiment())) {
                bullishArticleCount++;
            } else if ("BEARISH".equals(item.sentiment())) {
                bearishArticleCount++;
            } else {
                neutralArticleCount++;
            }
            if (item.category() != null && !item.category().isBlank()) {
                categoryCounts.merge(item.category(), 1, Integer::sum);
            }
            if (item.symbolTag() != null && !item.symbolTag().isBlank()) {
                symbolCounts.merge(item.symbolTag(), 1, Integer::sum);
            }
        }

        long bullWeight = bullishArticleCount * 3L + neutralArticleCount + totalBullVotes;
        long bearWeight = bearishArticleCount * 3L + neutralArticleCount + totalBearVotes;
        long totalWeight = bullWeight + bearWeight;

        int bullPct = totalWeight > 0
                ? java.math.BigDecimal.valueOf(bullWeight * 100L)
                        .divide(java.math.BigDecimal.valueOf(totalWeight), 0, java.math.RoundingMode.HALF_UP)
                        .intValue()
                : 50;
        int bearPct = totalWeight > 0 ? (100 - bullPct) : 50;
        String dominant = bullPct >= 55 ? "BULLISH" : (bearPct >= 55 ? "BEARISH" : "NEUTRAL");

        String topCategory = categoryCounts.entrySet().stream()
                .max(java.util.Map.Entry.comparingByValue())
                .map(java.util.Map.Entry::getKey)
                .orElse("CRYPTO");
        String categoryLabel = switch (topCategory) {
            case "MACRO" -> "거시경제·금리";
            case "ONCHAIN" -> "온체인·스테이킹";
            case "REGULATION" -> "규제·정책";
            default -> "가상자산·수급";
        };
        String topSymbol = symbolCounts.entrySet().stream()
                .max(java.util.Map.Entry.comparingByValue())
                .map(java.util.Map.Entry::getKey)
                .orElse(null);
        String focusTopic = topSymbol != null ? ("#" + topSymbol + " 및 " + categoryLabel) : categoryLabel;

        int analyzedCount = targetPool.size();
        String summary;
        if ("BULLISH".equals(dominant)) {
            summary = String.format(
                    Locale.ROOT,
                    "최근 실시간 뉴스 %d건(강세 %d·약세 %d·중립 %d) 분석 결과, %s 이슈를 중심으로 단기 매수·강세 심리(%d%%)가 우위를 보이고 있습니다.",
                    analyzedCount, bullishArticleCount, bearishArticleCount, neutralArticleCount, focusTopic, bullPct);
        } else if ("BEARISH".equals(dominant)) {
            summary = String.format(
                    Locale.ROOT,
                    "최근 실시간 뉴스 %d건(강세 %d·약세 %d·중립 %d) 분석 결과, %s 이슈를 중심으로 단기 매도·경계 심리(%d%%)가 우위를 보이고 있습니다.",
                    analyzedCount, bullishArticleCount, bearishArticleCount, neutralArticleCount, focusTopic, bearPct);
        } else {
            summary = String.format(
                    Locale.ROOT,
                    "최근 실시간 뉴스 %d건(강세 %d·약세 %d·중립 %d) 분석 결과, %s 이슈 속에서 강·약세 수급 공방 및 관망세(강세 %d%% · 약세 %d%%)가 이어지고 있습니다.",
                    analyzedCount, bullishArticleCount, bearishArticleCount, neutralArticleCount, focusTopic, bullPct, bearPct);
        }

        return new SentimentSummary(
                totalBullVotes,
                totalBearVotes,
                bullPct,
                bearPct,
                dominant,
                bullishArticleCount,
                bearishArticleCount,
                neutralArticleCount,
                summary);
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
