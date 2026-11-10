package com.yogimangchi.content.news;

import io.swagger.v3.oas.annotations.Operation;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Objects;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping(value = "/api/v1/news", produces = "application/json")
public class NewsController {
    private final NewsService news;
    private final NewsSseService sse;

    public NewsController(NewsService news, NewsSseService sse) {
        this.news = news;
        this.sse = sse;
    }

    @GetMapping
    @Operation(
            summary = "List crypto and macro news feed",
            description = "Public. Optional filters: category (CRYPTO/MACRO/ONCHAIN/REGULATION), section (BREAKING/NEWSROOM), subCategory (COIN_FLASH/ECONOMY_FLASH/CRYPTO/STOCKS/FX_RATES), sort (LATEST/OLDEST/POPULAR), symbolTag, keyword (up to 40 code points, case-insensitive literal match on title/summary), cursorId, size (1..30, default 10)."
    )
    public ResponseEntity<NewsService.NewsPageResponse> list(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String section,
            @RequestParam(required = false) String subCategory,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String symbolTag,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.list(category, section, subCategory, sort, symbolTag, keyword, cursorId, size));
    }

    @GetMapping("/highlights")
    @Operation(
            summary = "Get real-time news highlights, popular articles, keyword issues, and sentiment summary",
            description = "Public. Aggregates top breaking flashes, popular articles by views and reactions, trending keyword issues, newsroom recommendations, and overall bull/bear sentiment."
    )
    public ResponseEntity<NewsService.NewsHighlightsResponse> highlights() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.highlights());
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(
            summary = "Subscribe to real-time news SSE stream",
            description = "Public SSE stream emitting CONNECTED, NEWS_CREATED, and NEWS_REACTION_UPDATED events."
    )
    public SseEmitter stream() {
        return sse.subscribe();
    }

    @GetMapping("/{newsId:[0-9]+}")
    @Operation(
            summary = "Read a single news article",
            description = "Public. Idempotently increments viewCount (once per member account when authenticated, or once per KST day per anonymous viewer key/IP+UA when unauthenticated) unless countView=false."
    )
    public ResponseEntity<NewsService.NewsItemResponse> get(
            @PathVariable Long newsId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "true") boolean countView,
            @RequestParam(required = false) String viewerKey,
            @RequestHeader(value = "X-Anon-Viewer-Id", required = false) String anonViewerHeader,
            HttpServletRequest request) {
        Long memberId = viewerMemberId(jwt);
        String anonViewerKey = resolveAnonViewerKey(anonViewerHeader, viewerKey, request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.get(newsId, memberId, anonViewerKey, countView));
    }

    @PostMapping("/{newsId:[0-9]+}/views")
    @Operation(
            summary = "Record an idempotent view on a news article",
            description = "Public. Idempotently increments viewCount (once per member account or once per KST day for anonymous viewer) and returns the updated article."
    )
    public ResponseEntity<NewsService.NewsItemResponse> recordView(
            @PathVariable Long newsId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String viewerKey,
            @RequestHeader(value = "X-Anon-Viewer-Id", required = false) String anonViewerHeader,
            HttpServletRequest request) {
        Long memberId = viewerMemberId(jwt);
        String anonViewerKey = resolveAnonViewerKey(anonViewerHeader, viewerKey, request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.get(newsId, memberId, anonViewerKey, true));
    }

    @PostMapping("/{newsId:[0-9]+}/reactions")
    @Operation(
            summary = "Submit a bull or bear reaction vote on a news article",
            description = "Public. Increments bullCount (BULL) or bearCount (BEAR) and broadcasts NEWS_REACTION_UPDATED via SSE."
    )
    public ResponseEntity<NewsService.NewsReactionResponse> react(
            @PathVariable Long newsId,
            @RequestBody(required = false) NewsService.NewsReactionRequest body,
            @RequestParam(required = false) String reaction) {
        String effective = (body != null && body.reaction() != null && !body.reaction().isBlank())
                ? body.reaction()
                : reaction;
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.react(newsId, effective));
    }

    private static Long viewerMemberId(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null) {
            return null;
        }
        try {
            return Long.valueOf(jwt.getSubject());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String resolveAnonViewerKey(
            String anonViewerHeader,
            String viewerKey,
            HttpServletRequest request) {
        String candidate = null;
        if (anonViewerHeader != null && !anonViewerHeader.isBlank()) {
            candidate = anonViewerHeader.strip();
        } else if (viewerKey != null && !viewerKey.isBlank()) {
            candidate = viewerKey.strip();
        }
        if (candidate != null && !candidate.isEmpty()) {
            return candidate.length() > 128 ? candidate.substring(0, 128) : candidate;
        }
        if (request == null) {
            return "anonymous-default";
        }
        String ip = clientIp(request);
        String ua = Objects.toString(request.getHeader("User-Agent"), "unknown");
        return ip + "|" + ua;
    }

    private static String clientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            int comma = xff.indexOf(',');
            String first = (comma >= 0 ? xff.substring(0, comma) : xff).strip();
            if (!first.isEmpty()) {
                return first;
            }
        }
        return Objects.toString(request.getRemoteAddr(), "0.0.0.0");
    }
}
