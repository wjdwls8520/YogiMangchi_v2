package com.yogimangchi.trading.binance.candle;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.marketdata.candle.CandleInterval;
import com.yogimangchi.trading.marketdata.candle.CandleResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;

final class BinanceCandleParser {
    static final int MAX_CANDLES = 500;
    private final ObjectMapper mapper;
    BinanceCandleParser(ObjectMapper mapper) { this.mapper = mapper; }

    List<CandleResponse> parse(String body, BinanceSubscriptionTarget target, CandleInterval interval) {
        try {
            if (body.length() > 1_000_000) throw new IllegalArgumentException("Oversized candle response");
            JsonNode rows = mapper.readTree(body);
            if (rows == null || !rows.isArray() || rows.size() > MAX_CANDLES) throw new IllegalArgumentException("Invalid candle array");
            var result = new ArrayList<CandleResponse>(rows.size());
            var times = new HashSet<Long>();
            BigDecimal multiplier = BigDecimal.valueOf(target.providerUnitMultiplier());
            for (JsonNode row : rows) {
                if (!row.isArray() || row.size() != 12) throw new IllegalArgumentException("Invalid candle tuple");
                long open = timestamp(row.get(0)), close = timestamp(row.get(6));
                if (open % interval.millis() != 0 || close != Math.addExact(open, interval.millis() - 1) || !times.add(open)) {
                    throw new IllegalArgumentException("Invalid or duplicate candle bucket");
                }
                result.add(new CandleResponse(Instant.ofEpochMilli(open), Instant.ofEpochMilli(close),
                        price(row.get(1), multiplier), price(row.get(2), multiplier),
                        price(row.get(3), multiplier), price(row.get(4), multiplier)));
            }
            result.sort(Comparator.comparing(CandleResponse::openTime));
            return List.copyOf(result);
        } catch (java.io.IOException | IllegalArgumentException | ArithmeticException exception) {
            throw new BusinessException(ErrorCode.CANDLE_PROVIDER_FAILURE);
        }
    }

    private static long timestamp(JsonNode node) {
        if (!node.isIntegralNumber() || !node.canConvertToLong() || node.longValue() <= 0) throw new IllegalArgumentException("Invalid candle timestamp");
        return node.longValue();
    }
    private static String price(JsonNode node, BigDecimal multiplier) {
        if (!node.isTextual() || node.textValue().length() > 80 || !node.textValue().matches("[0-9]+(\\.[0-9]+)?")) {
            throw new IllegalArgumentException("Invalid provider price");
        }
        return new BigDecimal(node.textValue()).divide(multiplier).toPlainString();
    }
}
