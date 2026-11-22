package com.yogimangchi.content.news;

import com.yogimangchi.content.auth.security.ContentEndpointRateLimiter;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Objects;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
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
    private static final Pattern SAFE_ANON_VIEWER_ID = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");

    private final NewsService news;
    private final NewsSseService sse;
    private final ContentEndpointRateLimiter rateLimiter;

    public NewsController(NewsService news, NewsSseService sse) {
        this(news, sse, null);
    }

    @Autowired
    public NewsController(
            NewsService news,
            NewsSseService sse,
            @Autowired(required = false) ContentEndpointRateLimiter rateLimiter) {
        this.news = news;
        this.sse = sse;
        this.rateLimiter = rateLimiter;
    }

    @GetMapping
    @Operation(
            summary = "List crypto and macro news feed",
            description = "Public. Optional filters: category (CRYPTO/MACRO/ONCHAIN/REGULATION), section (BREAKING/NEWSROOM), subCategory (COIN_FLASH/ECONOMY_FLASH/CRYPTO/STOCKS/FX_RATES), sort (LATEST/OLDEST/POPULAR), symbolTag, keyword (up to 40 code points, case-insensitive literal match on title/summary), cursorId, size (1..30, default 10). Includes caller's userReaction (BULL/BEAR/null)."
    )
    public ResponseEntity<NewsService.NewsPageResponse> list(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String section,
            @RequestParam(required = false) String subCategory,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String symbolTag,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long cursorId,
            @RequestParam(required = false) Integer size,
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest request) {
        String actorKey = resolveReactionActorKey(jwt, request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.list(category, section, subCategory, sort, symbolTag, keyword, cursorId, size, actorKey));
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
            description = "Public SSE stream emitting CONNECTED, NEWS_CREATED, and NEWS_REACTION_UPDATED events. Max 5 concurrent connections per IP."
    )
    public SseEmitter stream(HttpServletRequest request) {
        Runnable release = rateLimiter != null ? rateLimiter.acquireSseSlot(clientIp(request)) : null;
        try {
            SseEmitter emitter = sse.subscribe();
            if (rateLimiter != null && release != null) {
                rateLimiter.bindSseRelease(emitter, release);
            }
            return emitter;
        } catch (RuntimeException ex) {
            if (release != null) {
                release.run();
            }
            throw ex;
        }
    }

    @GetMapping("/{newsId:[0-9]+}")
    @Operation(
            summary = "Read a single news article",
            description = "Public. Idempotently increments viewCount (once per member account when authenticated, or once per KST day per sanitized X-Anon-Viewer-Id or IP+UA when unauthenticated) unless countView=false. Includes userReaction."
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
        String actorKey = resolveReactionActorKey(jwt, request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.get(newsId, memberId, anonViewerKey, countView, actorKey));
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
        if (rateLimiter != null) {
            rateLimiter.checkNewsInteraction(clientIp(request));
        }
        Long memberId = viewerMemberId(jwt);
        String anonViewerKey = resolveAnonViewerKey(anonViewerHeader, viewerKey, request);
        String actorKey = resolveReactionActorKey(jwt, request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.get(newsId, memberId, anonViewerKey, true, actorKey));
    }

    @PostMapping("/{newsId:[0-9]+}/reactions")
    @Operation(
            summary = "Create, switch (BULL <-> BEAR), or toggle-off an idempotent reaction vote on a news article",
            description = "Public. Identifies actor by authenticated member ID or SHA-256(IP+User-Agent). Returns updated counts and userReaction (BULL, BEAR, or null when toggled off), and broadcasts NEWS_REACTION_UPDATED via SSE."
    )
    public ResponseEntity<NewsService.NewsReactionResponse> react(
            @PathVariable Long newsId,
            @RequestBody(required = false) NewsService.NewsReactionRequest body,
            @RequestParam(required = false) String reaction,
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest request) {
        if (rateLimiter != null) {
            rateLimiter.checkNewsInteraction(clientIp(request));
        }
        String effective = (body != null && body.reaction() != null && !body.reaction().isBlank())
                ? body.reaction()
                : reaction;
        String actorKey = resolveReactionActorKey(jwt, request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(news.react(newsId, effective, actorKey));
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

    private static String resolveReactionActorKey(Jwt jwt, HttpServletRequest request) {
        Long memberId = viewerMemberId(jwt);
        if (memberId != null && memberId > 0) {
            return "member:" + memberId;
        }
        String ip = request == null ? "0.0.0.0" : clientIp(request);
        String ua = request == null ? "unknown" : Objects.toString(request.getHeader("User-Agent"), "unknown");
        return "anon:" + NewsService.sha256Hex(ip + "|" + ua);
    }

    static String resolveAnonViewerKey(
            String anonViewerHeader,
            String viewerKey,
            HttpServletRequest request) {
        String sanitizedHeader = sanitizeAnonViewerId(anonViewerHeader);
        if (sanitizedHeader != null) {
            return "hdr:" + sanitizedHeader;
        }
        String sanitizedParam = sanitizeAnonViewerId(viewerKey);
        if (sanitizedParam != null) {
            return "hdr:" + sanitizedParam;
        }
        if (request == null) {
            return "anonymous-default";
        }
        String ip = clientIp(request);
        String ua = Objects.toString(request.getHeader("User-Agent"), "unknown");
        return ip + "|" + ua;
    }

    private static String sanitizeAnonViewerId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String trimmed = raw.strip();
        return SAFE_ANON_VIEWER_ID.matcher(trimmed).matches() ? trimmed : null;
    }

    private static String clientIp(HttpServletRequest request) {
        // Rely strictly on servlet remoteAddr (resolved by Spring's trusted native forward-headers-strategy in prod).
        // Never trust raw client-supplied X-Forwarded-For headers directly.
        if (request == null) {
            return "0.0.0.0";
        }
        String remoteAddr = request.getRemoteAddr();
        return (remoteAddr == null || remoteAddr.isBlank()) ? "0.0.0.0" : remoteAddr.strip();
    }
}
