package com.yogimangchi.trading.tradingaccount.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(description="Committed Guest retry snapshot. Same request key returns this original snapshot, not a new reset or current wallet valuation. Existing account/credential/expiry and historical Fill totals are preserved.")
public record GuestRetryResponse(Long retryId,Long accountId,String status,String quoteAsset,String balance,
        int canceledOrderCount,int closedPositionCount,Instant resetAt) { }
