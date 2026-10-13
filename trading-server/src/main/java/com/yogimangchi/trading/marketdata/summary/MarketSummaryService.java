package com.yogimangchi.trading.marketdata.summary;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.MarketDataEvent;
import com.yogimangchi.trading.marketdata.RedisMarketDataBridge;
import com.yogimangchi.trading.marketdata.ticker.MarketTicker;
import com.yogimangchi.trading.marketdata.ticker.RedisTickerStore;
import com.yogimangchi.trading.tradingsymbol.dto.TradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.service.TradingSymbolService;
import java.math.BigDecimal;
import java.time.Clock;
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

/** One shared Redis read after the symbol service's DB transaction ends. Never falls back to JVM prices. */
@Service
public class MarketSummaryService {
    private static final Logger log = LoggerFactory.getLogger(MarketSummaryService.class);
    private final TradingSymbolService symbols;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final Clock clock;

    @Autowired
    public MarketSummaryService(TradingSymbolService symbols, RedisConnectionFactory connections, ObjectMapper mapper) {
        this(symbols, new StringRedisTemplate(connections), mapper, Clock.systemUTC());
    }

    MarketSummaryService(TradingSymbolService symbols, StringRedisTemplate redis, ObjectMapper mapper, Clock clock) {
        this.symbols = symbols;
        this.redis = redis;
        this.mapper = mapper;
        this.clock = clock;
    }

    public List<MarketSummaryResponse> findActiveTickers() {
        List<TradingSymbolResponse> active = symbols.findActiveSymbols();
        if (active.isEmpty()) return List.of();
        List<String> keys = new ArrayList<>(active.size() * 3);
        for (var symbol : active) {
            keys.add(RedisMarketDataBridge.snapshotKey(symbol.id()));
            keys.add(RedisMarketDataBridge.stateKey(symbol.id()));
            keys.add(RedisTickerStore.snapshotKey(symbol.id()));
        }
        List<String> values;
        try {
            values = redis.opsForValue().multiGet(keys);
        } catch (DataAccessException exception) {
            log.debug("[Market summary] Redis read unavailable: {}", exception.getClass().getSimpleName());
            return active.stream().map(symbol -> response(symbol, null, null, UNAVAILABLE)).toList();
        }
        if (values == null || values.size() != keys.size()) {
            return active.stream().map(symbol -> response(symbol, null, null, UNAVAILABLE)).toList();
        }
        Instant now = clock.instant();
        List<MarketSummaryResponse> result = new ArrayList<>(active.size());
        for (int i = 0; i < active.size(); i++) {
            var symbol = active.get(i);
            var mark = readMark(values.get(i * 3), symbol.id());
            var ticker = readTicker(values.get(i * 3 + 2), symbol.id());
            boolean stale = (mark != null && !LatestPriceStore.isFreshAt(mark, now))
                    || (ticker != null && !ticker.isFreshAt(now));
            if (mark != null && (!LatestPriceStore.isFreshAt(mark, now) || !"FRESH".equals(values.get(i * 3 + 1)))) mark = null;
            if (ticker != null && !ticker.isFreshAt(now)) ticker = null;
            result.add(response(symbol, mark, ticker, stale ? STALE : mark != null && ticker != null ? FRESH : UNAVAILABLE));
        }
        return List.copyOf(result);
    }

    private LatestMarkPrice readMark(String json, long id) {
        if (json == null) return null;
        try {
            var event = mapper.readValue(json, MarketDataEvent.class);
            return event != null && event.type() == MarketDataEvent.Type.PRICE
                    && event.price().tradingSymbolId() == id ? event.price() : null;
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            log.debug("[Market summary] invalid Mark snapshot id={}", id);
            return null;
        }
    }

    private MarketTicker readTicker(String json, long id) {
        if (json == null) return null;
        try {
            var ticker = mapper.readValue(json, MarketTicker.class);
            return ticker != null && ticker.tradingSymbolId() == id ? ticker : null;
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            log.debug("[Market summary] invalid ticker snapshot id={}", id);
            return null;
        }
    }

    private static MarketSummaryResponse response(TradingSymbolResponse symbol, LatestMarkPrice mark,
            MarketTicker ticker, MarketSummaryResponse.MarketSummaryStatus status) {
        Instant updated = mark == null ? null : mark.eventTime();
        if (ticker != null && (updated == null || ticker.eventTime().isBefore(updated))) updated = ticker.eventTime();
        return new MarketSummaryResponse(symbol.id(), symbol.symbol(), symbol.quoteAsset(),
                mark == null ? null : decimal(mark.domainMarkPrice()),
                ticker == null ? null : decimal(ticker.changePercent24h()),
                ticker == null ? null : decimal(ticker.highPrice24h()),
                ticker == null ? null : decimal(ticker.lowPrice24h()),
                ticker == null ? null : decimal(ticker.quoteVolume24h()), status, updated);
    }

    private static String decimal(BigDecimal value) { return value.toPlainString(); }
}
