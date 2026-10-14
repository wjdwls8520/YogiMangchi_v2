package com.yogimangchi.trading.marketdata.summary;

import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@JsonInclude(JsonInclude.Include.ALWAYS)
@Schema(description = "ACTIVE 종목의 표시용 시세. 누락/만료한 값은 null이며 주문 실행 가격으로 사용하지 않는다.")
public record MarketSummaryResponse(
        @Schema(description = "Provider 이름과 무관한 내부 종목 ID", example = "1") long tradingSymbolId,
        @Schema(example = "BTC") String symbol,
        @Schema(example = "USDT") String quoteAsset,
        @Schema(description = "Domain 자산 한 단위당 USDT Mark Price, freshness 5초", nullable = true, example = "114230.10000000") String markPrice,
        @Schema(description = "이동하는 24시간 가격 변동률 (%), freshness 10초", nullable = true, example = "2.37") String changePercent24h,
        @Schema(description = "24h High, Domain 자산 한 단위당 USDT", nullable = true, example = "115100.00") String highPrice24h,
        @Schema(description = "24h Low, Domain 자산 한 단위당 USDT", nullable = true, example = "109800.00") String lowPrice24h,
        @Schema(description = "24h Quote Asset 거래대금 (USDT), Provider 계약 배수로 나누지 않음", nullable = true, example = "1234567890.12") String quoteVolume24h,
        @Schema(description = "FRESH: Mark/통계 모두 최신. STALE: 읽힌 데이터가 만료/시각 범위 위반. UNAVAILABLE: 일부 누락 또는 Redis 실패.") MarketSummaryStatus status,
        @Schema(description = "반환한 유효 데이터 중 가장 오래된 Provider eventTime. 유효 데이터가 없으면 null. ISO-8601 UTC.", nullable = true) Instant updatedAt
) {
    public enum MarketSummaryStatus { FRESH, STALE, UNAVAILABLE }
}
