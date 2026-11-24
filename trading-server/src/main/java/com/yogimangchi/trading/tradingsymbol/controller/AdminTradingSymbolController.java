package com.yogimangchi.trading.tradingsymbol.controller;

import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import com.yogimangchi.trading.tradingsymbol.dto.AdminSymbolStatusRequest;
import com.yogimangchi.trading.tradingsymbol.dto.AdminTradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.service.TradingSymbolService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/trading/admin/symbols", produces = MediaType.APPLICATION_JSON_VALUE)
@SecurityRequirement(name = "memberBearer")
@Tag(name = "Admin Symbols", description = "Admin trading symbol listing and emergency halt/resume control")
public class AdminTradingSymbolController {
    private final TradingSymbolService service;

    public AdminTradingSymbolController(TradingSymbolService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(
            summary = "List all trading symbols including HALTED and INACTIVE",
            description = "Admin only (ROLE_ADMIN). Returns all trading symbols ordered by symbol ascending.")
    public ResponseEntity<List<AdminTradingSymbolResponse>> listAll() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.findAllForAdmin());
    }

    @PatchMapping("/{symbolId:[0-9]+}/status")
    @Operation(
            summary = "Emergency halt or resume a trading symbol",
            description = "Admin only (ROLE_ADMIN). Body: {\"status\": \"ACTIVE\" | \"HALTED\"}. Halted symbols hide from public /api/v1/symbols and reject new opens, amends, quotes, leverage changes, and SL/TP arming while preserving close/cancel/liquidation safety.")
    public ResponseEntity<AdminTradingSymbolResponse> updateStatus(
            @AuthenticationPrincipal TradingPrincipal principal,
            @PathVariable Long symbolId,
            @RequestBody(required = false) AdminSymbolStatusRequest request) {
        Long adminMemberId = principal != null ? principal.memberId() : null;
        String targetStatus = request != null ? request.status() : null;
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.updateAdminStatus(symbolId, targetStatus, adminMemberId));
    }
}
