package com.yogimangchi.trading.marketdata.overview;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.MarketDataEvent;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.marketdata.summary.MarketSummaryResponse.MarketSummaryStatus;
import com.yogimangchi.trading.marketdata.ticker.MarketTicker;
import com.yogimangchi.trading.marketdata.ticker.RedisTickerStore;
import com.yogimangchi.trading.tradingsymbol.dto.TradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.service.TradingSymbolService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import static com.yogimangchi.trading.marketdata.summary.MarketSummaryResponse.MarketSummaryStatus.FRESH;
import static com.yogimangchi.trading.marketdata.summary.MarketSummaryResponse.MarketSummaryStatus.STALE;
import static com.yogimangchi.trading.marketdata.summary.MarketSummaryResponse.MarketSummaryStatus.UNAVAILABLE;

/** Reads shared Redis overview snapshot and overlays sub-second BTC Mark/Ticker from Redis. */
@Service
public class MarketOverviewService {

    private static final Logger log = LoggerFactory.getLogger(MarketOverviewService.class);
    public static final Duration FRESHNESS = Duration.ofSeconds(30);

    private final TradingSymbolService symbols;
    private final StringRedisTemplate redis;
    private final RedisMarketOverviewStore store;
    private final ObjectMapper mapper;
    private final Clock clock;

    @Autowired
    public MarketOverviewService(
            TradingSymbolService symbols,
            RedisConnectionFactory connections,
            RedisMarketOverviewStore store,
            ObjectMapper mapper
    ) {
        this(symbols, new StringRedisTemplate(connections), store, mapper, Clock.systemUTC());
    }

    MarketOverviewService(
            TradingSymbolService symbols,
            StringRedisTemplate redis,
            RedisMarketOverviewStore store,
            ObjectMapper mapper,
            Clock clock
    ) {
        this.symbols = symbols;
        this.redis = redis;
        this.store = store;
        this.mapper = mapper;
        this.clock = clock;
    }

    public MarketOverviewResponse getOverview() {
        Long btcSymbolId = findBtcSymbolId();
        List<String> keys = btcSymbolId == null
                ? List.of(RedisMarketOverviewStore.OVERVIEW_KEY)
                : List.of(
                        RedisMarketOverviewStore.OVERVIEW_KEY,
                        RedisMarketDataBridge.snapshotKey(btcSymbolId),
                        RedisMarketDataBridge.stateKey(btcSymbolId),
                        RedisTickerStore.snapshotKey(btcSymbolId)
                );

        List<String> values;
        try {
            values = redis.opsForValue().multiGet(keys);
        } catch (DataAccessException exception) {
            log.debug("[Market overview] Redis read unavailable: {}", exception.getClass().getSimpleName());
            return toResponse(MarketOverviewSnapshot.fallback(null), UNAVAILABLE);
        }

        if (values == null || values.isEmpty()) {
            return toResponse(MarketOverviewSnapshot.fallback(null), UNAVAILABLE);
        }

        MarketOverviewSnapshot snapshot = store.parse(values.get(0));
        if (snapshot == null || snapshot.updatedAt() == null) {
            return toResponse(MarketOverviewSnapshot.fallback(null), UNAVAILABLE);
        }

        Instant now = clock.instant();
        LatestMarkPrice liveBtcMark = null;
        MarketTicker liveBtcTicker = null;
        if (btcSymbolId != null && values.size() == 4) {
            LatestMarkPrice parsedMark = readMark(values.get(1), btcSymbolId);
            if (parsedMark != null && LatestPriceStore.isFreshAt(parsedMark, now) && "FRESH".equals(values.get(2))) {
                liveBtcMark = parsedMark;
            }
            MarketTicker parsedTicker = readTicker(values.get(3), btcSymbolId);
            if (parsedTicker != null && parsedTicker.isFreshAt(now)) {
                liveBtcTicker = parsedTicker;
            }
        }

        BigDecimal kimchiPremium = snapshot.kimchiPremiumPercent();
        BigDecimal openInterestBillions = snapshot.openInterestBillionsUsd();
        if (liveBtcMark != null) {
            BigDecimal btcMarkUsd = liveBtcMark.domainMarkPrice();
            if (snapshot.upbitBtcKrw() != null && snapshot.usdKrwRate() != null) {
                kimchiPremium = MarketOverviewMath.computeKimchiPremiumPercent(
                        snapshot.upbitBtcKrw(),
                        btcMarkUsd,
                        snapshot.usdKrwRate()
                );
            }
            if (snapshot.openInterestBtc() != null) {
                openInterestBillions = MarketOverviewMath.computeOpenInterestBillionsUsd(
                        snapshot.openInterestBtc(),
                        btcMarkUsd
                );
            }
        }

        BigDecimal btcChange24h = snapshot.btcChange24h();
        BigDecimal btcDomChange24h = snapshot.btcDominanceChange24h();
        if (liveBtcTicker != null) {
            btcChange24h = liveBtcTicker.changePercent24h().setScale(2, RoundingMode.HALF_UP);
            if (snapshot.totalMarketCapChange24hPct() != null && snapshot.btcDominancePercent() != null) {
                btcDomChange24h = MarketOverviewMath.computeBtcDominanceChange24h(
                        snapshot.btcDominancePercent(),
                        snapshot.totalMarketCapChange24hPct(),
                        btcChange24h
                );
            }
        }

        boolean fresh = !snapshot.updatedAt().isAfter(now.plusSeconds(5))
                && Duration.between(snapshot.updatedAt(), now).compareTo(FRESHNESS) <= 0;

        MarketOverviewSnapshot merged = new MarketOverviewSnapshot(
                snapshot.btcDominancePercent(),
                btcDomChange24h,
                snapshot.totalMarketCapChange24hPct(),
                snapshot.upbitBtcKrw(),
                kimchiPremium,
                snapshot.openInterestBtc(),
                openInterestBillions,
                snapshot.fearGreedValue(),
                snapshot.fearGreedLabelKr(),
                snapshot.futuresBullPct(),
                snapshot.futuresBearPct(),
                btcChange24h,
                snapshot.usdKrwRate(),
                snapshot.usdKrwChangeAmount(),
                snapshot.usdKrwChangePct(),
                snapshot.usdKrwHistory(),
                snapshot.updatedAt()
        );
        return toResponse(merged, fresh ? FRESH : STALE);
    }

    private Long findBtcSymbolId() {
        List<TradingSymbolResponse> active = symbols.findActiveSymbols();
        for (TradingSymbolResponse symbol : active) {
            if ("BTC".equalsIgnoreCase(symbol.symbol()) && "USDT".equalsIgnoreCase(symbol.quoteAsset())) {
                return symbol.id();
            }
        }
        return null;
    }

    private LatestMarkPrice readMark(String json, long id) {
        if (json == null) return null;
        try {
            MarketDataEvent event = mapper.readValue(json, MarketDataEvent.class);
            return event != null && event.type() == MarketDataEvent.Type.PRICE
                    && event.price().tradingSymbolId() == id ? event.price() : null;
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            return null;
        }
    }

    private MarketTicker readTicker(String json, long id) {
        if (json == null) return null;
        try {
            MarketTicker ticker = mapper.readValue(json, MarketTicker.class);
            return ticker != null && ticker.tradingSymbolId() == id ? ticker : null;
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            return null;
        }
    }

    private static MarketOverviewResponse toResponse(MarketOverviewSnapshot s, MarketSummaryStatus status) {
        List<String> history = s.usdKrwHistory().stream()
                .map(BigDecimal::toPlainString)
                .toList();
        return new MarketOverviewResponse(
                s.btcDominancePercent().setScale(1, RoundingMode.HALF_UP).toPlainString(),
                s.btcDominanceChange24h().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                s.kimchiPremiumPercent().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                s.openInterestBillionsUsd().setScale(1, RoundingMode.HALF_UP).toPlainString(),
                s.fearGreedValue(),
                s.fearGreedLabelKr(),
                s.futuresBullPct(),
                s.futuresBearPct(),
                s.btcChange24h().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                s.usdKrwRate().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                s.usdKrwChangeAmount().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                s.usdKrwChangePct().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                history,
                status,
                s.updatedAt()
        );
    }
}
