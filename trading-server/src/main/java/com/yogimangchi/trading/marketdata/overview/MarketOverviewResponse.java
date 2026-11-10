package com.yogimangchi.trading.marketdata.overview;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.yogimangchi.trading.marketdata.summary.MarketSummaryResponse.MarketSummaryStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;

@JsonInclude(JsonInclude.Include.ALWAYS)
@Schema(description = "공유 Redis에서 조회한 글로벌 마켓 요약 지표 및 실시간 USD/KRW(YD) 환율 스냅샷. 표시 전용이며 체결 가격으로 사용하지 않는다.")
public record MarketOverviewResponse(
        @Schema(description = "BTC 시가총액 도미넌스 (%)", example = "59.7") String btcDominancePercent,
        @Schema(description = "24h BTC 도미넌스 변동폭 (%p)", example = "1.85") String btcDominanceChange24h,
        @Schema(description = "업비트 KRW-BTC 대비 바이낸스 BTCUSDT * USD/KRW 실시간 김치프리미엄 (%)", example = "1.26") String kimchiPremiumPercent,
        @Schema(description = "글로벌 선물 24h 미결제약정 규모 (십억 USD)", example = "30.5") String openInterestBillionsUsd,
        @Schema(description = "공포·탐욕 지수 (0~100)", example = "32") int fearGreedValue,
        @Schema(description = "공포·탐욕 지수 한글 분류", example = "공포") String fearGreedLabelKr,
        @Schema(description = "선물 테이커 매수 우위 비중 (%)", example = "54") int futuresBullPct,
        @Schema(description = "선물 테이커 매도 우위 비중 (%)", example = "46") int futuresBearPct,
        @Schema(description = "BTC 24h 가격 변동률 (%)", example = "-2.33") String btcChange24h,
        @Schema(description = "실시간 USD/KRW (1 YD) 환율", example = "1343.92") String usdKrwRate,
        @Schema(description = "전일 대비 USD/KRW 변동액 (원)", example = "3.64") String usdKrwChangeAmount,
        @Schema(description = "전일 대비 USD/KRW 변동률 (%)", example = "0.27") String usdKrwChangePct,
        @Schema(description = "최근 14일 USD/KRW 환율 추이 (마지막 원소는 현재 실시간 환율)") List<String> usdKrwHistory,
        @Schema(description = "FRESH: 30초 이내 갱신. STALE: 30초 초과. UNAVAILABLE: Redis 미적재 또는 장애 시 안전 기본값.") MarketSummaryStatus status,
        @Schema(description = "Redis 스냅샷 갱신 시각 (ISO-8601 UTC)", nullable = true) Instant updatedAt
) {
}
