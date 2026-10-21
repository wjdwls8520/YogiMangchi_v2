package com.yogimangchi.content.auth.service;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

final class RefreshTokens {
    private static final SecureRandom RANDOM=new SecureRandom();
    private RefreshTokens() { }
    static String issue() { byte[] bytes=new byte[32]; RANDOM.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    static boolean valid(String token) { return token!=null && token.matches("[A-Za-z0-9_-]{43}"); }
    static String hash(String token) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII))); }
        catch(NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 unavailable",e); }
    }
}
