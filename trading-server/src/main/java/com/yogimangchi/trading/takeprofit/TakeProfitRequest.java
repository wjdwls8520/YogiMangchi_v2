package com.yogimangchi.trading.takeprofit;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;

public record TakeProfitRequest(
        @Schema(type = "string", requiredMode = Schema.RequiredMode.REQUIRED, example = "1150",
                description = "Positive domain Mark price, at most 18 decimals/20 integer digits. LONG strictly above current fresh Mark, SHORT strictly below it.")
        BigDecimal takeProfitPrice,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                description = "Required latest takeProfit.version, initially 0. A stale version returns 409 TAKE_PROFIT_VERSION_CONFLICT.",
                minimum = "0")
        Long expectedVersion) { }
