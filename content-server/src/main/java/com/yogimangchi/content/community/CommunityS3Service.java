package com.yogimangchi.content.community;

import com.yogimangchi.content.error.AuthFailure;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetUrlRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

@Service
public class CommunityS3Service {
    private static final Logger log = LoggerFactory.getLogger(CommunityS3Service.class);
    public static final int MAX_POST_IMAGE_COUNT = 10;
    public static final long MAX_SINGLE_FILE_SIZE = 5L * 1024 * 1024;
    public static final long MAX_GIF_FILE_SIZE = 3L * 1024 * 1024;
    public static final long MAX_TOTAL_FILE_SIZE = 20L * 1024 * 1024;
    public static final String POST_PREFIX = "community/post";
    public static final String PROFILE_PREFIX = "member/profile";

    private static final Set<String> ALLOWED_IMAGE_TYPES = Set.of(
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
            "image/gif"
    );
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            "jpg",
            "jpeg",
            "png",
            "webp",
            "gif"
    );
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyyMMdd");
    private static final byte[] PLACEHOLDER_SVG_BYTES = (
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"360\" viewBox=\"0 0 640 360\">"
                    + "<rect width=\"640\" height=\"360\" rx=\"20\" fill=\"#F8FAFC\"/>"
                    + "<rect x=\"16\" y=\"16\" width=\"608\" height=\"328\" rx=\"14\" fill=\"#FFFFFF\" stroke=\"#E2E8F0\" stroke-width=\"2\"/>"
                    + "<circle cx=\"320\" cy=\"150\" r=\"28\" fill=\"#EFF6FF\"/>"
                    + "<path d=\"M308 156l8-10 7 8 10-13 11 15H308z\" fill=\"#2563EB\"/>"
                    + "<text x=\"320\" y=\"212\" text-anchor=\"middle\" font-family=\"sans-serif\" font-size=\"15\" font-weight=\"700\" fill=\"#1E293B\">로컬 안전 미리보기 이미지</text>"
                    + "<text x=\"320\" y=\"238\" text-anchor=\"middle\" font-family=\"sans-serif\" font-size=\"12\" fill=\"#64748B\">외부 클라우드(S3) 호출 차단 · 로컬 무과금 실행 모드</text>"
                    + "</svg>"
    ).getBytes(StandardCharsets.UTF_8);

    public record UploadResult(
            String key,
            String url,
            String originalName,
            long size,
            String contentType
    ) { }

    public record LocalMediaPayload(
            byte[] bytes,
            String contentType
    ) { }

    private record PendingCleanupRow(
            long id,
            String s3Key,
            int attemptCount,
            int maxAttempts
    ) { }

    private final String bucket;
    private final String region;
    private final String normalizedPublicBaseUrl;
    private final Path localStorageRoot;
    private final S3Client s3Client;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate requiresNewTx;
    private final Set<String> simulatedStore = ConcurrentHashMap.newKeySet();
    private final Map<String, LocalMediaPayload> localMemoryStore = new ConcurrentHashMap<>();
    private final Set<String> simulatedDeleteFailureKeys = ConcurrentHashMap.newKeySet();
    private final AtomicInteger realS3PutCounter = new AtomicInteger();
    private final AtomicInteger realS3DeleteCounter = new AtomicInteger();

    public CommunityS3Service(String bucket, String accessKey, String secretKey, String region) {
        this(true, null, bucket, accessKey, secretKey, region, null, null);
    }

    public CommunityS3Service(
            String bucket,
            String accessKey,
            String secretKey,
            String region,
            JdbcTemplate jdbc,
            PlatformTransactionManager txManager) {
        this(true, null, bucket, accessKey, secretKey, region, jdbc, txManager);
    }

    @Autowired
    public CommunityS3Service(
            @Value("${content.s3.enabled:false}") boolean s3Enabled,
            @Value("${content.s3.public-base-url:http://localhost:8080}") String publicBaseUrl,
            @Value("${content.s3.bucket:}") String bucket,
            @Value("${content.s3.access-key:}") String accessKey,
            @Value("${content.s3.secret-key:}") String secretKey,
            @Value("${content.s3.region:ap-northeast-2}") String region,
            JdbcTemplate jdbc,
            PlatformTransactionManager txManager) {
        this.bucket = bucket == null ? "" : bucket.strip();
        this.region = (region == null || region.isBlank()) ? "ap-northeast-2" : region.strip();
        String trimmedBaseUrl = publicBaseUrl == null ? "" : publicBaseUrl.strip().replaceAll("/+$", "");
        this.normalizedPublicBaseUrl = trimmedBaseUrl.isEmpty() ? null : trimmedBaseUrl;
        this.localStorageRoot = this.normalizedPublicBaseUrl != null
                ? Path.of(".gradle", "local-runtime", "uploads").toAbsolutePath().normalize()
                : null;
        this.jdbc = jdbc;
        if (txManager != null) {
            TransactionTemplate tpl = new TransactionTemplate(txManager);
            tpl.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            tpl.setTimeout(3);
            this.requiresNewTx = tpl;
        } else {
            this.requiresNewTx = null;
        }
        String trimmedAccess = accessKey == null ? "" : accessKey.strip();
        String trimmedSecret = secretKey == null ? "" : secretKey.strip();
        if (s3Enabled && !this.bucket.isEmpty() && !trimmedAccess.isEmpty() && !trimmedSecret.isEmpty()) {
            this.s3Client = S3Client.builder()
                    .region(Region.of(this.region))
                    .credentialsProvider(StaticCredentialsProvider.create(
                            AwsBasicCredentials.create(trimmedAccess, trimmedSecret)))
                    .build();
        } else {
            this.s3Client = null;
        }
    }

    @PreDestroy
    void closeClient() {
        if (s3Client != null) {
            s3Client.close();
        }
    }

    public int realS3PutCount() {
        return realS3PutCounter.get();
    }

    public int realS3DeleteCount() {
        return realS3DeleteCounter.get();
    }

    public void failSimulatedDeleteForKey(String key) {
        if (key != null && !key.isBlank()) {
            simulatedDeleteFailureKeys.add(key);
        }
    }

    public void clearSimulatedDeleteFailures() {
        simulatedDeleteFailureKeys.clear();
    }

    public String sanitizeProfileImageUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            return null;
        }
        if (s3Client == null && isExternalAwsUrl(rawUrl)) {
            return null;
        }
        return rawUrl;
    }

    public String sanitizePostFileUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            return rawUrl;
        }
        if (s3Client == null && isExternalAwsUrl(rawUrl)) {
            String base = normalizedPublicBaseUrl != null ? normalizedPublicBaseUrl : "http://localhost:8080";
            return base + "/api/v1/community/local-media/placeholder.svg";
        }
        return rawUrl;
    }

    private static boolean isExternalAwsUrl(String rawUrl) {
        String lower = rawUrl.strip().toLowerCase(Locale.ROOT);
        return lower.contains("amazonaws.com") && !lower.contains("/yogimangchi-local/");
    }

    public LocalMediaPayload readLocalMedia(String rawKey) {
        if (rawKey == null || rawKey.isBlank()) {
            return null;
        }
        String key = rawKey.strip();
        while (key.startsWith("/")) {
            key = key.substring(1);
        }
        if ("placeholder.svg".equals(key)) {
            return new LocalMediaPayload(PLACEHOLDER_SVG_BYTES, "image/svg+xml");
        }
        if (key.contains("..") || key.indexOf('\\') >= 0 || key.indexOf('\0') >= 0) {
            return null;
        }
        if (!key.startsWith(PROFILE_PREFIX + "/") && !key.startsWith(POST_PREFIX + "/")) {
            return null;
        }
        LocalMediaPayload cached = localMemoryStore.get(key);
        if (cached != null) {
            return cached;
        }
        if (localStorageRoot != null) {
            Path target = localStorageRoot.resolve(key).normalize();
            if (target.startsWith(localStorageRoot) && Files.isRegularFile(target)) {
                try {
                    byte[] bytes = Files.readAllBytes(target);
                    LocalMediaPayload loaded = new LocalMediaPayload(bytes, contentTypeFromKey(key));
                    localMemoryStore.put(key, loaded);
                    return loaded;
                } catch (IOException ignored) {
                    return null;
                }
            }
        }
        return null;
    }

    private static String contentTypeFromKey(String key) {
        String lower = key.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        return "image/png";
    }

    public UploadResult validateAndUploadProfileImage(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw invalidRequest();
        }
        validateImageFile(file);
        UploadResult uploaded = uploadSingleImage(file, PROFILE_PREFIX);
        registerRollbackCleanup(List.of(uploaded.key()));
        return uploaded;
    }

    public List<UploadResult> validateAndUploadPostImages(List<MultipartFile> files, int existingRemainingCount) {
        if (files == null || files.isEmpty()) {
            return List.of();
        }
        List<MultipartFile> nonEmpty = files.stream()
                .filter(f -> f != null && !f.isEmpty())
                .toList();
        if (nonEmpty.isEmpty()) {
            return List.of();
        }
        if (existingRemainingCount + nonEmpty.size() > MAX_POST_IMAGE_COUNT) {
            throw badRequest("FILE_COUNT_EXCEEDED");
        }

        long totalSize = 0L;
        for (MultipartFile file : nonEmpty) {
            validateImageFile(file);
            totalSize += file.getSize();
            if (totalSize > MAX_TOTAL_FILE_SIZE) {
                throw badRequest("FILE_TOTAL_SIZE_EXCEEDED");
            }
        }

        List<UploadResult> uploaded = new ArrayList<>(nonEmpty.size());
        List<String> uploadedKeys = new ArrayList<>(nonEmpty.size());
        try {
            for (MultipartFile file : nonEmpty) {
                UploadResult result = uploadSingleImage(file, POST_PREFIX);
                uploaded.add(result);
                uploadedKeys.add(result.key());
            }
            registerRollbackCleanup(uploadedKeys);
            return uploaded;
        } catch (RuntimeException failure) {
            for (String key : uploadedKeys) {
                deleteOrEnqueueRetry(key, "UPLOAD_BATCH_ABORT");
            }
            throw failure;
        }
    }

    public void validateImageFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw invalidRequest();
        }
        long size = file.getSize();
        if (size <= 0) {
            throw invalidRequest();
        }
        String contentType = file.getContentType();
        if (contentType == null) {
            throw badRequest("FILE_TYPE_NOT_ALLOWED");
        }
        String normalizedType = normalizeMimeType(contentType);
        if (normalizedType.startsWith("video/")) {
            throw badRequest("FILE_VIDEO_NOT_ALLOWED");
        }
        if (!ALLOWED_IMAGE_TYPES.contains(normalizedType)) {
            throw badRequest("FILE_TYPE_NOT_ALLOWED");
        }
        String originalFilename = file.getOriginalFilename();
        if (originalFilename != null && !originalFilename.isBlank()) {
            String sanitized = sanitizeOriginalName(originalFilename);
            int dot = sanitized.lastIndexOf('.');
            if (dot >= 0 && dot < sanitized.length() - 1) {
                String ext = sanitized.substring(dot + 1).toLowerCase(Locale.ROOT);
                if (Set.of("mp4", "mov", "webm", "avi", "mkv", "m4v").contains(ext)) {
                    throw badRequest("FILE_VIDEO_NOT_ALLOWED");
                }
                if (!ALLOWED_EXTENSIONS.contains(ext)) {
                    throw badRequest("FILE_TYPE_NOT_ALLOWED");
                }
            }
        }
        if ("image/gif".equals(normalizedType)) {
            if (size > MAX_GIF_FILE_SIZE) {
                throw badRequest("GIF_FILE_TOO_LARGE");
            }
        } else if (size > MAX_SINGLE_FILE_SIZE) {
            throw badRequest("IMAGE_FILE_TOO_LARGE");
        }
    }

    private static String normalizeMimeType(String contentType) {
        String lowered = contentType.strip().toLowerCase(Locale.ROOT);
        int semicolon = lowered.indexOf(';');
        return semicolon >= 0 ? lowered.substring(0, semicolon).strip() : lowered;
    }

    private UploadResult uploadSingleImage(MultipartFile file, String dirPrefix) {
        String originalName = sanitizeOriginalName(file.getOriginalFilename());
        String ext = extractExtension(originalName, file.getContentType());
        String dateSegment = LocalDate.now(ZoneOffset.UTC).format(DATE_FMT);
        String key = dirPrefix + "/" + dateSegment + "/" + UUID.randomUUID() + "." + ext;
        String contentType = normalizeMimeType(file.getContentType());
        long size = file.getSize();

        if (s3Client != null) {
            PutObjectRequest putReq = PutObjectRequest.builder()
                    .bucket(bucket)
                    .key(key)
                    .contentType(contentType)
                    .contentLength(size)
                    .build();
            try (InputStream is = file.getInputStream()) {
                realS3PutCounter.incrementAndGet();
                s3Client.putObject(putReq, RequestBody.fromInputStream(is, size));
            } catch (IOException e) {
                log.warn("Failed to read multipart image stream for S3 upload");
                throw invalidRequest();
            }
            String url = s3Client.utilities()
                    .getUrl(GetUrlRequest.builder().bucket(bucket).key(key).build())
                    .toString();
            return new UploadResult(key, url, originalName, size, contentType);
        }

        // Local/Test zero-billing storage when S3 is disabled or unconfigured
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw invalidRequest();
        }
        simulatedStore.add(key);
        localMemoryStore.put(key, new LocalMediaPayload(bytes, contentType));
        if (localStorageRoot != null) {
            Path target = localStorageRoot.resolve(key).normalize();
            if (target.startsWith(localStorageRoot)) {
                try {
                    Files.createDirectories(target.getParent());
                    Files.write(target, bytes);
                } catch (IOException e) {
                    log.warn("Failed to persist local media file for key={}", key);
                }
            }
        }
        String url = normalizedPublicBaseUrl != null
                ? normalizedPublicBaseUrl + "/api/v1/community/local-media/" + key
                : "https://s3." + region + ".amazonaws.com/yogimangchi-local/" + key;
        return new UploadResult(key, url, originalName, size, contentType);
    }

    public boolean deleteByKeyQuietly(String key) {
        if (key == null || key.isBlank()) {
            return false;
        }
        if (simulatedDeleteFailureKeys.contains(key)) {
            log.warn("Simulated S3 delete failure triggered for key={}", key);
            return false;
        }
        if (s3Client != null) {
            try {
                realS3DeleteCounter.incrementAndGet();
                s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
                return true;
            } catch (Exception e) {
                log.warn("S3 deleteObject deferred for key={}", key);
                return false;
            }
        }
        localMemoryStore.remove(key);
        boolean removedDisk = deleteLocalFileQuietly(key);
        boolean removedMem = simulatedStore.remove(key);
        return removedMem || removedDisk;
    }

    private boolean deleteLocalFileQuietly(String key) {
        if (localStorageRoot == null || key.contains("..") || key.indexOf('\\') >= 0) {
            return false;
        }
        Path target = localStorageRoot.resolve(key).normalize();
        if (!target.startsWith(localStorageRoot)) {
            return false;
        }
        try {
            return Files.deleteIfExists(target);
        } catch (IOException ignored) {
            return false;
        }
    }

    public void deleteOrEnqueueRetry(String key, String reason) {
        if (key == null || key.isBlank()) {
            return;
        }
        String effectiveReason = (reason == null || reason.isBlank()) ? "CLEANUP" : reason;
        boolean deleted = deleteByKeyQuietly(key);
        if (deleted) {
            if (jdbc != null) {
                runInIndependentTx(() -> jdbc.update(
                        "update content.s3_cleanup_task set status = 'COMPLETED', completed_at = now(), last_error = null "
                                + "where s3_key = ? and status <> 'COMPLETED'",
                        key));
            }
            return;
        }
        if (jdbc != null) {
            runInIndependentTx(() -> jdbc.update(
                    "insert into content.s3_cleanup_task(s3_key, reason, status, attempt_count, max_attempts, next_attempt_at, last_error, created_at) "
                            + "values (?, ?, 'PENDING', 1, 5, now(), 'Initial S3 delete failed', now()) "
                            + "on conflict(s3_key) do update "
                            + "set status = 'PENDING', "
                            + "    reason = excluded.reason, "
                            + "    attempt_count = least(content.s3_cleanup_task.attempt_count + 1, content.s3_cleanup_task.max_attempts), "
                            + "    next_attempt_at = now(), "
                            + "    last_error = excluded.last_error",
                    key, effectiveReason));
        }
    }

    private void runInIndependentTx(Runnable action) {
        try {
            if (requiresNewTx != null) {
                requiresNewTx.executeWithoutResult(status -> action.run());
            } else {
                action.run();
            }
        } catch (Exception e) {
            log.warn("Failed to record S3 cleanup task in DB: {}", e.getMessage());
        }
    }

    @Scheduled(
            fixedDelayString = "${content.s3.cleanup-retry-delay-ms:60000}",
            initialDelayString = "${content.s3.cleanup-initial-delay-ms:30000}"
    )
    public void retryPendingDeletionsScheduled() {
        retryPendingDeletions(Instant.now());
    }

    public int retryPendingDeletions(Instant now) {
        if (jdbc == null) {
            return 0;
        }
        Instant effectiveNow = now == null ? Instant.now() : now;
        List<PendingCleanupRow> rows = jdbc.query(
                "select id, s3_key, attempt_count, max_attempts from content.s3_cleanup_task "
                        + "where status = 'PENDING' and next_attempt_at <= ? "
                        + "order by next_attempt_at asc, id asc limit 20",
                (rs, n) -> new PendingCleanupRow(
                        rs.getLong("id"),
                        rs.getString("s3_key"),
                        rs.getInt("attempt_count"),
                        rs.getInt("max_attempts")),
                Timestamp.from(effectiveNow));

        int resolvedCount = 0;
        for (PendingCleanupRow row : rows) {
            if (deleteByKeyQuietly(row.s3Key())) {
                jdbc.update(
                        "update content.s3_cleanup_task set status = 'COMPLETED', completed_at = now(), last_error = null where id = ?",
                        row.id());
                resolvedCount++;
            } else {
                int newAttempt = row.attemptCount() + 1;
                if (newAttempt >= row.maxAttempts()) {
                    jdbc.update(
                            "update content.s3_cleanup_task set status = 'FAILED', attempt_count = ?, last_error = 'Max retry attempts reached' where id = ?",
                            newAttempt, row.id());
                } else {
                    jdbc.update(
                            "update content.s3_cleanup_task set status = 'PENDING', attempt_count = ?, "
                                    + "next_attempt_at = now() + make_interval(secs => least(3600, 10 * power(2, least(? + 1, 6)))::int), "
                                    + "last_error = 'Retry S3 delete failed' where id = ?",
                            newAttempt, row.attemptCount(), row.id());
                }
            }
        }
        return resolvedCount;
    }

    public boolean isRealS3Configured() {
        return s3Client != null;
    }

    public String region() {
        return region;
    }

    public void registerRollbackCleanup(List<String> keys) {
        if (keys == null || keys.isEmpty()) {
            return;
        }
        List<String> copy = List.copyOf(keys);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    if (status != STATUS_COMMITTED) {
                        for (String key : copy) {
                            deleteOrEnqueueRetry(key, "TX_ROLLBACK");
                        }
                    }
                }
            });
        }
    }

    public void registerAfterCommitDelete(List<String> keys) {
        registerAfterCommitDelete(keys, "AFTER_COMMIT_DELETE");
    }

    public void registerAfterCommitDelete(List<String> keys, String reason) {
        if (keys == null || keys.isEmpty()) {
            return;
        }
        List<String> copy = List.copyOf(keys);
        String effectiveReason = (reason == null || reason.isBlank()) ? "AFTER_COMMIT_DELETE" : reason;
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    if (status == STATUS_COMMITTED) {
                        for (String key : copy) {
                            deleteOrEnqueueRetry(key, effectiveReason);
                        }
                    }
                }
            });
        } else {
            for (String key : copy) {
                deleteOrEnqueueRetry(key, effectiveReason);
            }
        }
    }

    public boolean isSimulatedKeyPresent(String key) {
        return key != null && simulatedStore.contains(key);
    }

    private static String sanitizeOriginalName(String originalFilename) {
        if (originalFilename == null || originalFilename.isBlank()) {
            return "image.png";
        }
        String stripped = originalFilename.replace('\\', '/');
        int slash = stripped.lastIndexOf('/');
        String base = slash >= 0 ? stripped.substring(slash + 1) : stripped;
        base = base.replace("\0", "").strip();
        if (base.isEmpty()) {
            return "image.png";
        }
        return base.length() > 200 ? base.substring(base.length() - 200) : base;
    }

    private static String extractExtension(String filename, String contentType) {
        if (contentType != null) {
            String lower = normalizeMimeType(contentType);
            if ("image/gif".equals(lower)) {
                return "gif";
            }
        }
        int dot = filename.lastIndexOf('.');
        if (dot >= 0 && dot < filename.length() - 1) {
            String candidate = filename.substring(dot + 1).toLowerCase(Locale.ROOT);
            if (ALLOWED_EXTENSIONS.contains(candidate)) {
                return candidate;
            }
        }
        if (contentType != null) {
            String lower = normalizeMimeType(contentType);
            if (lower.contains("gif")) return "gif";
            if (lower.contains("jpeg") || lower.contains("jpg")) return "jpg";
            if (lower.contains("webp")) return "webp";
            if (lower.contains("png")) return "png";
        }
        return "png";
    }

    private static AuthFailure invalidRequest() {
        return badRequest("INVALID_REQUEST");
    }

    private static AuthFailure badRequest(String code) {
        return new AuthFailure(code, HttpStatus.BAD_REQUEST);
    }
}
