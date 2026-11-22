package com.yogimangchi.content.error;

import org.springframework.http.HttpStatus;

public class AuthFailure extends RuntimeException {
    private final String code;
    private final HttpStatus status;
    private final String detail;

    public AuthFailure(String code, HttpStatus status) {
        this(code, status, null);
    }

    public AuthFailure(String code, HttpStatus status, String detail) {
        super(code);
        this.code = code;
        this.status = status;
        this.detail = (detail == null || detail.isBlank()) ? null : detail;
    }

    public String code() {
        return code;
    }

    public HttpStatus status() {
        return status;
    }

    public String detail() {
        return detail;
    }

    public static AuthFailure unauthorized() {
        return new AuthFailure("AUTHENTICATION_REQUIRED", HttpStatus.UNAUTHORIZED);
    }
}
