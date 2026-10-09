package com.yogimangchi.trading.tradingaccount.dto;

import java.time.Instant;
import java.util.List;

public record AccountSummaryResponse(Long accountId, String status, Instant createdAt, WalletResponse wallet,
                                     List<PositionResponse> positions, Instant valuedAt) { }
