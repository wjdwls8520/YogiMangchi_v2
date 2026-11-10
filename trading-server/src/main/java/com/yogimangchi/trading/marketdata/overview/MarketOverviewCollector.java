package com.yogimangchi.trading.marketdata.overview;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.MarketDataEvent;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.marketdata.ticker.MarketTicker;
import com.yogimangchi.trading.marketdata.ticker.RedisTickerStore;
import com.yogimangchi.trading.tradingsymbol.dto.TradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.service.TradingSymbolService;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Central background collector that polls free public FX & crypto macro endpoints
 * and writes the canonical snapshot into shared Redis ({@code trading:market:v1:overview}).
 */
@Component
@ConditionalOnProperty(name = "marketdata.overview.enabled", havingValue = "true", matchIfMissing = true)
public class MarketOverviewCollector {

    private static final Logger log = LoggerFactory.getLogger(MarketOverviewCollector.class);

    static final URI YAHOO_KRW_URI = URI.create("https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&range=1mo");
    static final URI NAVER_KRW_URI = URI.create("https://api.stock.naver.com/marketindex/exchange/FX_USDKRW");
    static final URI OPEN_ER_USD_URI = URI.create("https://open.er-api.com/v6/latest/USD");
    static final URI UPBIT_BTC_KRW_URI = URI.create("https://api.upbit.com/v1/ticker?markets=KRW-BTC");
    static final URI BINANCE_FAPI_BTC_24H_URI = URI.create("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT");
    static final URI BINANCE_SPOT_BTC_24H_URI = URI.create("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
    static final URI BINANCE_TAKER_RATIO_URI = URI.create("https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=1");
    static final URI BINANCE_ACCOUNT_RATIO_URI = URI.create("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1");
    static final URI COINGECKO_GLOBAL_URI = URI.create("https://api.coingecko.com/api/v3/global");
    static final URI COINPAPRIKA_GLOBAL_URI = URI.create("https://api.coinpaprika.com/v1/global");
    static final URI COINGECKO_DERIVATIVES_URI = URI.create("https://api.coingecko.com/api/v3/derivatives/exchanges?per_page=10");
    static final URI BINANCE_OI_HIST_URI = URI.create("https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=1");
    static final URI ALTERNATIVE_FNG_URI = URI.create("https://api.alternative.me/fng/?limit=1");

    private static final BigDecimal HUNDRED = new BigDecimal("100");
    private static final BigDecimal BILLION = new BigDecimal("1000000000");
    private static final BigDecimal MIN_VALID_USD_KRW = new BigDecimal("500");
    private static final BigDecimal DEFAULT_REF_BTC_USD = new BigDecimal("90000");

    private final TradingSymbolService symbols;
    private final StringRedisTemplate redis;
    private final RedisMarketOverviewStore store;
    private final ObjectMapper mapper;
    private final Function<URI, Optional<String>> httpGet;
    private final ScheduledExecutorService scheduler;
    private final Clock clock;
    private final long fastIntervalMs;
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicLong tickCounter = new AtomicLong(0);

    private volatile MarketOverviewSnapshot lastSnapshot;

    @Autowired
    public MarketOverviewCollector(
            TradingSymbolService symbols,
            RedisConnectionFactory connections,
            RedisMarketOverviewStore store,
            ObjectMapper mapper,
            @Value("${marketdata.overview.interval-ms:5000}") long fastIntervalMs
    ) {
        this(
                symbols,
                new StringRedisTemplate(connections),
                store,
                mapper,
                defaultHttpFetcher(),
                Executors.newSingleThreadScheduledExecutor(task -> {
                    Thread thread = new Thread(task, "market-overview-redis");
                    thread.setDaemon(true);
                    return thread;
                }),
                Clock.systemUTC(),
                fastIntervalMs
        );
    }

    MarketOverviewCollector(
            TradingSymbolService symbols,
            StringRedisTemplate redis,
            RedisMarketOverviewStore store,
            ObjectMapper mapper,
            Function<URI, Optional<String>> httpGet,
            ScheduledExecutorService scheduler,
            Clock clock,
            long fastIntervalMs
    ) {
        this.symbols = symbols;
        this.redis = redis;
        this.store = store;
        this.mapper = mapper;
        this.httpGet = httpGet;
        this.scheduler = scheduler;
        this.clock = clock;
        this.fastIntervalMs = Math.max(1000L, fastIntervalMs);
    }

    private static Function<URI, Optional<String>> defaultHttpFetcher() {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(4))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
        return uri -> {
            try {
                HttpRequest request = HttpRequest.newBuilder(uri)
                        .timeout(Duration.ofSeconds(4))
                        .header("Accept", "application/json")
                        .header("User-Agent", "Mozilla/5.0 YogiMangchiMarketCollector/2.0")
                        .GET()
                        .build();
                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() >= 200 && response.statusCode() < 300 && response.body() != null) {
                    return Optional.of(response.body());
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (IOException | RuntimeException ignored) {
                // Fallbacks handle transient upstream failures cleanly
            }
            return Optional.empty();
        };
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        if (closed.get() || !started.compareAndSet(false, true)) {
            return;
        }
        MarketOverviewSnapshot existing = store.read();
        if (existing != null) {
            this.lastSnapshot = existing;
        }
        scheduler.scheduleWithFixedDelay(this::collectSafe, 0L, fastIntervalMs, TimeUnit.MILLISECONDS);
    }

    @PreDestroy
    public void close() {
        closed.set(true);
        scheduler.shutdownNow();
    }

    void collectSafe() {
        if (closed.get()) {
            return;
        }
        try {
            collectOnce();
        } catch (RuntimeException exception) {
            log.warn("[Market overview] collection cycle failed: {}", exception.getClass().getSimpleName());
        }
    }

    public MarketOverviewSnapshot collectOnce() {
        long tick = tickCounter.getAndIncrement();
        Instant now = clock.instant();
        MarketOverviewSnapshot prev = lastSnapshot != null ? lastSnapshot : MarketOverviewSnapshot.fallback(now);

        boolean refreshDerivativesRatio = (tick % 3 == 0);
        boolean refreshMacro = (tick % 12 == 0);

        // 1. Live BTC price & 24h change from shared Redis (fallback: Binance public 24hr ticker)
        BtcQuote btcQuote = resolveBtcQuote(now, prev.btcChange24h());

        // 2. Real-time USD/KRW exchange rate + 14-day history (Yahoo KRW=X -> Naver FX_USDKRW -> OpenER/Frankfurter)
        FxQuote fxQuote = resolveUsdKrwQuote(now, prev);

        // 3. Real-time Upbit KRW-BTC ticker
        BigDecimal upbitBtcKrw = fetchUpbitBtcKrw().orElse(prev.upbitBtcKrw());
        BigDecimal kimchiPremium = (upbitBtcKrw != null && btcQuote.priceUsd() != null)
                ? MarketOverviewMath.computeKimchiPremiumPercent(upbitBtcKrw, btcQuote.priceUsd(), fxQuote.rate())
                : prev.kimchiPremiumPercent();

        // 4. Macro: BTC Dominance (every 60s or cold start)
        BigDecimal btcDominance = prev.btcDominancePercent();
        BigDecimal totalMcapChange24h = prev.totalMarketCapChange24hPct();
        if (refreshMacro) {
            DominanceQuote dom = fetchDominanceQuote().orElse(null);
            if (dom != null) {
                btcDominance = dom.dominancePercent();
                totalMcapChange24h = dom.totalMarketCapChange24hPct();
            }
        }
        BigDecimal btcDominanceChange24h = totalMcapChange24h != null
                ? MarketOverviewMath.computeBtcDominanceChange24h(btcDominance, totalMcapChange24h, btcQuote.change24hPct())
                : prev.btcDominanceChange24h();

        // 5. Macro: Futures Open Interest (every 60s for BTC OI, re-valued every 5s against live BTC price)
        BigDecimal openInterestBtc = prev.openInterestBtc();
        BigDecimal openInterestBillions = prev.openInterestBillionsUsd();
        if (refreshMacro) {
            OpenInterestQuote oi = fetchOpenInterestQuote(btcQuote.priceUsd()).orElse(null);
            if (oi != null) {
                openInterestBtc = oi.openInterestBtc();
                openInterestBillions = oi.openInterestBillionsUsd();
            }
        } else if (openInterestBtc != null && btcQuote.priceUsd() != null) {
            openInterestBillions = MarketOverviewMath.computeOpenInterestBillionsUsd(openInterestBtc, btcQuote.priceUsd());
        }

        // 6. Macro: Fear & Greed Index (every 60s)
        int fearGreedValue = prev.fearGreedValue();
        String fearGreedLabelKr = prev.fearGreedLabelKr();
        if (refreshMacro) {
            FearGreedQuote fng = fetchFearGreedQuote().orElse(null);
            if (fng != null) {
                fearGreedValue = fng.value();
                fearGreedLabelKr = fng.labelKr();
            }
        }

        // 7. Derivatives Sentiment: Binance Futures Taker Buy/Sell Ratio (every 15s)
        int futuresBullPct = prev.futuresBullPct();
        if (refreshDerivativesRatio) {
            Integer bull = fetchFuturesBullPct().orElse(null);
            if (bull != null) {
                futuresBullPct = bull;
            }
        }

        MarketOverviewSnapshot next = new MarketOverviewSnapshot(
                btcDominance,
                btcDominanceChange24h,
                totalMcapChange24h,
                upbitBtcKrw,
                kimchiPremium,
                openInterestBtc,
                openInterestBillions,
                fearGreedValue,
                fearGreedLabelKr,
                futuresBullPct,
                100 - futuresBullPct,
                btcQuote.change24hPct(),
                fxQuote.rate(),
                fxQuote.changeAmount(),
                fxQuote.changePct(),
                fxQuote.history(),
                now
        );
        this.lastSnapshot = next;
        store.write(next);
        return next;
    }

    private BtcQuote resolveBtcQuote(Instant now, BigDecimal fallbackChange24h) {
        BigDecimal markUsd = null;
        BigDecimal change24h = null;

        Long btcSymbolId = findBtcSymbolId();
        if (btcSymbolId != null) {
            try {
                List<String> vals = redis.opsForValue().multiGet(List.of(
                        RedisMarketDataBridge.snapshotKey(btcSymbolId),
                        RedisMarketDataBridge.stateKey(btcSymbolId),
                        RedisTickerStore.snapshotKey(btcSymbolId)
                ));
                if (vals != null && vals.size() == 3) {
                    if (vals.get(0) != null && "FRESH".equals(vals.get(1))) {
                        MarketDataEvent event = mapper.readValue(vals.get(0), MarketDataEvent.class);
                        LatestMarkPrice price = event != null ? event.price() : null;
                        if (price != null && LatestPriceStore.isFreshAt(price, now)) {
                            markUsd = price.domainMarkPrice();
                        }
                    }
                    if (vals.get(2) != null) {
                        MarketTicker ticker = mapper.readValue(vals.get(2), MarketTicker.class);
                        if (ticker != null && ticker.isFreshAt(now)) {
                            change24h = ticker.changePercent24h().setScale(2, RoundingMode.HALF_UP);
                        }
                    }
                }
            } catch (IOException | DataAccessException | IllegalArgumentException ignored) {
                // Fallback to REST ticker below
            }
        }

        if (markUsd == null || change24h == null) {
            JsonNode tickerNode = fetchJson(BINANCE_FAPI_BTC_24H_URI)
                    .or(() -> fetchJson(BINANCE_SPOT_BTC_24H_URI))
                    .orElse(null);
            if (tickerNode != null && tickerNode.isObject()) {
                if (markUsd == null) {
                    BigDecimal parsedPrice = parsePositiveDecimal(tickerNode.get("lastPrice"))
                            .or(() -> parsePositiveDecimal(tickerNode.get("price")))
                            .orElse(null);
                    if (parsedPrice != null) {
                        markUsd = parsedPrice;
                    }
                }
                if (change24h == null) {
                    BigDecimal parsedChange = parseDecimal(tickerNode.get("priceChangePercent")).orElse(null);
                    if (parsedChange != null) {
                        change24h = parsedChange.setScale(2, RoundingMode.HALF_UP);
                    }
                }
            }
        }

        return new BtcQuote(markUsd, change24h != null ? change24h : fallbackChange24h);
    }

    private FxQuote resolveUsdKrwQuote(Instant now, MarketOverviewSnapshot prev) {
        // Tier 1: Yahoo Finance KRW=X (real-time spot tick + 1-month daily closes in one call)
        JsonNode yahoo = fetchJson(YAHOO_KRW_URI).orElse(null);
        if (yahoo != null) {
            JsonNode result0 = yahoo.path("chart").path("result").path(0);
            JsonNode meta = result0.path("meta");
            BigDecimal liveRate = parsePositiveDecimal(meta.get("regularMarketPrice")).orElse(null);
            if (liveRate != null && liveRate.compareTo(MIN_VALID_USD_KRW) >= 0) {
                BigDecimal roundedRate = liveRate.setScale(2, RoundingMode.HALF_UP);
                List<BigDecimal> dailyCloses = extractYahooDailyCloses(result0, roundedRate);
                BigDecimal prevClose = parsePositiveDecimal(meta.get("chartPreviousClose"))
                        .or(() -> dailyCloses.size() >= 2
                                ? Optional.of(dailyCloses.get(dailyCloses.size() - 2))
                                : Optional.empty())
                        .orElse(null);
                BigDecimal changeAmount = parseDecimal(meta.get("fulldayChange"))
                        .map(v -> v.setScale(2, RoundingMode.HALF_UP))
                        .orElseGet(() -> prevClose != null
                                ? roundedRate.subtract(prevClose).setScale(2, RoundingMode.HALF_UP)
                                : prev.usdKrwChangeAmount());
                BigDecimal changePct = parseDecimal(meta.get("fulldayChangePercent"))
                        .map(v -> v.setScale(2, RoundingMode.HALF_UP))
                        .orElseGet(() -> prevClose != null && prevClose.compareTo(BigDecimal.ZERO) > 0
                                ? changeAmount.multiply(HUNDRED).divide(prevClose, 2, RoundingMode.HALF_UP)
                                : prev.usdKrwChangePct());
                return new FxQuote(roundedRate, changeAmount, changePct, dailyCloses);
            }
        }

        // Tier 2: Naver Domestic Hana Bank real-time USD/KRW quote
        JsonNode naver = fetchJson(NAVER_KRW_URI).orElse(null);
        if (naver != null) {
            JsonNode info = naver.path("exchangeInfo");
            BigDecimal liveRate = parsePositiveDecimal(info.get("closePrice")).orElse(null);
            if (liveRate != null && liveRate.compareTo(MIN_VALID_USD_KRW) >= 0) {
                BigDecimal roundedRate = liveRate.setScale(2, RoundingMode.HALF_UP);
                String fluctType = info.path("fluctuationsType").path("name").asText("");
                boolean falling = "FALLING".equalsIgnoreCase(fluctuctTypeSafe(fluctType))
                        || "5".equals(info.path("fluctuationsType").path("code").asText(""));
                BigDecimal rawAmt = parseDecimal(info.get("fluctuations")).orElse(BigDecimal.ZERO).abs();
                BigDecimal rawPct = parseDecimal(info.get("fluctuationsRatio")).orElse(BigDecimal.ZERO).abs();
                BigDecimal changeAmount = (falling ? rawAmt.negate() : rawAmt).setScale(2, RoundingMode.HALF_UP);
                BigDecimal changePct = (falling ? rawPct.negate() : rawPct).setScale(2, RoundingMode.HALF_UP);
                List<BigDecimal> history = replaceTailWithCurrentRate(prev.usdKrwHistory(), roundedRate);
                return new FxQuote(roundedRate, changeAmount, changePct, history);
            }
        }

        // Tier 3: Open Exchange Rates + Frankfurter 14-day series
        BigDecimal openErRate = fetchJson(OPEN_ER_USD_URI)
                .flatMap(node -> parsePositiveDecimal(node.path("rates").get("KRW")))
                .filter(rate -> rate.compareTo(MIN_VALID_USD_KRW) >= 0)
                .map(rate -> rate.setScale(2, RoundingMode.HALF_UP))
                .orElse(prev.usdKrwRate());

        LocalDate endDate = LocalDate.ofInstant(now, ZoneOffset.UTC);
        LocalDate startDate = endDate.minusDays(22);
        URI frankfurterUri = URI.create("https://api.frankfurter.app/" + startDate + ".." + endDate + "?from=USD&to=KRW");
        JsonNode frankfurter = fetchJson(frankfurterUri).orElse(null);
        if (frankfurter != null && frankfurter.path("rates").isObject()) {
            List<String> dates = new ArrayList<>();
            Iterator<String> fieldNames = frankfurter.path("rates").fieldNames();
            while (fieldNames.hasNext()) {
                dates.add(fieldNames.next());
            }
            Collections.sort(dates);
            List<BigDecimal> series = new ArrayList<>();
            for (String d : dates) {
                parsePositiveDecimal(frankfurter.path("rates").path(d).get("KRW"))
                        .ifPresent(val -> series.add(val.setScale(1, RoundingMode.HALF_UP)));
            }
            if (series.size() >= 4) {
                List<BigDecimal> history = build14PointHistory(series, openErRate);
                BigDecimal prevRef = history.get(history.size() - 2);
                BigDecimal changeAmt = openErRate.subtract(prevRef).setScale(2, RoundingMode.HALF_UP);
                BigDecimal changePct = changeAmt.multiply(HUNDRED).divide(prevRef, 2, RoundingMode.HALF_UP);
                return new FxQuote(openErRate, changeAmt, changePct, history);
            }
        }

        return new FxQuote(
                openErRate,
                prev.usdKrwChangeAmount(),
                prev.usdKrwChangePct(),
                replaceTailWithCurrentRate(prev.usdKrwHistory(), openErRate)
        );
    }

    private static String fluctuctTypeSafe(String value) {
        return value == null ? "" : value.strip();
    }

    private static List<BigDecimal> extractYahooDailyCloses(JsonNode result0, BigDecimal currentRate) {
        JsonNode closesNode = result0.path("indicators").path("quote").path(0).path("close");
        List<BigDecimal> closes = new ArrayList<>();
        if (closesNode.isArray()) {
            for (JsonNode item : closesNode) {
                parsePositiveDecimal(item)
                        .filter(v -> v.compareTo(MIN_VALID_USD_KRW) >= 0)
                        .ifPresent(v -> closes.add(v.setScale(1, RoundingMode.HALF_UP)));
            }
        }
        if (closes.size() >= 4) {
            // Drop last intraday candle if present so prior 13 days + live currentRate form 14 points
            List<BigDecimal> prior = closes.size() > 1 ? closes.subList(0, closes.size() - 1) : closes;
            return build14PointHistory(prior, currentRate);
        }
        return MarketOverviewMath.buildDeterministicUsdKrwHistory(currentRate);
    }

    private static List<BigDecimal> build14PointHistory(List<BigDecimal> priorSeries, BigDecimal currentRate) {
        List<BigDecimal> prior13 = new ArrayList<>(
                priorSeries.size() > 13
                        ? priorSeries.subList(priorSeries.size() - 13, priorSeries.size())
                        : priorSeries
        );
        while (!prior13.isEmpty() && prior13.size() < 13) {
            prior13.add(0, prior13.get(0));
        }
        if (prior13.size() < 13) {
            return MarketOverviewMath.buildDeterministicUsdKrwHistory(currentRate);
        }
        List<BigDecimal> result = new ArrayList<>(14);
        result.addAll(prior13);
        result.add(currentRate.setScale(2, RoundingMode.HALF_UP));
        return List.copyOf(result);
    }

    private static List<BigDecimal> replaceTailWithCurrentRate(List<BigDecimal> existing, BigDecimal currentRate) {
        if (existing == null || existing.size() < 4) {
            return MarketOverviewMath.buildDeterministicUsdKrwHistory(currentRate);
        }
        List<BigDecimal> updated = new ArrayList<>(existing.subList(0, Math.min(13, existing.size() - 1)));
        while (updated.size() < 13) {
            updated.add(0, updated.get(0));
        }
        updated.add(currentRate.setScale(2, RoundingMode.HALF_UP));
        return List.copyOf(updated);
    }

    private Optional<BigDecimal> fetchUpbitBtcKrw() {
        return fetchJson(UPBIT_BTC_KRW_URI)
                .filter(JsonNode::isArray)
                .filter(arr -> !arr.isEmpty())
                .flatMap(arr -> parsePositiveDecimal(arr.get(0).get("trade_price")));
    }

    private Optional<DominanceQuote> fetchDominanceQuote() {
        JsonNode cg = fetchJson(COINGECKO_GLOBAL_URI).orElse(null);
        if (cg != null) {
            JsonNode data = cg.path("data");
            BigDecimal dom = parsePositiveDecimal(data.path("market_cap_percentage").get("btc")).orElse(null);
            BigDecimal mcapChange = parseDecimal(data.get("market_cap_change_percentage_24h_usd")).orElse(null);
            if (dom != null) {
                return Optional.of(new DominanceQuote(dom.setScale(1, RoundingMode.HALF_UP), mcapChange));
            }
        }
        JsonNode paprika = fetchJson(COINPAPRIKA_GLOBAL_URI).orElse(null);
        if (paprika != null) {
            BigDecimal dom = parsePositiveDecimal(paprika.get("bitcoin_dominance_percentage")).orElse(null);
            BigDecimal mcapChange = parseDecimal(paprika.get("market_cap_change_24h")).orElse(null);
            if (dom != null) {
                return Optional.of(new DominanceQuote(dom.setScale(1, RoundingMode.HALF_UP), mcapChange));
            }
        }
        return Optional.empty();
    }

    private Optional<OpenInterestQuote> fetchOpenInterestQuote(BigDecimal btcUsd) {
        BigDecimal refBtcUsd = (btcUsd != null && btcUsd.compareTo(BigDecimal.ZERO) > 0) ? btcUsd : DEFAULT_REF_BTC_USD;
        JsonNode derivatives = fetchJson(COINGECKO_DERIVATIVES_URI).orElse(null);
        if (derivatives != null && derivatives.isArray() && !derivatives.isEmpty()) {
            JsonNode target = derivatives.get(0);
            for (JsonNode row : derivatives) {
                if ("binance_futures".equalsIgnoreCase(row.path("id").asText(""))) {
                    target = row;
                    break;
                }
            }
            BigDecimal oiBtc = parsePositiveDecimal(target.get("open_interest_btc")).orElse(null);
            if (oiBtc != null) {
                BigDecimal billions = MarketOverviewMath.computeOpenInterestBillionsUsd(oiBtc, refBtcUsd);
                return Optional.of(new OpenInterestQuote(oiBtc, billions));
            }
        }
        JsonNode hist = fetchJson(BINANCE_OI_HIST_URI).orElse(null);
        if (hist != null && hist.isArray() && !hist.isEmpty()) {
            BigDecimal valUsd = parsePositiveDecimal(hist.get(0).get("sumOpenInterestValue")).orElse(null);
            if (valUsd != null) {
                BigDecimal billions = valUsd.divide(BILLION, 1, RoundingMode.HALF_UP);
                BigDecimal impliedOiBtc = valUsd.divide(refBtcUsd, 4, RoundingMode.HALF_UP);
                return Optional.of(new OpenInterestQuote(impliedOiBtc, billions));
            }
        }
        return Optional.empty();
    }

    private Optional<FearGreedQuote> fetchFearGreedQuote() {
        JsonNode fng = fetchJson(ALTERNATIVE_FNG_URI).orElse(null);
        if (fng != null && fng.path("data").isArray() && !fng.path("data").isEmpty()) {
            JsonNode entry = fng.path("data").get(0);
            BigDecimal val = parseDecimal(entry.get("value")).orElse(null);
            if (val != null) {
                int clamped = MarketOverviewMath.clampPercent(val.setScale(0, RoundingMode.HALF_UP).intValue(), 0, 100);
                String rawClass = entry.path("value_classification").asText(null);
                return Optional.of(new FearGreedQuote(clamped, MarketOverviewMath.classifyFearGreedLabelKr(clamped, rawClass)));
            }
        }
        return Optional.empty();
    }

    private Optional<Integer> fetchFuturesBullPct() {
        JsonNode taker = fetchJson(BINANCE_TAKER_RATIO_URI).orElse(null);
        if (taker != null && taker.isArray() && !taker.isEmpty()) {
            JsonNode first = taker.get(0);
            BigDecimal buyVol = parsePositiveDecimal(first.get("buyVol")).orElse(null);
            BigDecimal sellVol = parsePositiveDecimal(first.get("sellVol")).orElse(null);
            if (buyVol != null && sellVol != null) {
                BigDecimal total = buyVol.add(sellVol);
                if (total.compareTo(BigDecimal.ZERO) > 0) {
                    int pct = buyVol.multiply(HUNDRED).divide(total, 0, RoundingMode.HALF_UP).intValue();
                    return Optional.of(MarketOverviewMath.clampPercent(pct, 5, 95));
                }
            }
            BigDecimal ratio = parsePositiveDecimal(first.get("buySellRatio")).orElse(null);
            if (ratio != null) {
                int pct = ratio.multiply(HUNDRED).divide(BigDecimal.ONE.add(ratio), 0, RoundingMode.HALF_UP).intValue();
                return Optional.of(MarketOverviewMath.clampPercent(pct, 5, 95));
            }
        }
        JsonNode account = fetchJson(BINANCE_ACCOUNT_RATIO_URI).orElse(null);
        if (account != null && account.isArray() && !account.isEmpty()) {
            JsonNode first = account.get(0);
            BigDecimal longAcc = parsePositiveDecimal(first.get("longAccount")).orElse(null);
            if (longAcc != null && longAcc.compareTo(BigDecimal.ONE) <= 0) {
                int pct = longAcc.multiply(HUNDRED).setScale(0, RoundingMode.HALF_UP).intValue();
                return Optional.of(MarketOverviewMath.clampPercent(pct, 5, 95));
            }
        }
        return Optional.empty();
    }

    private Long findBtcSymbolId() {
        for (TradingSymbolResponse symbol : symbols.findActiveSymbols()) {
            if ("BTC".equalsIgnoreCase(symbol.symbol()) && "USDT".equalsIgnoreCase(symbol.quoteAsset())) {
                return symbol.id();
            }
        }
        return null;
    }

    private Optional<JsonNode> fetchJson(URI uri) {
        return httpGet.apply(uri).flatMap(body -> {
            try {
                return Optional.ofNullable(mapper.readTree(body));
            } catch (IOException exception) {
                return Optional.empty();
            }
        });
    }

    private static Optional<BigDecimal> parseDecimal(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return Optional.empty();
        }
        String raw = node.asText("").replace(",", "").strip();
        if (raw.isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(new BigDecimal(raw));
        } catch (NumberFormatException exception) {
            return Optional.empty();
        }
    }

    private static Optional<BigDecimal> parsePositiveDecimal(JsonNode node) {
        return parseDecimal(node).filter(val -> val.compareTo(BigDecimal.ZERO) > 0);
    }

    private record BtcQuote(BigDecimal priceUsd, BigDecimal change24hPct) { }
    private record FxQuote(BigDecimal rate, BigDecimal changeAmount, BigDecimal changePct, List<BigDecimal> history) { }
    private record DominanceQuote(BigDecimal dominancePercent, BigDecimal totalMarketCapChange24hPct) { }
    private record OpenInterestQuote(BigDecimal openInterestBtc, BigDecimal openInterestBillionsUsd) { }
    private record FearGreedQuote(int value, String labelKr) { }
}
