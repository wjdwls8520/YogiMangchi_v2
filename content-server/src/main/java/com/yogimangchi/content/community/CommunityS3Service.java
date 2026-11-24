package com.yogimangchi.content.community;

import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.ops.OpsAlertService;
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
import java.util.LinkedHashMap;
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
import software.amazon.awssdk.awscore.exception.AwsServiceException;
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
    private static final String DEFAULT_LOCAL_MEDIA_DIR = ".gradle/local-runtime/uploads";

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
    private static final Set<String> VIDEO_EXTENSIONS = Set.of(
            "mp4", "mov", "webm", "avi", "mkv", "m4v"
    );
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyyMMdd");
    private static final byte[] PLACEHOLDER_SVG_BYTES = (
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"360\" viewBox=\"0 0 640 360\">"
                    + "<rect width=\"640\" height=\"360\" rx=\"20\" fill=\"#F8FAFC\"/>"
                    + "<rect x=\"16\" y=\"16\" width=\"608\" height=\"328\" rx=\"14\" fill=\"#FFFFFF\" stroke=\"#E2E8F0\" stroke-width=\"2\"/>"
                    + "<circle cx=\"320\" cy=\"150\" r=\"28\" fill=\"#EFF6FF\"/>"
                    + "<path d=\"M308 156l8-10 7 8 10-13 11 15H308z\" fill=\"#2563EB\"/>"
                    + "<text x=\"320\" y=\"212\" text-anchor=\"middle\" font-family=\"sans-serif\" font-size=\"15\" font-weight=\"700\" fill=\"#1E293B\">첨부 이미지 미리보기</text>"
                    + "<text x=\"320\" y=\"238\" text-anchor=\"middle\" font-family=\"sans-serif\" font-size=\"12\" fill=\"#64748B\">이미지 저장소 준비 중</text>"
                    + "</svg>"
    ).getBytes(StandardCharsets.UTF_8);

    public enum DetectedImageType {
        JPEG("image/jpeg", "jpg"),
        PNG("image/png", "png"),
        GIF("image/gif", "gif"),
        WEBP("image/webp", "webp");

        private final String mimeType;
        private final String extension;

        DetectedImageType(String mimeType, String extension) {
            this.mimeType = mimeType;
            this.extension = extension;
        }

        public String mimeType() {
            return mimeType;
        }

        public String extension() {
            return extension;
        }
    }

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

    private record DeleteAttemptResult(boolean deleted, String errorDetail) { }

    private final String bucket;
    private final String region;
    private final String normalizedPublicBaseUrl;
    private final Path localStorageRoot;
    private final S3Client s3Client;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate requiresNewTx;
    private final OpsAlertService opsAlert;
    private final Set<String> simulatedDeleteFailureKeys = ConcurrentHashMap.newKeySet();
    private final AtomicInteger realS3PutCounter = new AtomicInteger();
    private final AtomicInteger realS3DeleteCounter = new AtomicInteger();

    public CommunityS3Service(String bucket, String accessKey, String secretKey, String region) {
        this(true, null, DEFAULT_LOCAL_MEDIA_DIR, bucket, accessKey, secretKey, region, null, null, null);
    }

    public CommunityS3Service(
            String bucket,
            String accessKey,
            String secretKey,
            String region,
            JdbcTemplate jdbc,
            PlatformTransactionManager txManager) {
        this(true, null, DEFAULT_LOCAL_MEDIA_DIR, bucket, accessKey, secretKey, region, jdbc, txManager, null);
    }

    public CommunityS3Service(
            boolean s3Enabled,
            String publicBaseUrl,
            String bucket,
            String accessKey,
            String secretKey,
            String region,
            JdbcTemplate jdbc,
            PlatformTransactionManager txManager) {
        this(s3Enabled, publicBaseUrl, DEFAULT_LOCAL_MEDIA_DIR, bucket, accessKey, secretKey, region, jdbc, txManager, null);
    }

    @Autowired
    public CommunityS3Service(
            @Value("${content.s3.enabled:false}") boolean s3Enabled,
            @Value("${content.s3.public-base-url:${CONTENT_PUBLIC_BASE_URL:http://localhost:8080}}") String publicBaseUrl,
            @Value("${content.s3.local-media-dir:${CONTENT_LOCAL_MEDIA_DIR:.gradle/local-runtime/uploads}}") String localMediaDir,
            @Value("${content.s3.bucket:}") String bucket,
            @Value("${content.s3.access-key:}") String accessKey,
            @Value("${content.s3.secret-key:}") String secretKey,
            @Value("${content.s3.region:ap-northeast-2}") String region,
            JdbcTemplate jdbc,
            PlatformTransactionManager txManager,
            @Autowired(required = false) OpsAlertService opsAlert) {
        this.opsAlert = opsAlert;
        this.bucket = bucket == null ? "" : bucket.strip();
        this.region = (region == null || region.isBlank()) ? "ap-northeast-2" : region.strip();
        String trimmedBaseUrl = publicBaseUrl == null ? "" : publicBaseUrl.strip().replaceAll("/+$", "");
        this.normalizedPublicBaseUrl = trimmedBaseUrl.isEmpty() ? null : trimmedBaseUrl;
        String effectiveDir = (localMediaDir == null || localMediaDir.isBlank())
                ? DEFAULT_LOCAL_MEDIA_DIR
                : localMediaDir.strip();
        this.localStorageRoot = Path.of(effectiveDir).toAbsolutePath().normalize();
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

    public String storageMode() {
        return s3Client != null ? "S3" : "LOCAL_DISK";
    }

    public Path localStorageRoot() {
        return localStorageRoot;
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
            String base = normalizedPublicBaseUrl != null ? normalizedPublicBaseUrl : "";
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
        Path target = resolveSafeLocalPath(key);
        if (target == null || !Files.isRegularFile(target)) {
            return null;
        }
        try {
            byte[] bytes = Files.readAllBytes(target);
            DetectedImageType detected = detectMagicBytes(bytes, bytes.length);
            String canonicalMime = detected != null ? detected.mimeType() : contentTypeFromKey(key);
            return new LocalMediaPayload(bytes, canonicalMime);
        } catch (IOException ignored) {
            return null;
        }
    }

    private Path resolveSafeLocalPath(String rawKey) {
        if (localStorageRoot == null || rawKey == null || rawKey.isBlank()) {
            return null;
        }
        String key = rawKey.strip();
        while (key.startsWith("/")) {
            key = key.substring(1);
        }
        if (key.contains("..") || key.indexOf('\\') >= 0 || key.indexOf('\0') >= 0) {
            return null;
        }
        if (!key.startsWith(PROFILE_PREFIX + "/") && !key.startsWith(POST_PREFIX + "/")) {
            return null;
        }
        Path target = localStorageRoot.resolve(key).normalize();
        if (!target.startsWith(localStorageRoot)) {
            return null;
        }
        return target;
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
        DetectedImageType detected = validateAndDetectImage(file);
        UploadResult uploaded = uploadSingleImage(file, detected, PROFILE_PREFIX);
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
            throw badRequest("FILE_COUNT_EXCEEDED", "게시글당 첨부 이미지는 최대 10개까지 업로드할 수 있습니다.");
        }

        List<DetectedImageType> detectedTypes = new ArrayList<>(nonEmpty.size());
        long totalSize = 0L;
        for (MultipartFile file : nonEmpty) {
            detectedTypes.add(validateAndDetectImage(file));
            totalSize += file.getSize();
            if (totalSize > MAX_TOTAL_FILE_SIZE) {
                throw badRequest("FILE_TOTAL_SIZE_EXCEEDED", "첨부 이미지 총 용량은 최대 20MB까지 업로드할 수 있습니다.");
            }
        }

        List<UploadResult> uploaded = new ArrayList<>(nonEmpty.size());
        List<String> uploadedKeys = new ArrayList<>(nonEmpty.size());
        try {
            for (int i = 0; i < nonEmpty.size(); i++) {
                UploadResult result = uploadSingleImage(nonEmpty.get(i), detectedTypes.get(i), POST_PREFIX);
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
        validateAndDetectImage(file);
    }

    public DetectedImageType validateAndDetectImage(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw invalidRequest();
        }
        long size = file.getSize();
        if (size <= 0) {
            throw invalidRequest();
        }
        String contentType = file.getContentType();
        if (contentType != null && !contentType.isBlank()) {
            String normalizedType = normalizeMimeType(contentType);
            if (normalizedType.startsWith("video/")) {
                throw badRequest("FILE_VIDEO_NOT_ALLOWED", "동영상 파일은 업로드할 수 없습니다.");
            }
            if (!ALLOWED_IMAGE_TYPES.contains(normalizedType)) {
                throw badRequest("FILE_TYPE_NOT_ALLOWED", "지원하지 않는 파일 형식입니다. JPG, PNG, GIF, WEBP 이미지만 업로드할 수 있습니다.");
            }
        } else {
            throw badRequest("FILE_TYPE_NOT_ALLOWED", "파일 형식을 확인할 수 없습니다. JPG, PNG, GIF, WEBP 이미지만 업로드할 수 있습니다.");
        }

        String originalFilename = file.getOriginalFilename();
        if (originalFilename != null && !originalFilename.isBlank()) {
            String sanitized = sanitizeOriginalName(originalFilename);
            int dot = sanitized.lastIndexOf('.');
            if (dot >= 0 && dot < sanitized.length() - 1) {
                String ext = sanitized.substring(dot + 1).toLowerCase(Locale.ROOT);
                if (VIDEO_EXTENSIONS.contains(ext)) {
                    throw badRequest("FILE_VIDEO_NOT_ALLOWED", "동영상 파일은 업로드할 수 없습니다.");
                }
                if (!ALLOWED_EXTENSIONS.contains(ext)) {
                    throw badRequest("FILE_TYPE_NOT_ALLOWED", "지원하지 않는 확장자입니다. JPG, PNG, GIF, WEBP 이미지만 업로드할 수 있습니다.");
                }
            }
        }

        // Inspect actual file header magic bytes (never trust client Content-Type or filename extension).
        byte[] header = new byte[16];
        int bytesRead;
        try (InputStream is = file.getInputStream()) {
            bytesRead = readHeader(is, header);
        } catch (IOException e) {
            throw invalidRequest();
        }

        DetectedImageType detected = detectMagicBytes(header, bytesRead);
        if (detected == null) {
            throw badRequest("FILE_TYPE_NOT_ALLOWED", "유효한 이미지 파일(JPG, PNG, GIF, WEBP)이 아닙니다. 파일 형식을 확인해 주세요.");
        }

        // Enforce 3MB GIF limit strictly by detected magic bytes (catches .gif renamed to .jpg).
        if (detected == DetectedImageType.GIF) {
            if (size > MAX_GIF_FILE_SIZE) {
                throw badRequest("GIF_FILE_TOO_LARGE", "GIF 이미지는 최대 3MB까지 업로드할 수 있습니다.");
            }
        } else if (size > MAX_SINGLE_FILE_SIZE) {
            throw badRequest("IMAGE_FILE_TOO_LARGE", "이미지는 최대 5MB까지 업로드할 수 있습니다.");
        }

        return detected;
    }

    public static DetectedImageType detectMagicBytes(byte[] bytes, int length) {
        if (bytes == null || length < 3) {
            return null;
        }
        // JPEG: FF D8 FF
        if ((bytes[0] & 0xFF) == 0xFF
                && (bytes[1] & 0xFF) == 0xD8
                && (bytes[2] & 0xFF) == 0xFF) {
            return DetectedImageType.JPEG;
        }
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (length >= 8
                && (bytes[0] & 0xFF) == 0x89
                && bytes[1] == 0x50
                && bytes[2] == 0x4E
                && bytes[3] == 0x47
                && bytes[4] == 0x0D
                && bytes[5] == 0x0A
                && bytes[6] == 0x1A
                && bytes[7] == 0x0A) {
            return DetectedImageType.PNG;
        }
        // GIF: GIF87a or GIF89a
        if (length >= 6
                && bytes[0] == 'G'
                && bytes[1] == 'I'
                && bytes[2] == 'F'
                && bytes[3] == '8'
                && (bytes[4] == '7' || bytes[4] == '9')
                && bytes[5] == 'a') {
            return DetectedImageType.GIF;
        }
        // WEBP: RIFF....WEBP
        if (length >= 12
                && bytes[0] == 'R'
                && bytes[1] == 'I'
                && bytes[2] == 'F'
                && bytes[3] == 'F'
                && bytes[8] == 'W'
                && bytes[9] == 'E'
                && bytes[10] == 'B'
                && bytes[11] == 'P') {
            return DetectedImageType.WEBP;
        }
        return null;
    }

    private static int readHeader(InputStream is, byte[] buffer) throws IOException {
        int total = 0;
        while (total < buffer.length) {
            int n = is.read(buffer, total, buffer.length - total);
            if (n < 0) {
                break;
            }
            total += n;
        }
        return total;
    }

    private static String normalizeMimeType(String contentType) {
        String lowered = contentType.strip().toLowerCase(Locale.ROOT);
        int semicolon = lowered.indexOf(';');
        return semicolon >= 0 ? lowered.substring(0, semicolon).strip() : lowered;
    }

    private UploadResult uploadSingleImage(MultipartFile file, DetectedImageType detected, String dirPrefix) {
        String originalName = sanitizeOriginalName(file.getOriginalFilename());
        // Derive canonical extension & MIME type strictly from detected magic bytes.
        String ext = detected.extension();
        String contentType = detected.mimeType();
        String dateSegment = LocalDate.now(ZoneOffset.UTC).format(DATE_FMT);
        String key = dirPrefix + "/" + dateSegment + "/" + UUID.randomUUID() + "." + ext;
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

        // Local/Test zero-billing disk storage (zero in-heap memory cache -> prevents OOM)
        Path target = resolveSafeLocalPath(key);
        if (target == null) {
            throw invalidRequest();
        }
        try (InputStream is = file.getInputStream()) {
            Files.createDirectories(target.getParent());
            Files.copy(is, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            log.warn("Failed to persist local media file for key={} cause={}", key, e.getClass().getSimpleName());
            throw new AuthFailure("MEDIA_STORAGE_ERROR", HttpStatus.INTERNAL_SERVER_ERROR);
        }
        String url = normalizedPublicBaseUrl != null
                ? normalizedPublicBaseUrl + "/api/v1/community/local-media/" + key
                : "https://s3." + region + ".amazonaws.com/yogimangchi-local/" + key;
        return new UploadResult(key, url, originalName, size, contentType);
    }

    public boolean deleteByKeyQuietly(String key) {
        return deleteByKeyWithDetail(key).deleted();
    }

    private DeleteAttemptResult deleteByKeyWithDetail(String key) {
        if (key == null || key.isBlank()) {
            return new DeleteAttemptResult(false, "Blank S3 key");
        }
        if (simulatedDeleteFailureKeys.contains(key)) {
            log.warn("Simulated S3 delete failure triggered for key={}", key);
            return new DeleteAttemptResult(false, "SimulatedDeleteFailure: simulated outage for key");
        }
        if (s3Client != null) {
            try {
                realS3DeleteCounter.incrementAndGet();
                s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
                return new DeleteAttemptResult(true, null);
            } catch (Exception e) {
                String detail = formatStorageException(e);
                log.warn("S3 deleteObject deferred for key={} error={}", key, detail);
                return new DeleteAttemptResult(false, detail);
            }
        }
        Path target = resolveSafeLocalPath(key);
        if (target == null) {
            return new DeleteAttemptResult(false, "Invalid local media path");
        }
        try {
            boolean deleted = Files.deleteIfExists(target);
            return deleted
                    ? new DeleteAttemptResult(true, null)
                    : new DeleteAttemptResult(false, "LocalMediaNotFound: file not present on disk");
        } catch (IOException e) {
            String detail = formatStorageException(e);
            log.warn("Local media delete failed for key={} error={}", key, detail);
            return new DeleteAttemptResult(false, detail);
        }
    }

    static String formatStorageException(Throwable e) {
        if (e == null) {
            return "UnknownStorageError";
        }
        StringBuilder sb = new StringBuilder(128);
        sb.append(e.getClass().getSimpleName());
        if (e instanceof AwsServiceException aws) {
            if (aws.awsErrorDetails() != null && aws.awsErrorDetails().errorCode() != null) {
                sb.append(" [").append(aws.awsErrorDetails().errorCode());
                if (aws.statusCode() > 0) {
                    sb.append(" HTTP ").append(aws.statusCode());
                }
                sb.append(']');
            } else if (aws.statusCode() > 0) {
                sb.append(" [HTTP ").append(aws.statusCode()).append(']');
            }
        }
        String msg = e.getMessage();
        if (msg != null && !msg.isBlank()) {
            String cleaned = msg.replaceAll("[\\p{Cntrl}]", " ").strip();
            if (!cleaned.isEmpty()) {
                sb.append(": ").append(cleaned);
            }
        }
        String result = sb.toString();
        return result.length() > 450 ? result.substring(0, 450) : result;
    }

    public void deleteOrEnqueueRetry(String key, String reason) {
        if (key == null || key.isBlank()) {
            return;
        }
        String effectiveReason = (reason == null || reason.isBlank()) ? "CLEANUP" : reason;
        DeleteAttemptResult outcome = deleteByKeyWithDetail(key);
        if (outcome.deleted()) {
            if (jdbc != null) {
                runInIndependentTx(() -> jdbc.update(
                        "update content.s3_cleanup_task set status = 'COMPLETED', completed_at = now(), last_error = null "
                                + "where s3_key = ? and status <> 'COMPLETED'",
                        key));
            }
            return;
        }
        String lastError = truncateError(outcome.errorDetail(), "Initial S3 delete failed");
        if (jdbc != null) {
            runInIndependentTx(() -> jdbc.update(
                    "insert into content.s3_cleanup_task(s3_key, reason, status, attempt_count, max_attempts, next_attempt_at, last_error, created_at) "
                            + "values (?, ?, 'PENDING', 1, 5, now(), ?, now()) "
                            + "on conflict(s3_key) do update "
                            + "set status = 'PENDING', "
                            + "    reason = excluded.reason, "
                            + "    attempt_count = least(content.s3_cleanup_task.attempt_count + 1, content.s3_cleanup_task.max_attempts), "
                            + "    next_attempt_at = now(), "
                            + "    last_error = excluded.last_error",
                    key, effectiveReason, lastError));
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
            log.warn("Failed to record S3 cleanup task in DB: {}", e.getClass().getSimpleName());
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
            DeleteAttemptResult outcome = deleteByKeyWithDetail(row.s3Key());
            if (outcome.deleted()) {
                jdbc.update(
                        "update content.s3_cleanup_task set status = 'COMPLETED', completed_at = now(), last_error = null where id = ?",
                        row.id());
                resolvedCount++;
            } else {
                int newAttempt = row.attemptCount() + 1;
                String errorDetail = truncateError(outcome.errorDetail(), "Retry S3 delete failed");
                if (newAttempt >= row.maxAttempts()) {
                    String terminalError = truncateError("Max retry attempts reached: " + errorDetail, "Max retry attempts reached");
                    jdbc.update(
                            "update content.s3_cleanup_task set status = 'FAILED', attempt_count = ?, last_error = ? where id = ?",
                            newAttempt, terminalError, row.id());
                    log.error("S3 cleanup task entered FAILED state taskId={} s3Key={} attempts={} maxAttempts={} error={}",
                            row.id(), row.s3Key(), newAttempt, row.maxAttempts(), terminalError);
                    if (opsAlert != null) {
                        Map<String, Object> details = new LinkedHashMap<>();
                        details.put("taskId", row.id());
                        details.put("attempts", newAttempt);
                        details.put("maxAttempts", row.maxAttempts());
                        details.put("lastError", terminalError);
                        opsAlert.alert("s3-cleanup-failed", "ERROR", "S3 cleanup task entered FAILED state", details);
                    }
                } else {
                    jdbc.update(
                            "update content.s3_cleanup_task set status = 'PENDING', attempt_count = ?, "
                                    + "next_attempt_at = now() + make_interval(secs => least(3600, 10 * power(2, least(? + 1, 6)))::int), "
                                    + "last_error = ? where id = ?",
                            newAttempt, row.attemptCount(), errorDetail, row.id());
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
        Path target = resolveSafeLocalPath(key);
        return target != null && Files.isRegularFile(target);
    }

    private static String truncateError(String raw, String fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        String cleaned = raw.replaceAll("[\\p{Cntrl}]", " ").strip();
        if (cleaned.isEmpty()) {
            return fallback;
        }
        return cleaned.length() > 500 ? cleaned.substring(0, 500) : cleaned;
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

    private static AuthFailure invalidRequest() {
        return badRequest("INVALID_REQUEST", null);
    }

    private static AuthFailure badRequest(String code, String detail) {
        return new AuthFailure(code, HttpStatus.BAD_REQUEST, detail);
    }
}
