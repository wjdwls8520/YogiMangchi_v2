package com.yogimangchi.content.news;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/news", produces = "application/json")
public class NewsController {
    private final NewsService news;

    public NewsController(NewsService news) {
        this.news = news;
    }

    @GetMapping
    @Operation(
            summary = "List crypto and macro news feed",
            description = "Public. Optional filters: category (CRYPTO/MACRO/ONCHAIN/REGULATION), symbolTag, keyword (up to 40 code points, case-insensitive literal match on title/summary), cursorId, size (1..30, default 10)."
    )
    public ResponseEntity<NewsService.NewsPageResponse> list(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String symbolTag,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.list(category, symbolTag, keyword, cursorId, size));
    }

    @GetMapping("/{newsId:[0-9]+}")
    @Operation(summary = "Read a single news article", description = "Public. Returns 404 RESOURCE_NOT_FOUND when missing.")
    public ResponseEntity<NewsService.NewsItemResponse> get(@PathVariable Long newsId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.get(newsId));
    }
}
