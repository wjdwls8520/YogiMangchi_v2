package com.yogimangchi.content.support;

import java.nio.file.*;
import java.security.*;
import java.util.Base64;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

public abstract class TestEnvironment {
    private static final Path TEST_KEY=createDisposableKey();
    private static Path createDisposableKey() {
        try {
            var generator=KeyPairGenerator.getInstance("RSA"); generator.initialize(2048);
            var file=Files.createTempFile("yogimangchi-content-test-key-",".pem"); file.toFile().deleteOnExit();
            Files.writeString(file,"-----BEGIN PRIVATE KEY-----\n"+Base64.getMimeEncoder(64,new byte[]{'\n'}).encodeToString(generator.generateKeyPair().getPrivate().getEncoded())+"\n-----END PRIVATE KEY-----\n");
            return file;
        } catch(Exception failure) { throw new ExceptionInInitializerError(failure); }
    }
    @DynamicPropertySource static void settings(DynamicPropertyRegistry registry) {
        registry.add("content.auth.private-key-path",TEST_KEY::toString);
        // Disposable placeholders only: @ServiceConnection supplies real Testcontainers connection details.
        registry.add("YOGIMANGCHI_DB_USERNAME",() -> "test-only");
        registry.add("YOGIMANGCHI_DB_PASSWORD",() -> "test-only");
        registry.add("CONTENT_DB_URL",() -> "jdbc:postgresql://unused.invalid/test-only");
        registry.add("CONTENT_DB_USERNAME",() -> "test-only");
        registry.add("CONTENT_DB_PASSWORD",() -> "test-only");
        registry.add("CONTENT_FLYWAY_USERNAME",() -> "test-only");
        registry.add("CONTENT_FLYWAY_PASSWORD",() -> "test-only");
        registry.add("YOGIMANGCHI_JWT_ISSUER",() -> "https://content.test");
        registry.add("CONTENT_AUTH_RETURN_URI",() -> "https://app.test/auth/callback");
        registry.add("CONTENT_HTTP_ALLOWED_ORIGINS",() -> "https://app.test");
        registry.add("CONTENT_TRADING_BASE_URL",() -> "http://localhost:9");
        registry.add("CONTENT_WITHDRAWAL_DELIVERY_ENABLED",() -> "false");
    }
}
