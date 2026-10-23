package com.yogimangchi.trading.execution.trigger;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.MarkPriceTimePolicy;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class TradingEngineStatusController {
    private final TradingEngineGate gate;
    private final LatestPriceStore prices;
    public TradingEngineStatusController(TradingEngineGate gate, LatestPriceStore prices) { this.gate=gate; this.prices=prices; }
    public record StatusResponse(String status,
            @Schema(description="Worst recent Mark clock observation on this receiving node; diagnostic only, independent of READY/RECOVERING")
            MarkPriceTimePolicy.ClockStatus marketClockStatus,
            @Schema(description="Signed provider eventTime minus server receivedAt in milliseconds for that observation; null when no recent data is available", nullable=true)
            Long clockSkewMs) { }
    @GetMapping("/api/v1/trading/status")
    @Operation(summary="Read trigger infrastructure status",
            description="READY means the worker is running with healthy Redis. Each order still requires fresh prices and a processed price vector; RECOVERING blocks new exposure and manual closes, but not cancellations.")
    public StatusResponse status() {
        var clock = prices.marketClockSnapshot();
        return new StatusResponse(gate.status(), clock.status(), clock.skewMs());
    }
}
