package com.yogimangchi.trading.binance.orderbook;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class BinanceOrderBookProtocolTests {
    private final Instant now = Instant.parse("2026-10-16T00:00:00Z");
    private final BinanceOrderBookProtocol protocol = new BinanceOrderBookProtocol(List.of(
            new BinanceSubscriptionTarget(11L, "PEPE", "1000PEPEUSDT", 1000)), new ObjectMapper());

    @Test void partialBookHasItsOwnPublicConnectionAndExplicitContractUnits() {
        assertThat(protocol.uri().toString()).isEqualTo("wss://fstream.binance.com/public/stream?streams=1000pepeusdt@depth20@500ms");
        var book = protocol.parse(message(now), now).orElseThrow();
        assertThat(book.tradingSymbolId()).isEqualTo(11);
        assertThat(book.providerUpdateId()).isEqualTo(100);
        assertThat(book.bids().get(0).price()).isEqualTo("0.000004001");
        assertThat(book.bids().get(0).quantity()).isEqualTo("1250.00");
        assertThat(book.asks().get(0).price()).isEqualTo("0.000004002");
        assertThat(book.asks().get(0).quantity()).isEqualTo("2500.0");
        assertThat(book.isFreshAt(now.plusSeconds(2))).isTrue();
        assertThat(book.isFreshAt(now.plusSeconds(3))).isFalse();
        var unscaled = new BinanceOrderBookProtocol(List.of(new BinanceSubscriptionTarget(11L,"PEPE","1000PEPEUSDT",1)), new ObjectMapper());
        assertThat(unscaled.parse(message(now), now).orElseThrow().bids().get(0).price()).isEqualTo("0.004001");
    }
    @Test void rejectsMalformedWrongSymbolWrongStreamAndInvalidLevels() {
        for (String invalid : List.of("{}", "null", "{", message(now).replace("depth20@500ms", "depth@500ms"),
                message(now).replace("1000PEPEUSDT", "BTCUSDT"), message(now).replace("\"st\":1", "\"st\":2"),
                message(now).replace("\"1.25\"", "1.25"), message(now).replace("\"1.25\"", "\"0\""),
                message(now).replace("\"1.25\"", "\"-1\""), message(now).replace("\"1.25\"", "\"1e2\""),
                message(now).replace("0.004002", "0.004000"), message(now).replace("\"U\":90", "\"U\":101"),
                message(now).replace("[\"0.004001\",\"1.25\"]", "[\"0.004001\"]"))) {
            assertThat(protocol.parse(invalid, now)).as(invalid).isEmpty();
        }
        assertThat(protocol.parse(message(now.minusSeconds(4)), now)).isEmpty();
        assertThat(protocol.parse(message(now.plusSeconds(11)), now)).isEmpty();
        assertThat(protocol.parse(message(now.plusSeconds(6)), now)).isPresent();
    }
    @Test void rejectsDuplicateOrUnorderedLevelsAndOversizedPayloads() {
        assertThat(protocol.parse(message(now).replace("[\"0.004001\",\"1.25\"]",
                "[\"0.004001\",\"1.25\"],[\"0.004001\",\"2\"]"), now)).isEmpty();
        assertThat(protocol.parse(" ".repeat(65537), now)).isEmpty();
    }
    static String message(Instant event) {
        return "{\"stream\":\"1000pepeusdt@depth20@500ms\",\"data\":{\"e\":\"depthUpdate\",\"s\":\"1000PEPEUSDT\",\"st\":1,\"E\":"
                + event.toEpochMilli() + ",\"U\":90,\"u\":100,\"b\":[[\"0.004001\",\"1.25\"]],\"a\":[[\"0.004002\",\"2.5\"]]}}";
    }
}
