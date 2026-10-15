package com.yogimangchi.trading.marketdata.candle;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import java.time.Duration;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** Shared short-lived chart data, with no dependency on the execution market-data bridge. */
@Component
public class RedisCandleCache {
    public static final Duration TTL = Duration.ofSeconds(15);
    private static final Logger log = LoggerFactory.getLogger(RedisCandleCache.class);
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final Clock clock;

    public record CachedCandles(Instant fetchedAt, List<CandleResponse> candles) {
        public CachedCandles {
            if (fetchedAt == null || candles == null || candles.size() > 500) throw new IllegalArgumentException("Invalid candle cache");
            candles = List.copyOf(candles);
        }
    }

    @Autowired
    public RedisCandleCache(StringRedisTemplate redis, ObjectMapper mapper) { this(redis, mapper, Clock.systemUTC()); }
    RedisCandleCache(StringRedisTemplate redis, ObjectMapper mapper, Clock clock) {
        this.redis = redis; this.mapper = mapper; this.clock = clock;
    }

    // Mapping is part of the internal cache identity so a mapping change cannot reuse incorrectly normalized data.
    public static String key(BinanceSubscriptionTarget target, CandleInterval interval) {
        return "trading:market:v1:candles:" + target.tradingSymbolId() + ":" + interval.value()
                + ":" + target.providerSymbol() + ":" + target.providerUnitMultiplier();
    }

    public Optional<List<CandleResponse>> read(String key, CandleInterval interval) {
        try {
            String json = redis.opsForValue().get(key);
            if (json == null) return Optional.empty();
            var cached = mapper.readValue(json, CachedCandles.class);
            Instant now = clock.instant();
            if (cached == null || !cached.fetchedAt().isAfter(now.minus(TTL)) || cached.fetchedAt().isAfter(now.plusSeconds(1))) return Optional.empty();
            Instant previous = Instant.MIN;
            for (var candle : cached.candles()) {
                long open = candle.openTime().toEpochMilli();
                if (!candle.openTime().isAfter(previous) || open <= 0 || open % interval.millis() != 0
                        || candle.closeTime().toEpochMilli() != Math.addExact(open, interval.millis() - 1)) return Optional.empty();
                previous = candle.openTime();
            }
            if (!cached.candles().isEmpty()) {
                Instant end = cached.candles().get(cached.candles().size() - 1).closeTime().plusMillis(1);
                if (cached.fetchedAt().isBefore(end) && !now.isBefore(end)) return Optional.empty();
            }
            return Optional.of(cached.candles());
        } catch (DataAccessException exception) {
            // Do not turn a Redis outage into uncached requests proportional to browser count.
            throw new BusinessException(ErrorCode.CANDLE_UNAVAILABLE);
        } catch (JsonProcessingException | IllegalArgumentException | ArithmeticException exception) {
            log.debug("[Candle cache] invalid cached payload ignored");
            return Optional.empty();
        }
    }

    public void write(String key, List<CandleResponse> candles, Instant fetchedAt) {
        Instant now = clock.instant();
        Duration remaining = Duration.between(now, fetchedAt.plus(TTL));
        if (!candles.isEmpty()) {
            Instant end = candles.get(candles.size() - 1).closeTime().plusMillis(1);
            if (fetchedAt.isBefore(end)) {
                Duration bucketRemaining = Duration.between(now, end);
                if (bucketRemaining.compareTo(remaining) < 0) remaining = bucketRemaining;
            }
        }
        if (remaining.isNegative() || remaining.isZero()) return;
        try {
            redis.opsForValue().set(key, mapper.writeValueAsString(new CachedCandles(fetchedAt, candles)), remaining.compareTo(TTL) > 0 ? TTL : remaining);
        } catch (DataAccessException | JsonProcessingException exception) {
            // The fetched response is valid for callers already sharing this request; later cache failures return 503.
            log.debug("[Candle cache] cache write unavailable: {}", exception.getClass().getSimpleName());
        }
    }
}
