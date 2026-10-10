package com.yogimangchi.trading.binance.markprice;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BinanceMarkPriceProtocolTests {

    private final BinanceMarkPriceProtocol protocol = new BinanceMarkPriceProtocol(List.of(
            new BinanceSubscriptionTarget(42L, "BTC", "BTCUSDT", 1L),
            new BinanceSubscriptionTarget(91L, "PEPE", "1000PEPEUSDT", 1000L)), new ObjectMapper());

    @Test
    void buildsOneRoutedCombinedStreamFromDatabaseTargets() {
        assertThat(protocol.uri().toString()).isEqualTo("wss://fstream.binance.com/market/stream?streams="
                + "btcusdt@markPrice@1s/1000pepeusdt@markPrice@1s");
        assertThat(protocol.size()).isEqualTo(2);
    }

    @Test
    void streamNamesDoNotDependOnSystemLocale() {
        Locale previous = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"));
            assertThat(BinanceMarkPriceProtocol.streamName("LINKUSDT")).isEqualTo("linkusdt@markPrice@1s");
        } finally {
            Locale.setDefault(previous);
        }
    }

    @Test
    void mapsProviderSymbolToInternalIdentityAndPreservesDecimalPrecision() {
        Instant receivedAt = Instant.parse("2026-10-08T00:00:01Z");
        var event = protocol.parse(message("1000PEPEUSDT", "0.009876543210123456789000"), receivedAt)
                .orElseThrow();
        assertThat(event.tradingSymbolId()).isEqualTo(91L);
        assertThat(event.symbol()).isEqualTo("PEPE");
        assertThat(event.providerSymbol()).isEqualTo("1000PEPEUSDT");
        assertThat(event.providerMarkPrice()).isEqualTo(new BigDecimal("0.009876543210123456789000"));
        assertThat(event.domainMarkPrice()).isEqualByComparingTo("0.000009876543210123456789000");
        assertThat(event.eventTime()).isEqualTo(Instant.ofEpochMilli(1562305380000L));
        assertThat(event.receivedAt()).isEqualTo(receivedAt);
    }

    @ParameterizedTest
    @CsvSource({"BTC,BTCUSDT,1,82692.90000000,82692.90000000",
            "PEPE,1000PEPEUSDT,1000,0.0098,0.0000098",
            "SHIB,1000SHIBUSDT,1000,0.01543210,0.00001543210"})
    void normalizesVerifiedContractUnitsExactly(String symbol, String providerSymbol, long multiplier,
                                               String providerPrice, String domainPrice) {
        var mapped = new BinanceMarkPriceProtocol(List.of(
                new BinanceSubscriptionTarget(5L, symbol, providerSymbol, multiplier)), new ObjectMapper());
        var event = mapped.parse(message(providerSymbol, providerPrice), Instant.now()).orElseThrow();
        assertThat(event.providerMarkPrice()).isEqualTo(new BigDecimal(providerPrice));
        assertThat(event.domainMarkPrice()).isEqualByComparingTo(domainPrice);
    }

    @ParameterizedTest
    @ValueSource(longs = {0, -1, 3, 7})
    void refusesInvalidOrNonTerminatingMultipliers(long multiplier) {
        assertThatThrownBy(() -> new BinanceSubscriptionTarget(1L, "TEST", "TESTUSDT", multiplier))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{", "null", "[]", "{}", "{\"data\":{\"e\":\"markPriceUpdate\"}}"})
    void rejectsMalformedOrIncompletePayloads(String json) {
        assertThat(protocol.parse(json, Instant.now())).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1", "NaN", "Infinity", "1e99999", "1.2.3"})
    void rejectsInvalidPrices(String price) {
        assertThat(protocol.parse(message("BTCUSDT", price), Instant.now())).isEmpty();
    }

    @Test
    void rejectsUnknownSymbolsWrongStreamsEventTypesAndCoinMarginedData() {
        assertThat(protocol.parse(message("ETHUSDT", "100"), Instant.now())).isEmpty();
        String valid = message("BTCUSDT", "123.45000000");
        assertThat(protocol.parse(valid.replace("btcusdt@", "ethusdt@"), Instant.now())).isEmpty();
        assertThat(protocol.parse(valid.replace("markPriceUpdate", "aggTrade"), Instant.now())).isEmpty();
        assertThat(protocol.parse(valid.replace("\"st\":1", "\"st\":2"), Instant.now())).isEmpty();
        assertThat(protocol.parse(valid.replace("1562305380000", "1.5"), Instant.now())).isEmpty();
        assertThat(protocol.parse(valid.replace("1562305380000", "9223372036854775808"), Instant.now())).isEmpty();
        assertThat(protocol.parse(valid, Instant.now())).isPresent();
        assertThat(protocol.parse(valid.replace(",\"st\":1", ""), Instant.now())).isPresent();
    }

    @Test
    void refusesEmptyOversizedDuplicateAndUnsafeSubscriptionTargets() {
        var target = new BinanceSubscriptionTarget(1L, "BTC", "BTCUSDT", 1L);
        assertThatThrownBy(() -> new BinanceMarkPriceProtocol(List.of(), new ObjectMapper()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new BinanceMarkPriceProtocol(java.util.Collections.nCopies(1025, target),
                new ObjectMapper())).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new BinanceMarkPriceProtocol(List.of(target, target), new ObjectMapper()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new BinanceMarkPriceProtocol(List.of(
                new BinanceSubscriptionTarget(1L, "BTC", "BTCUSDT/ethusdt@ticker", 1L)), new ObjectMapper()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    static String message(String symbol, String price) {
        return "{\"stream\":\"" + BinanceMarkPriceProtocol.streamName(symbol)
                + "\",\"data\":{\"e\":\"markPriceUpdate\",\"E\":1562305380000,\"s\":\"" + symbol
                + "\",\"p\":\"" + price + "\",\"i\":\"100\",\"r\":\"0.0001\",\"T\":1562306400000,\"st\":1}}";
    }
}
