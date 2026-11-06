package com.yogimangchi.trading.commandresult;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.JsonNode;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(additionalProperties=Schema.AdditionalPropertiesValue.FALSE,description="Read-only lookup of an owned durable command. Supply the original canonical request; no accountId, token or client-computed hash. Existing keys have no separate result-retention TTL; credential expiry remains independent.")
public record CommandResultRequest(
        @Schema(requiredMode=Schema.RequiredMode.REQUIRED) Operation operation,
        @Schema(requiredMode=Schema.RequiredMode.REQUIRED,minLength=8,maxLength=100) String idempotencyKey,
        @Schema(description="OPEN: original CreateOrderRequest. CLOSE: positionId and optional quantity. LIMIT_CLOSE: positionId, limitPrice and optional quantity. STOP_LOSS_PUT: positionId, stopPrice, expectedVersion. STOP_LOSS_DELETE: positionId, expectedVersion. MEMBER_RESTART/GUEST_RETRY: omit or use {}. Financial decimals are strings; unknown fields rejected.") JsonNode request) {
    @JsonAnySetter
    public void rejectUnknownField(String field,JsonNode ignored){
        throw new IllegalArgumentException("Unknown command result query field");
    }
    public enum Operation { OPEN,CLOSE,LIMIT_CLOSE,STOP_LOSS_PUT,STOP_LOSS_DELETE,MEMBER_RESTART,GUEST_RETRY }
}
