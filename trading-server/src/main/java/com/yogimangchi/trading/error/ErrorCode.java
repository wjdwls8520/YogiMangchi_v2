package com.yogimangchi.trading.error;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
    MARGIN_MIGRATION_REQUIRED(HttpStatus.CONFLICT, "Legacy account is held pending safe isolated conversion or explicit review"),
    INVALID_LEVERAGE(HttpStatus.BAD_REQUEST, "Leverage must be an integer between 1 and 100"),
    LEVERAGE_MISMATCH(HttpStatus.CONFLICT, "OPEN leverage must match the account's current symbol setting; change it with PUT leverage first"),
    MARKETABLE_LIMIT_NOT_ALLOWED(HttpStatus.CONFLICT, "Limit BUY must be below the fresh Mark Price and limit SELL above it; equality is not allowed"),
    INVALID_CANDLE_CURSOR(HttpStatus.BAD_REQUEST, "before must be an ISO-8601 timestamp after the Unix epoch, not in the future, with at most millisecond precision"),
    INVALID_CANDLE_REQUEST(HttpStatus.BAD_REQUEST, "Candle request requires a positive tradingSymbolId, a supported interval and limit 1-500"),
    TRADING_SYMBOL_NOT_FOUND(HttpStatus.NOT_FOUND, "Trading symbol was not found"),
    CANDLE_MAPPING_INVALID(HttpStatus.SERVICE_UNAVAILABLE, "Historical candles are unavailable for this symbol mapping"),
    CANDLE_PROVIDER_FAILURE(HttpStatus.BAD_GATEWAY, "Historical candle provider returned an invalid response or failed"),
    CANDLE_PROVIDER_TIMEOUT(HttpStatus.GATEWAY_TIMEOUT, "Historical candle provider timed out"),
    CANDLE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "Historical candles are temporarily unavailable; retry later"),
    CLOSE_QUANTITY_EXCEEDED(HttpStatus.CONFLICT, "Close quantity exceeds the unreserved remaining position quantity"),
    ENGINE_RECOVERING(HttpStatus.SERVICE_UNAVAILABLE, "Price trigger processing is recovering; retry shortly"),
    ORDER_NOT_FOUND(HttpStatus.NOT_FOUND, "Order was not found"),
    ORDER_NOT_PENDING(HttpStatus.CONFLICT, "Order is no longer pending"),
    PENDING_LIMIT_REACHED(HttpStatus.CONFLICT, "Maximum pending orders reached"),
    INVALID_ORDER(HttpStatus.BAD_REQUEST, "Invalid order or supported quantity/notional/leverage exceeded"),
    INVALID_IDEMPOTENCY_KEY(HttpStatus.BAD_REQUEST, "Idempotency-Key must be 8-100 letters, digits, underscores or hyphens"),
    IDEMPOTENCY_CONFLICT(HttpStatus.CONFLICT, "This key was used for a different request"),
    PRICE_NOT_FRESH(HttpStatus.SERVICE_UNAVAILABLE, "Fresh market prices are required for all affected positions"),
    INSUFFICIENT_MARGIN(HttpStatus.CONFLICT, "Insufficient available margin or settlement cash"),
    ACCOUNT_AT_RISK(HttpStatus.CONFLICT, "Account requires liquidation risk processing"),
    ACCOUNT_NOT_ACTIVE(HttpStatus.CONFLICT, "Account cannot open or manually close positions"),
    POSITION_NOT_FOUND(HttpStatus.NOT_FOUND, "Position was not found"),
    POSITION_NOT_OPEN(HttpStatus.CONFLICT, "Position is already closed"),
    SYMBOL_NOT_AVAILABLE(HttpStatus.CONFLICT, "Trading symbol is not ACTIVE"),
    POSITION_LIMIT_REACHED(HttpStatus.CONFLICT, "Maximum open positions reached"),
    ACCOUNT_NOT_FOUND(HttpStatus.NOT_FOUND, "Trading account was not found"),
    TRADING_BUSY(HttpStatus.CONFLICT, "Account is busy; retry the request shortly");

    private final HttpStatus status;
    private final String message;

    ErrorCode(HttpStatus status, String message) { this.status = status; this.message = message; }
    public HttpStatus status() { return status; }
    public String message() { return message; }
}
