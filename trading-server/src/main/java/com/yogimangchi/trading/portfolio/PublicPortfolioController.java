package com.yogimangchi.trading.portfolio;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/trading/portfolios", produces = "application/json")
public class PublicPortfolioController {
    private final PublicPortfolioService portfolios;

    public PublicPortfolioController(PublicPortfolioService portfolios) {
        this.portfolios = portfolios;
    }

    @GetMapping("/members/{memberId:[0-9]+}")
    @Operation(
            summary = "Read public member simulation portfolio",
            description = "Public read-only snapshot of a member's active trading round, wallet valuation, asset/side allocation, open positions, symbol performance, and closed trade win rate. Never creates an account or acquires a financial write lock.")
    public ResponseEntity<PublicMemberPortfolioResponse> getMemberPortfolio(@PathVariable Long memberId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(portfolios.getMemberPortfolio(memberId));
    }
}
