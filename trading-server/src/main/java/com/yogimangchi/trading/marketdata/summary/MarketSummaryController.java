package com.yogimangchi.trading.marketdata.summary;

import io.swagger.v3.oas.annotations.Operation;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MarketSummaryController {
    private final MarketSummaryService service;
    public MarketSummaryController(MarketSummaryService service) { this.service = service; }

    @Operation(summary = "거래 가능 종목의 Market Summary", description = "인증 없이 모든 ACTIVE 종목을 조회한다. 공유 Redis의 Mark와 24h 통계를 결합한다. 일부 데이터 누락/만료 또는 Redis 장애 시에도 200으로 종목별 상태와 null을 반환한다. 금융 값은 decimal string이다.")
    @GetMapping(value = "/api/v1/market/tickers", produces = MediaType.APPLICATION_JSON_VALUE)
    public List<MarketSummaryResponse> tickers() { return service.findActiveTickers(); }
}
