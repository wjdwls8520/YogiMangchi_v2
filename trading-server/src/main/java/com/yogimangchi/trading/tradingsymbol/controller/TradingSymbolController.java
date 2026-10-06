package com.yogimangchi.trading.tradingsymbol.controller;

import com.yogimangchi.trading.tradingsymbol.dto.TradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.service.TradingSymbolService;
import io.swagger.v3.oas.annotations.Operation;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/symbols")
public class TradingSymbolController {

    private final TradingSymbolService service;

    public TradingSymbolController(TradingSymbolService service) {
        this.service = service;
    }

    @Operation(summary = "거래 가능한 종목 목록", description = "인증 없이 ACTIVE 종목을 Symbol 오름차순으로 조회합니다. 종목이 없으면 빈 배열을 반환합니다.")
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public List<TradingSymbolResponse> findActiveSymbols() {
        return service.findActiveSymbols();
    }
}
