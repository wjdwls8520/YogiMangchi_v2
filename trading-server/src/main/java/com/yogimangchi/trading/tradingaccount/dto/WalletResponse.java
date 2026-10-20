package com.yogimangchi.trading.tradingaccount.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "USDT decimal strings. balance includes allocated position collateral; free cash is balance-usedMargin-reservedMargin, independent of unrealized PnL. realizedPnl is gross; feesPaid and settlementAdjustment reconcile the net cash change. Valuation fields are unavailable if required marks are missing. Legacy conversion holds return null availableBalance.")
public record WalletResponse(String quoteAsset, String balance, String usedMargin, String reservedMargin,
        String realizedPnl, String unrealizedPnl, String equity, String availableBalance, String valuationStatus,
        String feesPaid, @Schema(description="Cumulative platform-funded isolated shortfall; not user income or an external deposit") String settlementAdjustment,
        @Schema(allowableValues={"ISOLATED","LEGACY_CROSS"}) String marginMode,
        @Schema(description="Non-COMPLETE accounts cannot submit financial trades", allowableValues={"COMPLETE","PENDING","REVIEW_REQUIRED"}) String marginTransitionStatus) { }
