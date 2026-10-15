package com.yogimangchi.trading.marketdata.candle;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CandleController {
    private final CandleService candles;
    public CandleController(CandleService candles) { this.candles = candles; }

    @Operation(summary = "Historical Mark Price Candle 조회", description = "인증 없이 ACTIVE 종목의 최근 Mark Price OHLC를 조회한다. openTime 오름차순, 금융 값은 Domain 단위 decimal string. 마지막 봉은 진행 중일 수 있으며 openTime으로 /ws/market 갱신과 같은 UTC bucket을 식별한다. 24h는 하루 봉이며 Trading 실행 가격으로 사용하지 않는다.")
    @ApiResponse(responseCode = "200", description = "최근 Mark Price 봉 목록. 마지막 봉은 진행 중일 수 있음")
    @ApiResponse(responseCode = "400", description = "잘못된 필수 query, interval 또는 limit", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
    @ApiResponse(responseCode = "404", description = "종목 ID 없음", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
    @ApiResponse(responseCode = "409", description = "비활성 종목", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
    @ApiResponse(responseCode = "502", description = "Provider 실패 또는 잘못된 Candle", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
    @ApiResponse(responseCode = "503", description = "Mapping/Cache 불가, 요청 용량 초과 또는 Provider rate limit", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
    @ApiResponse(responseCode = "504", description = "Provider timeout", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
    @GetMapping(value = "/api/v1/market/candles", produces = MediaType.APPLICATION_JSON_VALUE)
    public List<CandleResponse> find(
            @Parameter(description = "Trading Server 내부 종목 ID", schema = @Schema(type = "integer", format = "int64", minimum = "1")) @RequestParam long tradingSymbolId,
            @Parameter(schema = @Schema(allowableValues = {"1m", "3m", "5m", "15m", "30m", "1h", "4h", "12h", "24h"})) @RequestParam String interval,
            @Parameter(schema = @Schema(type = "integer", format = "int32", minimum = "1", maximum = "500", defaultValue = "300")) @RequestParam(defaultValue = "300") int limit) {
        return candles.find(tradingSymbolId, interval, limit);
    }
}
