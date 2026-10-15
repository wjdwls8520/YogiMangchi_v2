package com.yogimangchi.trading.marketdata.candle;

import com.yogimangchi.trading.binance.candle.BinanceCandleClient;
import com.yogimangchi.trading.binance.candle.BinanceCandleTargetLoader;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class CandleService {
    private final BinanceCandleTargetLoader targets;
    private final BinanceCandleClient provider;
    private final RedisCandleCache cache;
    private final Clock clock;
    private final ConcurrentHashMap<String, CompletableFuture<List<CandleResponse>>> inFlight = new ConcurrentHashMap<>();
    // Limit chart requests so a slow provider cannot occupy every HTTP request thread.
    private final Semaphore requests = new Semaphore(32);

    @Autowired
    public CandleService(BinanceCandleTargetLoader targets, BinanceCandleClient provider, RedisCandleCache cache) {
        this(targets, provider, cache, Clock.systemUTC());
    }

    CandleService(BinanceCandleTargetLoader targets, BinanceCandleClient provider, RedisCandleCache cache, Clock clock) {
        this.targets = targets; this.provider = provider; this.cache = cache; this.clock = clock;
    }

    public List<CandleResponse> find(long tradingSymbolId, String intervalValue, int limit) {
        return find(tradingSymbolId, intervalValue, limit, null);
    }

    public List<CandleResponse> find(long tradingSymbolId, String intervalValue, int limit, String beforeValue) {
        Instant requestedAt = clock.instant();
        CandleInterval interval = CandleInterval.parse(intervalValue);
        if (tradingSymbolId <= 0 || limit < 1 || limit > 500) throw new BusinessException(ErrorCode.INVALID_CANDLE_REQUEST);
        Instant before = parseBefore(beforeValue, requestedAt);
        if (!requests.tryAcquire()) throw new BusinessException(ErrorCode.CANDLE_UNAVAILABLE);
        try {
            // The loader's DB transaction ends before Redis/HTTP calls, even on a cache hit.
            var target = targets.load(tradingSymbolId);
            String key = RedisCandleCache.key(target, interval, before);
            var mine = new CompletableFuture<List<CandleResponse>>();
            var existing = inFlight.putIfAbsent(key, mine);
            List<CandleResponse> candles;
            if (existing != null) {
                candles = await(existing);
            } else {
                try {
                    var cached = before == null ? cache.read(key, interval) : cache.read(key, interval, before);
                    candles = cached.orElseGet(() -> {
                        Instant startedAt = clock.instant();
                        var fetched = before == null ? provider.load(target, interval) : provider.load(target, interval, before);
                        if (before != null) fetched = historicalPage(fetched, before, requestedAt);
                        cache.write(key, fetched, startedAt);
                        return fetched;
                    });
                    mine.complete(candles);
                } catch (RuntimeException exception) {
                    mine.completeExceptionally(exception);
                    throw exception;
                } finally { inFlight.remove(key, mine); }
            }
            if (before != null) candles = historicalPage(candles, before, requestedAt);
            return List.copyOf(candles.subList(Math.max(0, candles.size() - limit), candles.size()));
        } finally { requests.release(); }
    }

    private static Instant parseBefore(String value, Instant now) {
        if (value == null) return null;
        try {
            if (value.length() > 40) throw new BusinessException(ErrorCode.INVALID_CANDLE_CURSOR);
            Instant before = Instant.parse(value);
            if (!before.isAfter(Instant.EPOCH) || before.isAfter(now) || before.getNano() % 1_000_000 != 0) {
                throw new BusinessException(ErrorCode.INVALID_CANDLE_CURSOR);
            }
            return before;
        } catch (DateTimeParseException exception) {
            throw new BusinessException(ErrorCode.INVALID_CANDLE_CURSOR);
        }
    }

    private static List<CandleResponse> historicalPage(List<CandleResponse> candles, Instant before, Instant requestedAt) {
        // Even a cursor within the current bucket must not expose a mutable candle as historical data.
        return candles.stream().filter(candle -> candle.openTime().isBefore(before) && candle.closeTime().isBefore(requestedAt)).toList();
    }

    private static List<CandleResponse> await(CompletableFuture<List<CandleResponse>> shared) {
        try { return shared.get(7, TimeUnit.SECONDS); }
        catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new BusinessException(ErrorCode.CANDLE_UNAVAILABLE);
        } catch (TimeoutException exception) {
            throw new BusinessException(ErrorCode.CANDLE_PROVIDER_TIMEOUT);
        } catch (ExecutionException exception) {
            if (exception.getCause() instanceof RuntimeException failure) throw failure;
            throw new BusinessException(ErrorCode.CANDLE_PROVIDER_FAILURE);
        }
    }
}
