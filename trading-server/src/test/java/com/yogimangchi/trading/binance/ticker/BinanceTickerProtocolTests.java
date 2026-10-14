package com.yogimangchi.trading.binance.ticker;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.assertThat;

class BinanceTickerProtocolTests {
    private final Instant now = Instant.ofEpochMilli(1700000000000L);
    private final BinanceTickerProtocol protocol = new BinanceTickerProtocol(List.of(
            new BinanceSubscriptionTarget(91L, "PEPE", "1000PEPEUSDT", 1000L)), new ObjectMapper());
    private static final String VALID = """
            {"stream":"1000pepeusdt@ticker","data":{"e":"24hrTicker","s":"1000PEPEUSDT",
            "E":1700000000000,"P":"-2.370","h":"0.012300","l":"0.009100","q":"1234567890.12"}}
            """;

    @Test
    void normalizesOnlyPricesAndKeepsIdentityPercentageAndQuoteVolume() {
        var ticker = protocol.parse(VALID, now).orElseThrow();
        assertThat(ticker.tradingSymbolId()).isEqualTo(91);
        assertThat(ticker.highPrice24h()).isEqualByComparingTo("0.0000123");
        assertThat(ticker.lowPrice24h()).isEqualByComparingTo("0.0000091");
        assertThat(ticker.changePercent24h()).isEqualByComparingTo("-2.370");
        assertThat(ticker.quoteVolume24h()).isEqualByComparingTo("1234567890.12");
        assertThat(ticker.eventTime()).isEqualTo(now);
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "{", "[]", "{}"})
    void rejectsMalformedEnvelopes(String json) { assertThat(protocol.parse(json, now)).isEmpty(); }

    @Test
    void rejectsWrongStreamUnknownOrInactiveTargetsAndOtherFuturesType() {
        assertThat(protocol.parse(VALID.replace("1000pepeusdt@ticker", "other@ticker"), now)).isEmpty();
        assertThat(protocol.parse(VALID.replace("1000PEPEUSDT", "UNKNOWN"), now)).isEmpty();
        var inactiveNotSubscribed = new BinanceTickerProtocol(List.of(), new ObjectMapper());
        assertThat(inactiveNotSubscribed.parse(VALID, now)).isEmpty();
        assertThat(protocol.parse(VALID.replace("\"e\":", "\"st\":2,\"e\":"), now)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1", "1e2", "NaN", "", "99999999999999999999999999999999999999999999999999999999999999999999999999999999999"})
    void rejectsInvalidPrices(String price) {
        assertThat(protocol.parse(VALID.replace("0.012300", price), now)).isEmpty();
    }

    @Test
    void rejectsMissingNumericOrInvalidFields() {
        assertThat(protocol.parse(VALID.replace("\"0.012300\"", "0.012300"), now)).isEmpty();
        assertThat(protocol.parse(VALID.replace("1234567890.12", "-1"), now)).isEmpty();
        assertThat(protocol.parse(VALID.replace("-2.370", "-101"), now)).isEmpty();
        assertThat(protocol.parse(VALID.replace("1700000000000", "0"), now)).isEmpty();
        assertThat(protocol.parse(VALID.replace("1700000000000", "9223372036854775808"), now)).isEmpty();
        assertThat(protocol.parse(VALID.replace("\"q\"", "\"v\""), now)).isEmpty();
    }

    @Test
    void freshnessChecksBothTimestampsAndClockSkew() {
        var ticker = protocol.parse(VALID, now).orElseThrow();
        assertThat(ticker.isFreshAt(now.plusSeconds(9))).isTrue();
        assertThat(ticker.isFreshAt(now.plusSeconds(10))).isFalse();
        assertThat(ticker.isFreshAt(now.minusSeconds(2))).isFalse();
        assertThat(protocol.parse(VALID, now.minusSeconds(10)).orElseThrow().isFreshAt(now)).isFalse();
    }
}
