package com.yogimangchi.trading.execution.trigger;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class TradingEngineStatusController {
    private final TradingEngineGate gate;
    public TradingEngineStatusController(TradingEngineGate gate) { this.gate=gate; }
    public record StatusResponse(String status) { }
    @GetMapping("/api/v1/trading/status")
    @Operation(summary="Read trigger infrastructure status",
            description="READY means the worker is running with healthy Redis. Each order still requires fresh prices and a processed price vector; RECOVERING blocks new exposure and manual closes, but not cancellations.")
    public StatusResponse status() { return new StatusResponse(gate.status()); }
}
