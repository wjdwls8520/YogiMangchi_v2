package com.yogimangchi.trading.binance.orderbook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.marketdata.orderbook.OrderBookSnapshot;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Instant;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

public final class BinanceOrderBookProtocol {
    private final Map<String, BinanceSubscriptionTarget> targets;
    private final ObjectMapper mapper;

    public BinanceOrderBookProtocol(List<BinanceSubscriptionTarget> targets, ObjectMapper mapper) {
        if (targets.isEmpty() || targets.size() > 128) throw new IllegalArgumentException("Invalid subscription size");
        this.targets = targets.stream().collect(Collectors.toUnmodifiableMap(BinanceSubscriptionTarget::providerSymbol, Function.identity()));
        if (this.targets.keySet().stream().anyMatch(symbol -> !symbol.matches("[A-Z0-9]{1,40}"))) throw new IllegalArgumentException("Invalid provider symbol");
        this.mapper = mapper;
    }

    public static String streamName(String symbol) { return symbol.toLowerCase(Locale.ROOT) + "@depth20@500ms"; }
    public URI uri() {
        return URI.create("wss://fstream.binance.com/public/stream?streams="
                + targets.keySet().stream().sorted().map(BinanceOrderBookProtocol::streamName).collect(Collectors.joining("/")));
    }

    public Optional<OrderBookSnapshot> parse(String message, Instant receivedAt) {
        try {
            if (message.length() > 65_536) return Optional.empty();
            JsonNode envelope = mapper.readTree(message), data = envelope.path("data");
            var target = targets.get(data.path("s").asText());
            if (target == null || !"depthUpdate".equals(data.path("e").asText())
                    || !streamName(target.providerSymbol()).equals(envelope.path("stream").asText())
                    || data.has("st") && (!data.path("st").isIntegralNumber() || !data.path("st").canConvertToInt() || data.path("st").intValue() != 1)) return Optional.empty();
            long first = integer(data.path("U")), last = integer(data.path("u"));
            if (first > last) return Optional.empty();
            var multiplier = BigDecimal.valueOf(target.providerUnitMultiplier());
            var book = new OrderBookSnapshot(target.tradingSymbolId(), levels(data.path("b"), multiplier),
                    levels(data.path("a"), multiplier), last, Instant.ofEpochMilli(integer(data.path("E"))), receivedAt);
            return book.isFreshAt(receivedAt) ? Optional.of(book) : Optional.empty();
        } catch (java.io.IOException | IllegalArgumentException | ArithmeticException | NullPointerException exception) {
            return Optional.empty();
        }
    }

    private static long integer(JsonNode node) {
        if (!node.isIntegralNumber() || !node.canConvertToLong() || node.longValue() <= 0) throw new IllegalArgumentException("Invalid book integer");
        return node.longValue();
    }
    private static List<OrderBookSnapshot.Level> levels(JsonNode array, BigDecimal multiplier) {
        if (!array.isArray() || array.isEmpty() || array.size() > 20) throw new IllegalArgumentException("Invalid book levels");
        var result = new ArrayList<OrderBookSnapshot.Level>();
        for (JsonNode row : array) {
            if (!row.isArray() || row.size() != 2) throw new IllegalArgumentException("Invalid price/quantity pair");
            // One provider contract contains multiplier domain assets: price divides, quantity multiplies.
            result.add(new OrderBookSnapshot.Level(decimal(row.get(0)).divide(multiplier).toPlainString(),
                    decimal(row.get(1)).multiply(multiplier).toPlainString()));
        }
        return result;
    }
    private static BigDecimal decimal(JsonNode node) {
        if (!node.isTextual() || node.textValue().length() > 80 || !node.textValue().matches("[0-9]+(\\.[0-9]+)?")) throw new IllegalArgumentException("Invalid book decimal");
        return new BigDecimal(node.textValue());
    }
}
