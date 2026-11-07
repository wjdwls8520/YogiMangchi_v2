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

    public record NewsItemResponse(
            Long id,
            String category,
            String title,
            String summary,
            String content,
            String sourceName,
            String symbolTag,
            Instant publishedAt
    ) { }

    public record NewsPageResponse(
            List<NewsItemResponse> items,
            boolean hasNext,
            Long nextCursorId
    ) { }

    private final JdbcTemplate jdbc;

    public NewsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true, timeout = 3)
    public NewsPageResponse list(String category, String symbolTag, String keyword, Long cursorId, Integer size) {
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

        StringBuilder sql = new StringBuilder(
                "select id, category, title, summary, content, source_name, symbol_tag, published_at "
                        + "from content.news_article where id < ?");
        List<Object> params = new ArrayList<>();
        params.add(cursorId == null ? Long.MAX_VALUE : cursorId);

        if (normalizedCategory != null) {
            sql.append(" and category = ?");
            params.add(normalizedCategory);
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
        sql.append(" order by id desc limit ?");
        params.add(limit + 1);

        var rows = jdbc.query(sql.toString(), NewsService::mapRow, params.toArray());
        boolean hasNext = rows.size() > limit;
        var page = rows.subList(0, Math.min(limit, rows.size()));
        Long nextCursorId = hasNext && !page.isEmpty() ? page.get(page.size() - 1).id() : null;
        return new NewsPageResponse(page, hasNext, nextCursorId);
    }

    @Transactional(readOnly = true, timeout = 3)
    public NewsItemResponse get(Long newsId) {
        if (newsId == null || newsId <= 0) {
            throw notFound();
        }
        var rows = jdbc.query(
                "select id, category, title, summary, content, source_name, symbol_tag, published_at "
                        + "from content.news_article where id = ?",
                NewsService::mapRow,
                newsId);
        if (rows.isEmpty()) {
            throw notFound();
        }
        return rows.get(0);
    }

    private static NewsItemResponse mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new NewsItemResponse(
                rs.getLong("id"),
                rs.getString("category"),
                rs.getString("title"),
                rs.getString("summary"),
                rs.getString("content"),
                rs.getString("source_name"),
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
