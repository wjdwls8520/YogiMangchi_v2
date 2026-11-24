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
import java.util.ArrayList;
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
        List<TradingSymbolResponse> activeSymbols = symbols.findActiveSymbols();
        Long btcSymbolId = findSymbolId(activeSymbols, "BTC");
        Long ethSymbolId = findSymbolId(activeSymbols, "ETH");
        Long xrpSymbolId = findSymbolId(activeSymbols, "XRP");

        List<String> keys = new ArrayList<>();
        keys.add(RedisMarketOverviewStore.OVERVIEW_KEY);
        int btcSnapIdx = -1;
        int btcStateIdx = -1;
        int btcTickerIdx = -1;
        if (btcSymbolId != null) {
            btcSnapIdx = keys.size();
            keys.add(RedisMarketDataBridge.snapshotKey(btcSymbolId));
            btcStateIdx = keys.size();
            keys.add(RedisMarketDataBridge.stateKey(btcSymbolId));
            btcTickerIdx = keys.size();
            keys.add(RedisTickerStore.snapshotKey(btcSymbolId));
        }
        int ethSnapIdx = -1;
        int ethStateIdx = -1;
        if (ethSymbolId != null) {
            ethSnapIdx = keys.size();
            keys.add(RedisMarketDataBridge.snapshotKey(ethSymbolId));
            ethStateIdx = keys.size();
            keys.add(RedisMarketDataBridge.stateKey(ethSymbolId));
        }
        int xrpSnapIdx = -1;
        int xrpStateIdx = -1;
        if (xrpSymbolId != null) {
            xrpSnapIdx = keys.size();
            keys.add(RedisMarketDataBridge.snapshotKey(xrpSymbolId));
            xrpStateIdx = keys.size();
            keys.add(RedisMarketDataBridge.stateKey(xrpSymbolId));
        }

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
        if (btcSymbolId != null && values.size() > btcTickerIdx) {
            LatestMarkPrice parsedMark = readMark(values.get(btcSnapIdx), btcSymbolId);
            if (parsedMark != null && LatestPriceStore.isFreshAt(parsedMark, now) && "FRESH".equals(values.get(btcStateIdx))) {
                liveBtcMark = parsedMark;
            }
            MarketTicker parsedTicker = readTicker(values.get(btcTickerIdx), btcSymbolId);
            if (parsedTicker != null && parsedTicker.isFreshAt(now)) {
                liveBtcTicker = parsedTicker;
            }
        }
        LatestMarkPrice liveEthMark = null;
        if (ethSymbolId != null && values.size() > ethStateIdx) {
            LatestMarkPrice parsedMark = readMark(values.get(ethSnapIdx), ethSymbolId);
            if (parsedMark != null && LatestPriceStore.isFreshAt(parsedMark, now) && "FRESH".equals(values.get(ethStateIdx))) {
                liveEthMark = parsedMark;
            }
        }
        LatestMarkPrice liveXrpMark = null;
        if (xrpSymbolId != null && values.size() > xrpStateIdx) {
            LatestMarkPrice parsedMark = readMark(values.get(xrpSnapIdx), xrpSymbolId);
            if (parsedMark != null && LatestPriceStore.isFreshAt(parsedMark, now) && "FRESH".equals(values.get(xrpStateIdx))) {
                liveXrpMark = parsedMark;
            }
        }

        BigDecimal kimchiPremium = snapshot.kimchiPremiumPercent();
        BigDecimal ethKimchiPremium = snapshot.ethKimchiPremiumPercent();
        BigDecimal xrpKimchiPremium = snapshot.xrpKimchiPremiumPercent();
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
        if (liveEthMark != null && snapshot.upbitEthKrw() != null && snapshot.usdKrwRate() != null) {
            ethKimchiPremium = MarketOverviewMath.computeKimchiPremiumPercent(
                    snapshot.upbitEthKrw(),
                    liveEthMark.domainMarkPrice(),
                    snapshot.usdKrwRate()
            );
        }
        if (liveXrpMark != null && snapshot.upbitXrpKrw() != null && snapshot.usdKrwRate() != null) {
            xrpKimchiPremium = MarketOverviewMath.computeKimchiPremiumPercent(
                    snapshot.upbitXrpKrw(),
                    liveXrpMark.domainMarkPrice(),
                    snapshot.usdKrwRate()
            );
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
                snapshot.updatedAt(),
                snapshot.upbitEthKrw(),
                ethKimchiPremium,
                snapshot.upbitXrpKrw(),
                xrpKimchiPremium
        );
        return toResponse(merged, fresh ? FRESH : STALE);
    }

    private Long findSymbolId(List<TradingSymbolResponse> active, String baseSymbol) {
        for (TradingSymbolResponse symbol : active) {
            if (baseSymbol.equalsIgnoreCase(symbol.symbol()) && "USDT".equalsIgnoreCase(symbol.quoteAsset())) {
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
                s.ethKimchiPremiumPercent() != null ? s.ethKimchiPremiumPercent().setScale(2, RoundingMode.HALF_UP).toPlainString() : null,
                s.xrpKimchiPremiumPercent() != null ? s.xrpKimchiPremiumPercent().setScale(2, RoundingMode.HALF_UP).toPlainString() : null,
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
