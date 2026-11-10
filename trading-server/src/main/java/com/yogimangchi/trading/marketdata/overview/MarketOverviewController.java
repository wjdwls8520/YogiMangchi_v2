package com.yogimangchi.trading.marketdata.overview;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MarketOverviewController {

    private final MarketOverviewService service;

    public MarketOverviewController(MarketOverviewService service) {
        this.service = service;
    }

    @Operation(
            summary = "글로벌 마켓 요약 지표 및 실시간 USD/KRW(YD) 환율",
            description = "인증 없이 공유 Redis에 수집된 BTC 도미넌스, 김치프리미엄, 24h 선물 미결제약정, 공포·탐욕 지수, 실시간 USD/KRW(YD) 환율 및 14일 추이를 조회한다. Redis의 실시간 BTC Mark/Ticker를 결합해 김치프리미엄·미결제약정을 즉시 반영하며, Redis 장애 시에도 200과 UNAVAILABLE 상태로 응답한다."
    )
    @GetMapping(value = "/api/v1/market/overview", produces = MediaType.APPLICATION_JSON_VALUE)
    public MarketOverviewResponse overview() {
        return service.getOverview();
    }
}
