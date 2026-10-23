package com.yogimangchi.content.error;

import org.springframework.http.HttpStatus;

public class AuthFailure extends RuntimeException {
    private final String code;
    private final HttpStatus status;
    public AuthFailure(String code,HttpStatus status) { super(code); this.code=code; this.status=status; }
    public String code() { return code; }
    public HttpStatus status() { return status; }
    public static AuthFailure unauthorized() { return new AuthFailure("AUTHENTICATION_REQUIRED",HttpStatus.UNAUTHORIZED); }
}
