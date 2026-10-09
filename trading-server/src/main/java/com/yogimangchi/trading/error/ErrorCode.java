package com.yogimangchi.trading.error;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
    ACCOUNT_NOT_FOUND(HttpStatus.NOT_FOUND, "Trading account was not found"),
    TRADING_BUSY(HttpStatus.CONFLICT, "Account is busy; retry the request shortly");

    private final HttpStatus status;
    private final String message;

    ErrorCode(HttpStatus status, String message) { this.status = status; this.message = message; }
    public HttpStatus status() { return status; }
    public String message() { return message; }
}
