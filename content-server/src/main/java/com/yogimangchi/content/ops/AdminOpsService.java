package com.yogimangchi.content.ops;

import com.yogimangchi.content.community.CommunityUxSseService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.news.NewsIngestionService;
import com.yogimangchi.content.news.NewsService;
import com.yogimangchi.content.news.NewsSseService;
import com.yogimangchi.content.notification.ContentNotificationSseService;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminOpsService {
    private static final Logger log = LoggerFactory.getLogger(AdminOpsService.class);

    public record DbHealth(boolean up, long latencyMs) { }

    public record NewsIngestionStatus(
            boolean live,
            boolean collectorEnabled,
            Instant lastCollectedAt,
            int consecutiveFailures
    ) { }

    public record OutboxBacklogs(
            long pendingWithdrawals,
            long stuckWithdrawals,
            long pendingProvisions,
            long stuckProvisions,
            long pendingS3Cleanup,
            long failedS3Cleanup
    ) { }

    public record ActiveSseCounts(
            int newsSse,
            int communitySse,
            int notificationSse
    ) { }

    public record OpsSummaryResponse(
            Instant generatedAt,
            DbHealth db,
            NewsIngestionStatus newsIngestion,
            OutboxBacklogs outbox,
            long openSupportInquiries,
            ActiveSseCounts activeSse,
            List<OpsErrorBuffer.ErrorEntry> recentErrors
    ) { }

    public record S3CleanupRetryResponse(int retriedCount) { }

    private final JdbcTemplate jdbc;
    private final NewsIngestionService newsIngestion;
    private final NewsSseService newsSse;
    private final CommunityUxSseService communitySse;
    private final ContentNotificationSseService notificationSse;
    private final OpsErrorBuffer errorBuffer;

    public AdminOpsService(
            JdbcTemplate jdbc,
            NewsIngestionService newsIngestion,
            NewsSseService newsSse,
            CommunityUxSseService communitySse,
            ContentNotificationSseService notificationSse,
            OpsErrorBuffer errorBuffer) {
        this.jdbc = jdbc;
        this.newsIngestion = newsIngestion;
        this.newsSse = newsSse;
        this.communitySse = communitySse;
        this.notificationSse = notificationSse;
        this.errorBuffer = errorBuffer;
    }

    @Transactional(readOnly = true, timeout = 5)
    public OpsSummaryResponse summary(Long adminId) {
        requireAdmin(adminId);

        DbHealth dbHealth = probeDb();
        NewsService.NewsLiveStatus liveStatus = newsIngestion.currentLiveStatus();
        NewsIngestionStatus ingestionStatus = new NewsIngestionStatus(
                liveStatus != null && liveStatus.live(),
                newsIngestion.isCollectorEnabled(),
                liveStatus == null ? null : liveStatus.lastCollectedAt(),
                newsIngestion.getConsecutiveFailures());

        long pendingWithdrawals = count("select count(*) from content.member_withdrawal where status = 'PENDING'");
        long stuckWithdrawals = count(
                "select count(*) from content.member_withdrawal where status = 'PENDING' "
                        + "and (attempts >= 5 or requested_at < now() - interval '10 minutes')");
        long pendingProvisions = count("select count(*) from content.member_trading_provision where status = 'PENDING'");
        long stuckProvisions = count(
                "select count(*) from content.member_trading_provision where status = 'PENDING' and attempts >= 5");
        long pendingS3Cleanup = count("select count(*) from content.s3_cleanup_task where status = 'PENDING'");
        long failedS3Cleanup = count("select count(*) from content.s3_cleanup_task where status = 'FAILED'");
        long openSupportInquiries = count("select count(*) from content.support_inquiry where status = 'OPEN'");

        OutboxBacklogs outbox = new OutboxBacklogs(
                pendingWithdrawals,
                stuckWithdrawals,
                pendingProvisions,
                stuckProvisions,
                pendingS3Cleanup,
                failedS3Cleanup);

        ActiveSseCounts sseCounts = new ActiveSseCounts(
                newsSse.activeConnectionCount(),
                communitySse.activeConnectionCount(),
                notificationSse.activeConnectionCount());

        return new OpsSummaryResponse(
                Instant.now(),
                dbHealth,
                ingestionStatus,
                outbox,
                openSupportInquiries,
                sseCounts,
                errorBuffer.recent());
    }

    @Transactional(timeout = 5)
    public S3CleanupRetryResponse retryFailedS3Cleanup(Long adminId) {
        requireAdmin(adminId);
        int retried = jdbc.update(
                "update content.s3_cleanup_task "
                        + "set status = 'PENDING', attempt_count = 0, next_attempt_at = now(), last_error = null "
                        + "where status = 'FAILED'");
        log.info("[AdminAudit] action=RETRY_FAILED_S3_CLEANUP adminId={} retriedCount={}", adminId, retried);
        return new S3CleanupRetryResponse(retried);
    }

    private DbHealth probeDb() {
        long startNs = System.nanoTime();
        try {
            Integer one = jdbc.queryForObject("select 1", Integer.class);
            long latencyMs = Math.max(0L, (System.nanoTime() - startNs) / 1_000_000L);
            return new DbHealth(Integer.valueOf(1).equals(one), latencyMs);
        } catch (Exception ex) {
            long latencyMs = Math.max(0L, (System.nanoTime() - startNs) / 1_000_000L);
            return new DbHealth(false, latencyMs);
        }
    }

    private long count(String sql) {
        Long value = jdbc.queryForObject(sql, Long.class);
        return value == null ? 0L : value;
    }

    private void requireAdmin(Long adminId) {
        if (adminId == null) {
            throw AuthFailure.unauthorized();
        }
        Boolean isAdmin = jdbc.queryForObject(
                "select exists(select 1 from content.member where id = ? and status = 'ACTIVE' and role = 'ADMIN')",
                Boolean.class,
                adminId);
        if (!Boolean.TRUE.equals(isAdmin)) {
            throw new AuthFailure("ACCESS_DENIED", HttpStatus.FORBIDDEN);
        }
    }
}
