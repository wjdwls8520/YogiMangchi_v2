package com.yogimangchi.trading.tradingaccount.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "USDT amounts are decimal strings. Valuation-dependent fields are null when any open position price is unavailable.")
public record WalletResponse(String quoteAsset, String balance, String usedMargin, String reservedMargin,
        String realizedPnl, String unrealizedPnl, String equity, String availableBalance, String valuationStatus) { }
