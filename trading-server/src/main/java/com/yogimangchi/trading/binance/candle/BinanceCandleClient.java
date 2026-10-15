package com.yogimangchi.trading.binance.candle;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.marketdata.candle.CandleInterval;
import com.yogimangchi.trading.marketdata.candle.CandleResponse;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Chart-only bounded HTTP client. No price-store, stream, fanout or trading-gate dependencies. */
@Component
public class BinanceCandleClient {
    private static final Logger log = LoggerFactory.getLogger(BinanceCandleClient.class);
    private final HttpClient http;
    private final URI endpoint;
    private final Duration timeout;
    private final BinanceCandleParser parser;
    private final Semaphore capacity = new Semaphore(4);
    private volatile long retryAfter;

    @Autowired
    public BinanceCandleClient(ObjectMapper mapper) {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build(), mapper,
                URI.create("https://fapi.binance.com/fapi/v1/markPriceKlines"), Duration.ofSeconds(4));
    }
    BinanceCandleClient(HttpClient http, ObjectMapper mapper, URI endpoint, Duration timeout) {
        this.http = http; this.parser = new BinanceCandleParser(mapper); this.endpoint = endpoint; this.timeout = timeout;
    }

    public List<CandleResponse> load(BinanceSubscriptionTarget target, CandleInterval interval) {
        if (System.nanoTime() < retryAfter || !capacity.tryAcquire()) throw new BusinessException(ErrorCode.CANDLE_UNAVAILABLE);
        try {
            URI uri = URI.create(endpoint + "?symbol=" + target.providerSymbol() + "&interval=" + interval.providerValue()
                    + "&limit=" + BinanceCandleParser.MAX_CANDLES);
            var request = HttpRequest.newBuilder(uri).timeout(timeout).header("Accept", "application/json").GET().build();
            var response = send(request);
            if (response.statusCode() == 429 || response.statusCode() == 418) {
                long seconds = response.headers().firstValue("Retry-After").map(BinanceCandleClient::retrySeconds).orElse(60L);
                pause(Math.max(60, Math.min(seconds, 604800)));
                log.warn("[Candle provider] rate limited status={}; requests paused", response.statusCode());
                throw new BusinessException(ErrorCode.CANDLE_UNAVAILABLE);
            }
            if (response.statusCode() != 200) {
                log.warn("[Candle provider] request failed status={} tradingSymbolId={}", response.statusCode(), target.tradingSymbolId());
                throw new BusinessException(ErrorCode.CANDLE_PROVIDER_FAILURE);
            }
            return parser.parse(response.body(), target, interval);
        } catch (HttpTimeoutException exception) {
            pause(2);
            log.warn("[Candle provider] request timed out tradingSymbolId={}", target.tradingSymbolId());
            throw new BusinessException(ErrorCode.CANDLE_PROVIDER_TIMEOUT);
        } catch (IOException exception) {
            pause(2);
            log.warn("[Candle provider] connection failed tradingSymbolId={}", target.tradingSymbolId());
            throw new BusinessException(ErrorCode.CANDLE_PROVIDER_FAILURE);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new BusinessException(ErrorCode.CANDLE_UNAVAILABLE);
        } catch (BusinessException exception) {
            if (exception.getCode() == ErrorCode.CANDLE_PROVIDER_FAILURE) pause(2);
            throw exception;
        } finally { capacity.release(); }
    }

    // The deadline covers the entire response body, not just connection/response headers.
    private HttpResponse<String> send(HttpRequest request) throws IOException, InterruptedException {
        var pending = http.sendAsync(request, info -> new CandleBodySubscriber());
        try { return pending.get(timeout.toMillis(), TimeUnit.MILLISECONDS); }
        catch (TimeoutException exception) {
            pending.cancel(true);
            throw new HttpTimeoutException("Candle response deadline exceeded");
        } catch (InterruptedException exception) {
            pending.cancel(true);
            throw exception;
        } catch (ExecutionException exception) {
            if (exception.getCause() instanceof IOException failure) throw failure;
            throw new BusinessException(ErrorCode.CANDLE_PROVIDER_FAILURE);
        }
    }

    private static long retrySeconds(String value) {
        try { return Long.parseLong(value); }
        catch (NumberFormatException exception) { return 60; }
    }

    private synchronized void pause(long seconds) {
        // A later in-flight failure must never shorten an existing rate-limit pause.
        retryAfter = Math.max(retryAfter, System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds));
    }

    private static final class CandleBodySubscriber implements HttpResponse.BodySubscriber<String> {
        private final HttpResponse.BodySubscriber<String> delegate = HttpResponse.BodySubscribers.ofString(StandardCharsets.UTF_8);
        private Flow.Subscription subscription;
        private long bytes;
        @Override public CompletionStage<String> getBody() { return delegate.getBody(); }
        @Override public void onSubscribe(Flow.Subscription value) { subscription = value; delegate.onSubscribe(value); }
        @Override public void onNext(List<ByteBuffer> buffers) {
            for (var buffer : buffers) bytes += buffer.remaining();
            if (bytes > 1_000_000) {
                subscription.cancel();
                delegate.onError(new IOException("Oversized candle response"));
            } else delegate.onNext(buffers);
        }
        @Override public void onError(Throwable error) { delegate.onError(error); }
        @Override public void onComplete() { delegate.onComplete(); }
    }
}
