package com.yogimangchi.trading.binance.candle;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.marketdata.candle.CandleInterval;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.*;

class BinanceCandleParserTests {
    static final long OPEN = Instant.parse("2026-10-15T00:00:00Z").toEpochMilli();
    private final BinanceCandleParser parser = new BinanceCandleParser(new ObjectMapper());
    private final BinanceSubscriptionTarget target = new BinanceSubscriptionTarget(11L, "PEPE", "1000PEPEUSDT", 1000);

    @ParameterizedTest
    @CsvSource({"1m,1m", "3m,3m", "5m,5m", "15m,15m", "30m,30m", "1h,1h", "4h,4h", "12h,12h", "24h,1d"})
    void supportsAllDomainTimeframesWithExactProviderBucket(String value, String providerValue) {
        var interval = CandleInterval.parse(value);
        assertThat(interval.providerValue()).isEqualTo(providerValue);
        var candle = parser.parse("[" + row(OPEN, interval.millis()) + "]", target, interval).get(0);
        assertThat(candle.openTime()).isEqualTo(Instant.ofEpochMilli(OPEN));
        assertThat(candle.closeTime()).isEqualTo(Instant.ofEpochMilli(OPEN + interval.millis() - 1));
        assertThat(candle.open()).isEqualTo("0.0000123");
        assertThat(candle.high()).isEqualTo("0.0000156");
        assertThat(candle.low()).isEqualTo("0.0000091");
        assertThat(candle.close()).isEqualTo("0.0000145");
    }

    @Test void returnsAscendingUniqueTimesWithoutFillingGaps() {
        String body = "[" + row(OPEN + 120000, 60000) + "," + row(OPEN, 60000) + "]";
        assertThat(parser.parse(body, target, CandleInterval.ONE_MINUTE)).extracting(c -> c.openTime())
                .containsExactly(Instant.ofEpochMilli(OPEN), Instant.ofEpochMilli(OPEN + 120000));
        failure("[" + row(OPEN, 60000) + "," + row(OPEN, 60000) + "]");
    }

    @ParameterizedTest @ValueSource(strings = {"null", "{}", "{", "[1]", "[[1]]", "[[null]]"})
    void malformedResponsesFailClearly(String body) { failure(body); }

    @Test void rejectsInvalidPricesRangesAndBucketBoundaries() {
        String valid = "[" + row(OPEN, 60000) + "]";
        failure(valid.replace("\"0.012300\"", "0.012300"));
        failure(valid.replace("0.012300", "0"));
        failure(valid.replace("0.012300", "-1"));
        failure(valid.replace("0.012300", "NaN"));
        failure(valid.replace("0.012300", "1e-8"));
        failure(valid.replace("0.015600", "0.011"));
        failure("[" + row(OPEN + 1, 60000) + "]");
        failure(valid.replace(Long.toString(OPEN + 59999), Long.toString(OPEN + 60000)));
    }

    @Test void preservesPrecisionWithoutScientificNotationAndDoesNotInferMultiplierFromName() {
        var mapped = new BinanceSubscriptionTarget(42L, "PEPE", "1000PEPEUSDT", 1);
        var candle = parser.parse("[" + row(OPEN, 60000).replace("0.009100", "0.000000000000000000000123") + "]",
                mapped, CandleInterval.ONE_MINUTE).get(0);
        assertThat(candle.open()).isEqualTo("0.012300");
        assertThat(candle.low()).isEqualTo("0.000000000000000000000123");
    }

    @Test void emptyHistoryIsAnEmptyList() { assertThat(parser.parse("[]", target, CandleInterval.ONE_MINUTE)).isEmpty(); }

    static String row(long open, long duration) {
        return "[" + open + ",\"0.012300\",\"0.015600\",\"0.009100\",\"0.014500\",\"0\","
                + (open + duration - 1) + ",\"0\",60,\"0\",\"0\",\"0\"]";
    }
    private void failure(String body) {
        assertThatThrownBy(() -> parser.parse(body, target, CandleInterval.ONE_MINUTE)).isInstanceOfSatisfying(
                BusinessException.class, error -> assertThat(error.getCode()).isEqualTo(ErrorCode.CANDLE_PROVIDER_FAILURE));
    }
}
