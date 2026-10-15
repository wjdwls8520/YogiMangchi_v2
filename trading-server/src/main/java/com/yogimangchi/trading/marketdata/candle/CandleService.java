package com.yogimangchi.trading.marketdata.candle;

import com.yogimangchi.trading.binance.candle.BinanceCandleClient;
import com.yogimangchi.trading.binance.candle.BinanceCandleTargetLoader;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.stereotype.Service;

@Service
public class CandleService {
    private final BinanceCandleTargetLoader targets;
    private final BinanceCandleClient provider;
    private final RedisCandleCache cache;
    private final ConcurrentHashMap<String, CompletableFuture<List<CandleResponse>>> inFlight = new ConcurrentHashMap<>();
    // Limit chart requests so a slow provider cannot occupy every HTTP request thread.
    private final Semaphore requests = new Semaphore(32);

    public CandleService(BinanceCandleTargetLoader targets, BinanceCandleClient provider, RedisCandleCache cache) {
        this.targets = targets; this.provider = provider; this.cache = cache;
    }

    public List<CandleResponse> find(long tradingSymbolId, String intervalValue, int limit) {
        CandleInterval interval = CandleInterval.parse(intervalValue);
        if (tradingSymbolId <= 0 || limit < 1 || limit > 500) throw new BusinessException(ErrorCode.INVALID_CANDLE_REQUEST);
        if (!requests.tryAcquire()) throw new BusinessException(ErrorCode.CANDLE_UNAVAILABLE);
        try {
            // The loader's DB transaction ends before Redis/HTTP calls, even on a cache hit.
            var target = targets.load(tradingSymbolId);
            String key = RedisCandleCache.key(target, interval);
            var mine = new CompletableFuture<List<CandleResponse>>();
            var existing = inFlight.putIfAbsent(key, mine);
            List<CandleResponse> candles;
            if (existing != null) {
                candles = await(existing);
            } else {
                try {
                    candles = cache.read(key, interval).orElseGet(() -> {
                        Instant startedAt = Instant.now();
                        var fetched = provider.load(target, interval);
                        cache.write(key, fetched, startedAt);
                        return fetched;
                    });
                    mine.complete(candles);
                } catch (RuntimeException exception) {
                    mine.completeExceptionally(exception);
                    throw exception;
                } finally { inFlight.remove(key, mine); }
            }
            return List.copyOf(candles.subList(Math.max(0, candles.size() - limit), candles.size()));
        } finally { requests.release(); }
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
