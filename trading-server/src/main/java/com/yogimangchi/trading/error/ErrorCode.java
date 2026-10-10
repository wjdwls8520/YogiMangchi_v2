package com.yogimangchi.trading.error;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
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
