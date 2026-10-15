package com.yogimangchi.trading.marketdata.candle;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;

@Schema(description = "USD-M Mark Price 봉. OHLC는 Domain 자산 한 단위당 USDT decimal string. 마지막 진행 중인 봉의 close는 응답 시점까지의 값이다.")
public record CandleResponse(
        @Schema(description = "Provider UTC bucket 시작 시각. 봉의 고유 식별자", example = "2026-10-15T00:00:00Z") Instant openTime,
        @Schema(description = "Provider bucket 종료 경계(마지막 millisecond). 종료 확정을 의미하지 않는다", example = "2026-10-15T00:00:59.999Z") Instant closeTime,
        @Schema(example = "112340.10") String open,
        @Schema(example = "112420.20") String high,
        @Schema(example = "112310.00") String low,
        @Schema(example = "112400.50") String close
) {
    public CandleResponse {
        if (openTime == null || closeTime == null || !closeTime.isAfter(openTime)) throw new IllegalArgumentException("Invalid candle time");
        BigDecimal o = decimal(open), h = decimal(high), l = decimal(low), c = decimal(close);
        if (h.compareTo(o.max(c)) < 0 || l.compareTo(o.min(c)) > 0 || h.compareTo(l) < 0) {
            throw new IllegalArgumentException("Invalid candle OHLC range");
        }
    }

    private static BigDecimal decimal(String value) {
        if (value == null || value.length() > 120 || !value.matches("[0-9]+(\\.[0-9]+)?")) throw new IllegalArgumentException("Invalid candle decimal");
        BigDecimal number = new BigDecimal(value);
        if (number.signum() <= 0) throw new IllegalArgumentException("Candle prices must be positive");
        return number;
    }
}
