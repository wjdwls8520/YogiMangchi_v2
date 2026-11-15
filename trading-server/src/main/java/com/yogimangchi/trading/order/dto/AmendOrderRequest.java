package com.yogimangchi.trading.order.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;

@Schema(description = "Atomically amend quantity and limitPrice of an owned PENDING LIMIT order under AccountLock, re-validating fresh Mark Price, passive limit direction, position/order limits, isolated liquidation risk, and available margin or unreserved close quantity.")
public record AmendOrderRequest(
        @Schema(type = "string", example = "0.02", requiredMode = Schema.RequiredMode.REQUIRED,
                description = "Positive domain quantity, maximum 8 decimals. OPEN orders enforce 10-1000000 USDT notional and integrated Hedge position limits; CLOSE orders enforce unreserved remaining position quantity plus this order's existing reservation.")
        BigDecimal quantity,
        @Schema(type = "string", example = "61000", requiredMode = Schema.RequiredMode.REQUIRED,
                description = "Positive USDT limit price, maximum 18 decimals. OPEN LONG / CLOSE SHORT must be strictly below fresh Mark; OPEN SHORT / CLOSE LONG strictly above fresh Mark (409 MARKETABLE_LIMIT_NOT_ALLOWED otherwise).")
        BigDecimal limitPrice) { }
