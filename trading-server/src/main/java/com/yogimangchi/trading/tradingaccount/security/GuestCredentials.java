package com.yogimangchi.trading.tradingaccount.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/** Random possession credential, not a user identity or a replacement for future Content JWT authentication. */
public final class GuestCredentials {
    private static final SecureRandom RANDOM = new SecureRandom();
    private GuestCredentials() { }

    public static String issue() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return "guest_" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static boolean isValidFormat(String token) {
        return token != null && token.matches("guest_[A-Za-z0-9_-]{43}");
    }

    public static String hash(String token) {
        if (!isValidFormat(token)) throw new IllegalArgumentException("Invalid guest credential format");
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Required SHA-256 unavailable", exception);
        }
    }
}
