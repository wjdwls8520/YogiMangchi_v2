package com.yogimangchi.trading.binance.ticker;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.marketdata.ticker.MarketTicker;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

public final class BinanceTickerProtocol {
    private final Map<String, BinanceSubscriptionTarget> targets;
    private final ObjectMapper mapper;

    public BinanceTickerProtocol(List<BinanceSubscriptionTarget> activeTargets, ObjectMapper mapper) {
        this.targets = activeTargets.stream().collect(Collectors.toUnmodifiableMap(
                BinanceSubscriptionTarget::providerSymbol, Function.identity()));
        this.mapper = mapper;
    }

    public static String streamName(String providerSymbol) {
        return providerSymbol.toLowerCase(Locale.ROOT) + "@ticker";
    }

    public Optional<MarketTicker> parse(String message, Instant receivedAt) {
        try {
            JsonNode envelope = mapper.readTree(message);
            if (envelope == null) return Optional.empty();
            JsonNode data = envelope.path("data");
            var target = targets.get(data.path("s").asText(""));
            if (target == null || !"24hrTicker".equals(data.path("e").asText())
                    || !streamName(target.providerSymbol()).equals(envelope.path("stream").asText())
                    || !data.path("E").isIntegralNumber() || !data.path("E").canConvertToLong()
                    || data.path("E").longValue() <= 0
                    || (data.has("st") && (!data.path("st").isIntegralNumber()
                        || !data.path("st").canConvertToInt() || data.path("st").intValue() != 1))) {
                return Optional.empty();
            }
            BigDecimal multiplier = BigDecimal.valueOf(target.providerUnitMultiplier());
            return Optional.of(new MarketTicker(target.tradingSymbolId(), decimal(data.path("P"), true),
                    decimal(data.path("h"), false).divide(multiplier),
                    decimal(data.path("l"), false).divide(multiplier), decimal(data.path("q"), false),
                    Instant.ofEpochMilli(data.path("E").longValue()), receivedAt));
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            return Optional.empty();
        }
    }

    private static BigDecimal decimal(JsonNode node, boolean signed) {
        if (!node.isTextual() || node.textValue().length() > 80
                || !node.textValue().matches((signed ? "-?" : "") + "[0-9]+(\\.[0-9]+)?")) {
            throw new IllegalArgumentException("Invalid ticker decimal");
        }
        return new BigDecimal(node.textValue());
    }
}
