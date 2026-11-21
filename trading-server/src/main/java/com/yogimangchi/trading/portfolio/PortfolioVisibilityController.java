package com.yogimangchi.trading.portfolio;

import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1/trading/account/portfolio-visibility", produces = "application/json")
@SecurityRequirement(name = "memberBearer")
public class PortfolioVisibilityController {
    private final PortfolioVisibilityService preferences;

    public PortfolioVisibilityController(PortfolioVisibilityService preferences) {
        this.preferences = preferences;
    }

    @GetMapping
    @Operation(
            summary = "Read authenticated member's public portfolio visibility preference",
            description = "Requires Content Member Access JWT (ROLE_MEMBER). Defaults to portfolioPublic=true when never explicitly configured.")
    public ResponseEntity<PortfolioVisibilityResponse> get(@AuthenticationPrincipal TradingPrincipal principal) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(preferences.get(principal.memberId()));
    }

    @PutMapping
    @Operation(
            summary = "Update authenticated member's public portfolio visibility preference",
            description = "Requires Content Member Access JWT (ROLE_MEMBER). When false, public viewers receive a sanitized hidden response without balances or positions; owner and admins can still view full details.")
    public ResponseEntity<PortfolioVisibilityResponse> put(
            @AuthenticationPrincipal TradingPrincipal principal,
            @RequestBody PortfolioVisibilityRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(preferences.update(principal.memberId(), request));
    }
}
