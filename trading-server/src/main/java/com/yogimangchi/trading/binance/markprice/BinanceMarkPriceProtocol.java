package com.yogimangchi.trading.binance.markprice;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

final class BinanceMarkPriceProtocol {

    private final Map<String, BinanceSubscriptionTarget> targets = new LinkedHashMap<>();
    private final ObjectMapper mapper;

    BinanceMarkPriceProtocol(List<BinanceSubscriptionTarget> subscriptions, ObjectMapper mapper) {
        if (subscriptions.isEmpty() || subscriptions.size() > 1024) {
            throw new IllegalArgumentException("Combined stream requires 1..1024 targets");
        }
        this.mapper = mapper;
        for (var target : subscriptions) {
            if (target.tradingSymbolId() == null || target.providerSymbol() == null
                    || !target.providerSymbol().matches("[A-Z0-9_]+")
                    || targets.putIfAbsent(target.providerSymbol(), target) != null) {
                throw new IllegalArgumentException("Invalid or duplicate subscription target");
            }
        }
    }

    static String streamName(String providerSymbol) {
        return providerSymbol.toLowerCase(Locale.ROOT) + "@markPrice@1s";
    }

    URI uri() {
        return URI.create("wss://fstream.binance.com/market/stream?streams="
                + targets.keySet().stream().map(BinanceMarkPriceProtocol::streamName)
                .collect(Collectors.joining("/")));
    }

    int size() {
        return targets.size();
    }

    Optional<BinanceMarkPriceEvent> parse(String message, Instant receivedAt) {
        try {
            JsonNode envelope = mapper.readTree(message);
            if (envelope == null) {
                return Optional.empty();
            }
            JsonNode data = envelope.path("data");
            String providerSymbol = data.path("s").asText("");
            var target = targets.get(providerSymbol);
            if (target == null || !"markPriceUpdate".equals(data.path("e").asText())
                    || !streamName(providerSymbol).equals(envelope.path("stream").asText())
                    || !data.path("p").isTextual() || !data.path("E").isIntegralNumber()
                    || !data.path("E").canConvertToLong() || data.path("E").longValue() <= 0
                    || (data.has("st") && (!data.path("st").isIntegralNumber()
                    || !data.path("st").canConvertToInt()
                    || data.path("st").intValue() != 1))) {
                return Optional.empty();
            }
            String decimal = data.path("p").textValue();
            if (decimal.length() > 80 || !decimal.matches("[0-9]+(\\.[0-9]+)?")) {
                return Optional.empty();
            }
            BigDecimal price = new BigDecimal(decimal);
            if (price.signum() <= 0) {
                return Optional.empty();
            }
            return Optional.of(new BinanceMarkPriceEvent(target.tradingSymbolId(), target.symbol(),
                    providerSymbol, price, price.divide(BigDecimal.valueOf(target.providerUnitMultiplier())),
                    Instant.ofEpochMilli(data.path("E").longValue()), receivedAt));
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            return Optional.empty();
        }
    }
}
