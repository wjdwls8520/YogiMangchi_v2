package com.yogimangchi.content.community;

import com.yogimangchi.content.error.AuthFailure;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
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
    public static final long MAX_TOTAL_FILE_SIZE = 50L * 1024 * 1024;
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyyMMdd");

    public record UploadResult(
            String key,
            String url,
            String originalName,
            long size,
            String contentType
    ) { }

    private final String bucket;
    private final String region;
    private final S3Client s3Client;
    private final Set<String> simulatedStore = ConcurrentHashMap.newKeySet();

    public CommunityS3Service(
            @Value("${content.s3.bucket:}") String bucket,
            @Value("${content.s3.access-key:}") String accessKey,
            @Value("${content.s3.secret-key:}") String secretKey,
            @Value("${content.s3.region:ap-northeast-2}") String region) {
        this.bucket = bucket == null ? "" : bucket.strip();
        this.region = (region == null || region.isBlank()) ? "ap-northeast-2" : region.strip();
        String trimmedAccess = accessKey == null ? "" : accessKey.strip();
        String trimmedSecret = secretKey == null ? "" : secretKey.strip();
        if (!this.bucket.isEmpty() && !trimmedAccess.isEmpty() && !trimmedSecret.isEmpty()) {
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
            throw invalidRequest();
        }

        long totalSize = 0L;
        for (MultipartFile file : nonEmpty) {
            validateImageFile(file);
            totalSize += file.getSize();
            if (totalSize > MAX_TOTAL_FILE_SIZE) {
                throw invalidRequest();
            }
        }

        List<UploadResult> uploaded = new ArrayList<>(nonEmpty.size());
        List<String> uploadedKeys = new ArrayList<>(nonEmpty.size());
        try {
            for (MultipartFile file : nonEmpty) {
                UploadResult result = uploadSingleImage(file, "community/post");
                uploaded.add(result);
                uploadedKeys.add(result.key());
            }
            registerRollbackCleanup(uploadedKeys);
            return uploaded;
        } catch (RuntimeException failure) {
            for (String key : uploadedKeys) {
                deleteByKeyQuietly(key);
            }
            throw failure;
        }
    }

    public void validateImageFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw invalidRequest();
        }
        long size = file.getSize();
        if (size <= 0 || size > MAX_SINGLE_FILE_SIZE) {
            throw invalidRequest();
        }
        String contentType = file.getContentType();
        if (contentType == null) {
            throw invalidRequest();
        }
        String normalizedType = contentType.strip().toLowerCase(Locale.ROOT);
        if (!normalizedType.startsWith("image/") || normalizedType.equals("image/gif") || normalizedType.startsWith("image/gif;")) {
            throw invalidRequest();
        }
    }

    private UploadResult uploadSingleImage(MultipartFile file, String dirPrefix) {
        String originalName = sanitizeOriginalName(file.getOriginalFilename());
        String ext = extractExtension(originalName, file.getContentType());
        String dateSegment = LocalDate.now(ZoneOffset.UTC).format(DATE_FMT);
        String key = dirPrefix + "/" + dateSegment + "/" + UUID.randomUUID() + "." + ext;
        String contentType = file.getContentType().strip();
        long size = file.getSize();

        if (s3Client != null) {
            PutObjectRequest putReq = PutObjectRequest.builder()
                    .bucket(bucket)
                    .key(key)
                    .contentType(contentType)
                    .contentLength(size)
                    .build();
            try (InputStream is = file.getInputStream()) {
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

        // Local/Test fallback when S3_BUCKET credentials are not configured
        try (InputStream is = file.getInputStream()) {
            is.read();
        } catch (IOException e) {
            throw invalidRequest();
        }
        simulatedStore.add(key);
        String url = "https://s3." + region + ".amazonaws.com/yogimangchi-local/" + key;
        return new UploadResult(key, url, originalName, size, contentType);
    }

    public void deleteByKeyQuietly(String key) {
        if (key == null || key.isBlank()) {
            return;
        }
        if (s3Client != null) {
            try {
                s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
            } catch (Exception e) {
                log.warn("S3 deleteObject deferred for key={}", key);
            }
            return;
        }
        simulatedStore.remove(key);
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
                            deleteByKeyQuietly(key);
                        }
                    }
                }
            });
        }
    }

    public void registerAfterCommitDelete(List<String> keys) {
        if (keys == null || keys.isEmpty()) {
            return;
        }
        List<String> copy = List.copyOf(keys);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    if (status == STATUS_COMMITTED) {
                        for (String key : copy) {
                            deleteByKeyQuietly(key);
                        }
                    }
                }
            });
        } else {
            for (String key : copy) {
                deleteByKeyQuietly(key);
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
        int dot = filename.lastIndexOf('.');
        if (dot >= 0 && dot < filename.length() - 1) {
            String candidate = filename.substring(dot + 1).toLowerCase(Locale.ROOT);
            if (candidate.matches("[a-z0-9]{1,8}")) {
                return candidate;
            }
        }
        if (contentType != null) {
            String lower = contentType.toLowerCase(Locale.ROOT);
            if (lower.contains("jpeg") || lower.contains("jpg")) return "jpg";
            if (lower.contains("webp")) return "webp";
            if (lower.contains("png")) return "png";
        }
        return "png";
    }

    private static AuthFailure invalidRequest() {
        return new AuthFailure("INVALID_REQUEST", HttpStatus.BAD_REQUEST);
    }
}
