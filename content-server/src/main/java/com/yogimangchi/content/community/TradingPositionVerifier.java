package com.yogimangchi.content.community;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Verifies shared position snapshots read-only against Trading Server using the caller's own Bearer JWT.
 * Runs outside Content DB transactions and locks. Fails closed (verified = false) on any mismatch or outage.
 */
@Service
public class TradingPositionVerifier {
    private static final Logger log = LoggerFactory.getLogger(TradingPositionVerifier.class);
    private static final Pattern CONTEST_POSITION_ID = Pattern.compile("^CONTEST_([0-9]+)_POS_([0-9]+)$");
    private static final Pattern MOCK_POSITION_ID = Pattern.compile("^(?:MOCK_POS_)?([0-9]+)$");
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final long SYMBOL_CACHE_TTL_MS = 60_000L;

    public record VerificationResult(
            CommunityService.SharedPositionSnapshot snapshot,
            boolean verified
    ) {
        public static VerificationResult unverified(CommunityService.SharedPositionSnapshot snapshot) {
            return new VerificationResult(snapshot, false);
        }

        public static VerificationResult verified(CommunityService.SharedPositionSnapshot snapshot) {
            return new VerificationResult(snapshot, true);
        }
    }

    private final String baseUrl;
    private final ObjectMapper json;
    private final HttpClient httpClient;
    private final Duration requestTimeout;
    private volatile Map<Long, String> symbolCache = Map.of();
    private volatile long symbolCacheExpiresAtMs = 0L;

    @Autowired
    public TradingPositionVerifier(
            @Value("${content.withdrawal.trading-base-url:}") String tradingBaseUrl,
            @Value("${content.community.position-verification.timeout-ms:1500}") long timeoutMs,
            ObjectMapper json) {
        this.baseUrl = normalizeTrustedBaseUrl(tradingBaseUrl);
        this.json = json;
        long clampedTimeoutMs = Math.max(200L, Math.min(3000L, timeoutMs));
        this.requestTimeout = Duration.ofMillis(clampedTimeoutMs);
        long connectTimeoutMs = Math.min(800L, clampedTimeoutMs);
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(connectTimeoutMs))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    public VerificationResult verify(
            Long memberId,
            String bearerToken,
            CommunityService.SharedPositionSnapshot requested) {
        if (requested == null) {
            return null;
        }
        // Always validate input bounds before attempting any external I/O.
        CommunityService.validateSharedPositionInput(requested);

        if (baseUrl == null || memberId == null || memberId <= 0 || bearerToken == null || bearerToken.isBlank()) {
            return VerificationResult.unverified(requested);
        }

        String requestedSide = requested.side().strip().toUpperCase(Locale.ROOT);
        String requestedSymbol = normalizeBaseSymbol(requested.symbol());
        String rawId = requested.id() == null ? "" : requested.id().strip();

        try {
            Matcher contestMatcher = CONTEST_POSITION_ID.matcher(rawId);
            if (contestMatcher.matches()) {
                long seasonId = Long.parseLong(contestMatcher.group(1));
                long positionId = Long.parseLong(contestMatcher.group(2));
                String url = baseUrl + "/api/v1/trading/contest/seasons/" + seasonId + "/account/summary";
                return verifyFromAccountSummary(url, bearerToken, requested, requestedSymbol, requestedSide, positionId,
                        "CONTEST_" + seasonId + "_POS_" + positionId);
            }

            Long requestedPosId = null;
            Matcher mockMatcher = MOCK_POSITION_ID.matcher(rawId);
            if (mockMatcher.matches()) {
                requestedPosId = Long.parseLong(mockMatcher.group(1));
            }
            String url = baseUrl + "/api/v1/trading/account/summary";
            return verifyFromAccountSummary(url, bearerToken, requested, requestedSymbol, requestedSide, requestedPosId, null);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return VerificationResult.unverified(requested);
        } catch (Exception ex) {
            log.debug("Shared position verification fallback to unverified memberId={} cause={}",
                    memberId, ex.getClass().getSimpleName());
            return VerificationResult.unverified(requested);
        }
    }

    private VerificationResult verifyFromAccountSummary(
            String summaryUrl,
            String bearerToken,
            CommunityService.SharedPositionSnapshot requested,
            String requestedSymbol,
            String requestedSide,
            Long requestedPositionId,
            String forcedCanonicalId) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(summaryUrl))
                .timeout(requestTimeout)
                .header("Authorization", "Bearer " + bearerToken)
                .header("Accept", "application/json")
                .GET()
                .build();
        HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() != 200 || resp.body() == null || resp.body().isBlank()) {
            return VerificationResult.unverified(requested);
        }

        JsonNode root = json.readTree(resp.body());
        JsonNode positions = root.path("positions");
        if (!positions.isArray() || positions.isEmpty()) {
            return VerificationResult.unverified(requested);
        }

        Map<Long, String> symbolMap = null;
        for (JsonNode pos : positions) {
            String status = textOrNull(pos, "status");
            if (status != null && !"OPEN".equalsIgnoreCase(status)) {
                continue;
            }
            String side = textOrNull(pos, "side");
            if (side == null || !requestedSide.equalsIgnoreCase(side)) {
                continue;
            }
            long posId = pos.path("id").asLong(-1L);
            if (requestedPositionId != null && posId != requestedPositionId) {
                continue;
            }
            int leverage = pos.path("leverage").asInt(-1);
            if (leverage < 1 || leverage > CommunityService.MAX_SHARED_POSITION_LEVERAGE) {
                continue;
            }

            String serverSymbol = normalizeBaseSymbol(textOrNull(pos, "symbol"));
            if (serverSymbol == null) {
                long tradingSymbolId = pos.path("tradingSymbolId").asLong(-1L);
                if (tradingSymbolId > 0) {
                    if (symbolMap == null) {
                        symbolMap = loadSymbolMap();
                    }
                    serverSymbol = normalizeBaseSymbol(symbolMap.get(tradingSymbolId));
                }
            }

            if (serverSymbol != null) {
                if (!serverSymbol.equals(requestedSymbol)) {
                    continue;
                }
            } else if (requestedPositionId == null) {
                // Without an explicit positionId match, symbol confirmation is mandatory.
                continue;
            }

            String effectiveSymbol = serverSymbol != null ? serverSymbol : requestedSymbol;
            String effectivePair = effectiveSymbol + "USDT";
            String canonicalId = forcedCanonicalId != null
                    ? forcedCanonicalId
                    : (posId > 0 ? "MOCK_POS_" + posId : requested.id());
            String marketLabel = sanitizeMarketLabel(requested.marketLabel());

            String entryPrice = formatPrice(textOrNull(pos, "entryPrice"));
            String markPrice = formatPrice(textOrNull(pos, "markPrice"));
            String liquidationPrice = formatPrice(textOrNull(pos, "liquidationPrice"));
            BigDecimal unrealizedPnl = parseDecimal(textOrNull(pos, "unrealizedPnl"));
            BigDecimal margin = parseDecimal(textOrNull(pos, "margin"));

            String serverRoe = textOrNull(pos, "roePct");
            BigDecimal roeValue = serverRoe != null
                    ? parseDecimal(serverRoe.replace("%", "").strip())
                    : computeRoePct(unrealizedPnl, margin);
            String roePct = formatSignedPct(roeValue);
            String pnlUsdt = formatSignedUsdt(unrealizedPnl);
            boolean positive = unrealizedPnl != null
                    ? unrealizedPnl.signum() >= 0
                    : (roeValue == null || roeValue.signum() >= 0);

            CommunityService.SharedPositionSnapshot authoritative = new CommunityService.SharedPositionSnapshot(
                    canonicalId,
                    marketLabel,
                    effectiveSymbol,
                    effectivePair,
                    side.strip().toUpperCase(Locale.ROOT),
                    leverage,
                    entryPrice,
                    markPrice,
                    liquidationPrice,
                    roePct,
                    pnlUsdt,
                    positive,
                    requested.showPnlAmount(),
                    true);
            return VerificationResult.verified(authoritative);
        }

        return VerificationResult.unverified(requested);
    }

    private Map<Long, String> loadSymbolMap() {
        long now = System.currentTimeMillis();
        Map<Long, String> cached = symbolCache;
        if (!cached.isEmpty() && now < symbolCacheExpiresAtMs) {
            return cached;
        }
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/symbols"))
                    .timeout(Duration.ofMillis(Math.min(800L, requestTimeout.toMillis())))
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200 || resp.body() == null || resp.body().isBlank()) {
                return Map.of();
            }
            JsonNode arr = json.readTree(resp.body());
            if (!arr.isArray()) {
                return Map.of();
            }
            Map<Long, String> map = new HashMap<>();
            for (JsonNode item : arr) {
                long id = item.path("id").asLong(-1L);
                String sym = textOrNull(item, "symbol");
                if (id > 0 && sym != null) {
                    map.put(id, sym);
                }
            }
            if (!map.isEmpty()) {
                symbolCache = Map.copyOf(map);
                symbolCacheExpiresAtMs = now + SYMBOL_CACHE_TTL_MS;
            }
            return symbolCache;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return Map.of();
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    private static String normalizeTrustedBaseUrl(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            URI uri = URI.create(raw.strip());
            if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                    || !Set.of("http", "https").contains(uri.getScheme())
                    || !Set.of("", "/").contains(uri.getPath())) {
                return null;
            }
            String trimmed = raw.strip();
            return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static String normalizeBaseSymbol(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String upper = raw.strip().toUpperCase(Locale.ROOT);
        if (upper.endsWith("USDT") && upper.length() > 4) {
            return upper.substring(0, upper.length() - 4);
        }
        return upper;
    }

    private static String sanitizeMarketLabel(String raw) {
        if (raw == null || raw.isBlank()) {
            return "모의투자 선물";
        }
        String clean = raw.replace("\0", "").strip();
        return clean.length() > 48 ? clean.substring(0, 48) : clean;
    }

    private static String textOrNull(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        String text = value.asText(null);
        return (text == null || text.isBlank()) ? null : text.strip();
    }

    private static BigDecimal parseDecimal(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return new BigDecimal(raw.replace(",", "").strip());
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static BigDecimal computeRoePct(BigDecimal unrealizedPnl, BigDecimal margin) {
        if (unrealizedPnl == null || margin == null || margin.signum() <= 0) {
            return null;
        }
        return unrealizedPnl.multiply(HUNDRED).divide(margin, 2, RoundingMode.HALF_UP);
    }

    private static String formatPrice(String raw) {
        BigDecimal value = parseDecimal(raw);
        if (value == null) {
            return "-";
        }
        int scale = value.abs().compareTo(BigDecimal.ONE) >= 0 ? 2 : 4;
        return value.setScale(scale, RoundingMode.HALF_UP).toPlainString();
    }

    private static String formatSignedPct(BigDecimal value) {
        if (value == null) {
            return "0.00%";
        }
        BigDecimal scaled = value.setScale(2, RoundingMode.HALF_UP);
        String prefix = scaled.signum() > 0 ? "+" : "";
        return prefix + scaled.toPlainString() + "%";
    }

    private static String formatSignedUsdt(BigDecimal value) {
        if (value == null) {
            return "0.00 USDT";
        }
        BigDecimal scaled = value.setScale(2, RoundingMode.HALF_UP);
        String prefix = scaled.signum() > 0 ? "+" : "";
        return prefix + scaled.toPlainString() + " USDT";
    }
}
