package com.yogimangchi.trading.order.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(description="Non-binding OPEN estimate using the current server symbol leverage and fresh Mark. Does not reserve money or create an order. Submit the returned quantity/leverage with a new Idempotency-Key; changed price, account state or leverage can invalidate it. All amounts are decimal strings in domain units/USDT.")
public record OrderQuoteResponse(Long tradingSymbolId, String type, String side, int leverage, String quantity,
        String referencePrice, String notional, String margin, String feeRate, String estimatedFee,
        String totalRequired, String availableBalance, Integer balancePercentage,
        Instant priceEventTime, Instant quotedAt) { }
