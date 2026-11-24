package com.yogimangchi.content.ops;

import com.yogimangchi.content.community.CommunityS3Service;
import com.yogimangchi.content.community.CommunityUxSseService;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.member.service.MemberProvisioningDelivery;
import com.yogimangchi.content.member.service.MemberSuspensionDelivery;
import com.yogimangchi.content.member.service.WithdrawalDelivery;
import com.yogimangchi.content.news.NewsIngestionService;
import com.yogimangchi.content.news.NewsService;
import com.yogimangchi.content.news.NewsSseService;
import com.yogimangchi.content.notification.ContentNotificationSseService;
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryUsage;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminOpsService {
    private static final Logger log = LoggerFactory.getLogger(AdminOpsService.class);

    public record DbHealth(boolean up, long latencyMs) { }

    public record RuntimeMetrics(
            long heapUsedMb,
            long heapMaxMb,
            double heapUsagePct,
            long uptimeSeconds,
            List<String> activeProfiles
    ) { }

    public record HikariMetrics(
            int active,
            int idle,
            int total,
            int threadsAwaiting,
            int maxPoolSize
    ) { }

    public record NewsIngestionStatus(
            boolean live,
            boolean collectorEnabled,
            Instant lastCollectedAt,
            int consecutiveFailures
    ) { }

    public record FailedS3CleanupTask(
            long id,
            String s3Key,
            String reason,
            int attemptCount,
            int maxAttempts,
            String lastError,
            Instant createdAt
    ) { }

    public record S3StorageStatus(
            String mode,
            long pendingCleanupCount,
            long failedCleanupCount,
            List<FailedS3CleanupTask> recentFailedTasks
    ) { }

    public record StuckOutboxItem(
            String type,
            long id,
            long memberId,
            int attempts,
            Instant createdAt,
            Instant nextAttemptAt,
            String lastError
    ) { }

    public record OutboxBacklogs(
            long pendingWithdrawals,
            long stuckWithdrawals,
            long pendingProvisions,
            long stuckProvisions,
            long pendingSuspensions,
            long stuckSuspensions,
            long pendingS3Cleanup,
            long failedS3Cleanup,
            List<StuckOutboxItem> stuckDetails
    ) { }

    public record ActiveSseCounts(
            int newsSse,
            int communitySse,
            int notificationSse
    ) { }

    public record ErrorMetricsSummary(
            long last5m5xx,
            long last1h5xx,
            long total5xx,
            long total429,
            long total409,
            List<OpsErrorBuffer.ErrorEntry> criticalErrors,
            List<OpsErrorBuffer.ErrorEntry> recentErrors
    ) { }

    public record OpsSummaryResponse(
            Instant generatedAt,
            DbHealth db,
            long dbLatencyMs,
            RuntimeMetrics runtime,
            HikariMetrics hikari,
            NewsIngestionStatus newsIngestion,
            List<NewsIngestionService.RssSourceStatus> rssSources,
            S3StorageStatus s3Storage,
            OutboxBacklogs outbox,
            long openSupportInquiries,
            ActiveSseCounts activeSse,
            OpsAlertService.AlertTelemetry alerts,
            ErrorMetricsSummary errorMetrics,
            List<OpsErrorBuffer.ErrorEntry> recentErrors,
            List<ClientErrorBuffer.ClientErrorEntry> clientErrors
    ) { }

    public record S3CleanupRetryResponse(int retriedCount) { }

    public record OutboxRetryResponse(
            int rearmedWithdrawals,
            int rearmedProvisions,
            int rearmedSuspensions,
            int rearmedS3Tasks,
            int totalRearmed
    ) { }

    private final JdbcTemplate jdbc;
    private final NewsIngestionService newsIngestion;
    private final NewsSseService newsSse;
    private final CommunityUxSseService communitySse;
    private final ContentNotificationSseService notificationSse;
    private final OpsErrorBuffer errorBuffer;
    private final OpsAlertService opsAlert;
    private final ClientErrorBuffer clientErrorBuffer;
    private final CommunityS3Service s3;
    private final AdminAuditLogService auditLogs;
    private final ObjectProvider<DataSource> dataSourceProvider;
    private final Environment environment;
    private final ObjectProvider<WithdrawalDelivery> withdrawalDeliveryProvider;
    private final ObjectProvider<MemberProvisioningDelivery> provisioningDeliveryProvider;
    private final ObjectProvider<MemberSuspensionDelivery> suspensionDeliveryProvider;

    public AdminOpsService(
            JdbcTemplate jdbc,
            NewsIngestionService newsIngestion,
            NewsSseService newsSse,
            CommunityUxSseService communitySse,
            ContentNotificationSseService notificationSse,
            OpsErrorBuffer errorBuffer) {
        this(jdbc, newsIngestion, newsSse, communitySse, notificationSse, errorBuffer,
                null, null, null, null, null, null, null, null, null);
    }

    @Autowired
    public AdminOpsService(
            JdbcTemplate jdbc,
            NewsIngestionService newsIngestion,
            NewsSseService newsSse,
            CommunityUxSseService communitySse,
            ContentNotificationSseService notificationSse,
            OpsErrorBuffer errorBuffer,
            @Autowired(required = false) OpsAlertService opsAlert,
            @Autowired(required = false) ClientErrorBuffer clientErrorBuffer,
            @Autowired(required = false) CommunityS3Service s3,
            @Autowired(required = false) AdminAuditLogService auditLogs,
            @Autowired(required = false) ObjectProvider<DataSource> dataSourceProvider,
            @Autowired(required = false) Environment environment,
            @Autowired(required = false) ObjectProvider<WithdrawalDelivery> withdrawalDeliveryProvider,
            @Autowired(required = false) ObjectProvider<MemberProvisioningDelivery> provisioningDeliveryProvider,
            @Autowired(required = false) ObjectProvider<MemberSuspensionDelivery> suspensionDeliveryProvider) {
        this.jdbc = jdbc;
        this.newsIngestion = newsIngestion;
        this.newsSse = newsSse;
        this.communitySse = communitySse;
        this.notificationSse = notificationSse;
        this.errorBuffer = errorBuffer;
        this.opsAlert = opsAlert;
        this.clientErrorBuffer = clientErrorBuffer;
        this.s3 = s3;
        this.auditLogs = auditLogs;
        this.dataSourceProvider = dataSourceProvider;
        this.environment = environment;
        this.withdrawalDeliveryProvider = withdrawalDeliveryProvider;
        this.provisioningDeliveryProvider = provisioningDeliveryProvider;
        this.suspensionDeliveryProvider = suspensionDeliveryProvider;
    }

    public OpsSummaryResponse summary(Long adminId) {
        return summary(adminId, false);
    }

    /**
     * Deliberately NOT @Transactional so DB/pool outages never fail before returning live
     * JVM/Hikari/RSS/alert/errorBuffer/clientError diagnostics with db.up=false.
     */
    public OpsSummaryResponse summary(Long adminId, boolean degradedDbOutageAuth) {
        if (!degradedDbOutageAuth) {
            try {
                requireAdmin(adminId);
            } catch (DataAccessException ex) {
                // ActiveMemberFilter already enforced ROLE_ADMIN before reaching the controller;
                // if DB just went down mid-request, degrade gracefully instead of failing 503.
                log.warn("[AdminOps] DB lookup failed during summary admin check; degrading to db.up=false");
            }
        }

        DbHealth dbHealth = probeDb();
        RuntimeMetrics runtime = collectRuntimeMetrics();
        HikariMetrics hikari = collectHikariMetrics();

        NewsService.NewsLiveStatus liveStatus = newsIngestion.currentLiveStatus();
        NewsIngestionStatus ingestionStatus = new NewsIngestionStatus(
                liveStatus != null && liveStatus.live(),
                newsIngestion.isCollectorEnabled(),
                liveStatus == null ? null : liveStatus.lastCollectedAt(),
                newsIngestion.getConsecutiveFailures());
        List<NewsIngestionService.RssSourceStatus> rssSources = newsIngestion.rssSourceStatuses();

        long pendingWithdrawals = 0L;
        long stuckWithdrawals = 0L;
        long pendingProvisions = 0L;
        long stuckProvisions = 0L;
        long pendingSuspensions = 0L;
        long stuckSuspensions = 0L;
        long pendingS3Cleanup = 0L;
        long failedS3Cleanup = 0L;
        long openSupportInquiries = 0L;
        List<FailedS3CleanupTask> recentFailedS3Tasks = List.of();
        List<StuckOutboxItem> stuckDetails = List.of();

        if (dbHealth.up()) {
            pendingWithdrawals = safeCount("select count(*) from content.member_withdrawal where status = 'PENDING'");
            stuckWithdrawals = safeCount(
                    "select count(*) from content.member_withdrawal where status = 'PENDING' "
                            + "and (attempts >= 3 or requested_at < now() - interval '5 minutes')");
            pendingProvisions = safeCount("select count(*) from content.member_trading_provision where status = 'PENDING'");
            stuckProvisions = safeCount(
                    "select count(*) from content.member_trading_provision where status = 'PENDING' "
                            + "and (attempts >= 3 or next_attempt_at < now() - interval '5 minutes')");
            pendingSuspensions = safeCount("select count(*) from content.member_suspension_delivery where status = 'PENDING'");
            stuckSuspensions = safeCount(
                    "select count(*) from content.member_suspension_delivery where status = 'PENDING' "
                            + "and (attempt_count >= 3 or created_at < now() - interval '5 minutes')");
            pendingS3Cleanup = safeCount("select count(*) from content.s3_cleanup_task where status = 'PENDING'");
            failedS3Cleanup = safeCount("select count(*) from content.s3_cleanup_task where status = 'FAILED'");
            openSupportInquiries = safeCount("select count(*) from content.support_inquiry where status = 'OPEN'");
            recentFailedS3Tasks = safeQueryFailedS3Tasks();
            stuckDetails = safeQueryStuckOutboxDetails();
        }

        S3StorageStatus s3Storage = new S3StorageStatus(
                s3 != null ? s3.storageMode() : "LOCAL_DISK",
                pendingS3Cleanup,
                failedS3Cleanup,
                recentFailedS3Tasks);

        OutboxBacklogs outbox = new OutboxBacklogs(
                pendingWithdrawals,
                stuckWithdrawals,
                pendingProvisions,
                stuckProvisions,
                pendingSuspensions,
                stuckSuspensions,
                pendingS3Cleanup,
                failedS3Cleanup,
                stuckDetails);

        ActiveSseCounts sseCounts = new ActiveSseCounts(
                newsSse.activeConnectionCount(),
                communitySse.activeConnectionCount(),
                notificationSse.activeConnectionCount());

        OpsAlertService.AlertTelemetry alertTelemetry = opsAlert != null
                ? opsAlert.telemetry()
                : new OpsAlertService.AlertTelemetry(false, false, "NONE", null, "DISABLED", List.of());

        OpsErrorBuffer.ErrorMetrics metrics = errorBuffer.metrics();
        List<OpsErrorBuffer.ErrorEntry> criticalErrors = errorBuffer.recentCritical();
        List<OpsErrorBuffer.ErrorEntry> recentErrors = errorBuffer.recent();
        ErrorMetricsSummary errorMetrics = new ErrorMetricsSummary(
                metrics.last5m5xx(),
                metrics.last1h5xx(),
                metrics.total5xx(),
                metrics.total429(),
                metrics.total409(),
                criticalErrors,
                recentErrors);

        List<ClientErrorBuffer.ClientErrorEntry> clientErrors = clientErrorBuffer != null
                ? clientErrorBuffer.recent()
                : List.of();

        return new OpsSummaryResponse(
                Instant.now(),
                dbHealth,
                dbHealth.latencyMs(),
                runtime,
                hikari,
                ingestionStatus,
                rssSources,
                s3Storage,
                outbox,
                openSupportInquiries,
                sseCounts,
                alertTelemetry,
                errorMetrics,
                recentErrors,
                clientErrors);
    }

    @Transactional(timeout = 5)
    public S3CleanupRetryResponse retryFailedS3Cleanup(Long adminId) {
        requireAdmin(adminId);
        int retried = jdbc.update(
                "update content.s3_cleanup_task "
                        + "set status = 'PENDING', attempt_count = 0, next_attempt_at = now(), last_error = null "
                        + "where status = 'FAILED'");
        recordAudit(adminId, "RETRY_FAILED_S3_CLEANUP", "S3_CLEANUP", "BATCH",
                "실패한 S3 정리 작업 재시도 큐 등록", Map.of("retriedCount", retried));
        log.info("[AdminAudit] action=RETRY_FAILED_S3_CLEANUP adminId={} retriedCount={}", adminId, retried);
        return new S3CleanupRetryResponse(retried);
    }

    @Transactional(timeout = 5)
    public OutboxRetryResponse retryOutbox(Long adminId) {
        requireAdmin(adminId);
        int rearmedWithdrawals = jdbc.update(
                "update content.member_withdrawal set next_attempt_at = now() where status = 'PENDING'");
        int rearmedProvisions = jdbc.update(
                "update content.member_trading_provision set next_attempt_at = now() where status = 'PENDING'");
        int rearmedSuspensions = jdbc.update(
                "update content.member_suspension_delivery set next_attempt_at = now(), updated_at = now() where status = 'PENDING'");
        int rearmedS3Tasks = jdbc.update(
                "update content.s3_cleanup_task "
                        + "set status = 'PENDING', "
                        + "    attempt_count = case when status = 'FAILED' then 0 else attempt_count end, "
                        + "    next_attempt_at = now(), "
                        + "    last_error = case when status = 'FAILED' then null else last_error end "
                        + "where status in ('PENDING', 'FAILED')");
        int totalRearmed = rearmedWithdrawals + rearmedProvisions + rearmedSuspensions + rearmedS3Tasks;

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("rearmedWithdrawals", rearmedWithdrawals);
        detail.put("rearmedProvisions", rearmedProvisions);
        detail.put("rearmedSuspensions", rearmedSuspensions);
        detail.put("rearmedS3Tasks", rearmedS3Tasks);
        detail.put("totalRearmed", totalRearmed);
        recordAudit(adminId, "RETRY_OUTBOX", "OUTBOX", "ALL",
                "미처리/실패 아웃박스 전달 작업 즉시 재시도", detail);

        triggerOutboxSweepAfterCommit();
        return new OutboxRetryResponse(
                rearmedWithdrawals, rearmedProvisions, rearmedSuspensions, rearmedS3Tasks, totalRearmed);
    }

    public OpsAlertService.TestAlertResponse sendTestAlert(Long adminId) {
        requireAdmin(adminId);
        OpsAlertService.TestAlertResponse response = opsAlert != null
                ? opsAlert.sendTestAlert(adminId)
                : new OpsAlertService.TestAlertResponse(false, false, false, 0, "NONE", "DISABLED", "Alert service unavailable", Instant.now());
        try {
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("enabled", response.enabled());
            detail.put("dispatched", response.dispatched());
            detail.put("success", response.success());
            detail.put("httpStatus", response.httpStatus());
            detail.put("format", response.format());
            detail.put("status", response.status());
            recordAudit(adminId, "SEND_TEST_ALERT", "OPS_ALERT", "WEBHOOK",
                    "운영 알림 웹훅 테스트 발송 (" + response.status() + ")", detail);
        } catch (RuntimeException ignored) {
            // Audit failure must not hide test alert result
        }
        return response;
    }

    private void triggerOutboxSweepAfterCommit() {
        Runnable sweep = () -> CompletableFuture.runAsync(() -> {
            try {
                if (withdrawalDeliveryProvider != null) {
                    WithdrawalDelivery wd = withdrawalDeliveryProvider.getIfAvailable();
                    if (wd != null) wd.deliverPending();
                }
            } catch (RuntimeException ignored) { }
            try {
                if (provisioningDeliveryProvider != null) {
                    MemberProvisioningDelivery pd = provisioningDeliveryProvider.getIfAvailable();
                    if (pd != null) pd.deliverPending();
                }
            } catch (RuntimeException ignored) { }
            try {
                if (suspensionDeliveryProvider != null) {
                    MemberSuspensionDelivery sd = suspensionDeliveryProvider.getIfAvailable();
                    if (sd != null) sd.scheduledDeliverPending();
                }
            } catch (RuntimeException ignored) { }
            try {
                if (s3 != null) {
                    s3.retryPendingDeletions(Instant.now());
                }
            } catch (RuntimeException ignored) { }
        });
        if (org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            sweep.run();
                        }
                    });
        } else {
            sweep.run();
        }
    }

    private RuntimeMetrics collectRuntimeMetrics() {
        MemoryUsage heap = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
        long usedBytes = Math.max(0L, heap.getUsed());
        long maxBytes = heap.getMax() > 0 ? heap.getMax() : Runtime.getRuntime().maxMemory();
        long usedMb = usedBytes / (1024L * 1024L);
        long maxMb = Math.max(1L, maxBytes / (1024L * 1024L));
        double usagePct = maxBytes > 0 ? Math.round((usedBytes * 1000.0) / maxBytes) / 10.0 : 0.0;
        long uptimeSeconds = ManagementFactory.getRuntimeMXBean().getUptime() / 1000L;
        List<String> profiles = environment != null
                ? Arrays.asList(environment.getActiveProfiles())
                : List.of();
        return new RuntimeMetrics(usedMb, maxMb, usagePct, uptimeSeconds, profiles);
    }

    private HikariMetrics collectHikariMetrics() {
        DataSource ds = dataSourceProvider != null ? dataSourceProvider.getIfAvailable() : null;
        if (ds == null) {
            return new HikariMetrics(0, 0, 0, 0, 0);
        }
        try {
            HikariDataSource hikari = OpsResourceWatchdog.unwrapHikari(ds);
            if (hikari == null) {
                return new HikariMetrics(0, 0, 0, 0, 0);
            }
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();
            if (pool == null) {
                return new HikariMetrics(0, 0, 0, 0, hikari.getMaximumPoolSize());
            }
            return new HikariMetrics(
                    pool.getActiveConnections(),
                    pool.getIdleConnections(),
                    pool.getTotalConnections(),
                    pool.getThreadsAwaitingConnection(),
                    hikari.getMaximumPoolSize());
        } catch (RuntimeException ex) {
            return new HikariMetrics(0, 0, 0, 0, 0);
        }
    }

    private List<FailedS3CleanupTask> safeQueryFailedS3Tasks() {
        try {
            return jdbc.query("""
                    SELECT id, s3_key, reason, attempt_count, max_attempts, last_error, created_at
                    FROM content.s3_cleanup_task
                    WHERE status = 'FAILED'
                    ORDER BY id DESC
                    LIMIT 10
                    """, (rs, n) -> {
                Timestamp createdTs = rs.getTimestamp("created_at");
                return new FailedS3CleanupTask(
                        rs.getLong("id"),
                        rs.getString("s3_key"),
                        rs.getString("reason"),
                        rs.getInt("attempt_count"),
                        rs.getInt("max_attempts"),
                        rs.getString("last_error"),
                        createdTs != null ? createdTs.toInstant() : null);
            });
        } catch (RuntimeException ex) {
            return List.of();
        }
    }

    private List<StuckOutboxItem> safeQueryStuckOutboxDetails() {
        List<StuckOutboxItem> items = new ArrayList<>();
        try {
            items.addAll(jdbc.query("""
                    SELECT member_id, attempts, requested_at, next_attempt_at
                    FROM content.member_withdrawal
                    WHERE status = 'PENDING'
                      AND (attempts >= 3 OR requested_at < NOW() - INTERVAL '5 minutes')
                    ORDER BY requested_at ASC
                    LIMIT 10
                    """, (rs, n) -> {
                Timestamp reqTs = rs.getTimestamp("requested_at");
                Timestamp nextTs = rs.getTimestamp("next_attempt_at");
                long mId = rs.getLong("member_id");
                return new StuckOutboxItem(
                        "WITHDRAWAL", mId, mId, rs.getInt("attempts"),
                        reqTs != null ? reqTs.toInstant() : null,
                        nextTs != null ? nextTs.toInstant() : null,
                        null);
            }));
        } catch (RuntimeException ignored) { }

        try {
            items.addAll(jdbc.query("""
                    SELECT member_id, attempts, next_attempt_at
                    FROM content.member_trading_provision
                    WHERE status = 'PENDING'
                      AND (attempts >= 3 OR next_attempt_at < NOW() - INTERVAL '5 minutes')
                    ORDER BY next_attempt_at ASC
                    LIMIT 10
                    """, (rs, n) -> {
                Timestamp nextTs = rs.getTimestamp("next_attempt_at");
                long mId = rs.getLong("member_id");
                return new StuckOutboxItem(
                        "PROVISIONING", mId, mId, rs.getInt("attempts"),
                        null,
                        nextTs != null ? nextTs.toInstant() : null,
                        null);
            }));
        } catch (RuntimeException ignored) { }

        try {
            items.addAll(jdbc.query("""
                    SELECT id, member_id, attempt_count, created_at, next_attempt_at, last_error
                    FROM content.member_suspension_delivery
                    WHERE status = 'PENDING'
                      AND (attempt_count >= 3 OR created_at < NOW() - INTERVAL '5 minutes')
                    ORDER BY created_at ASC
                    LIMIT 10
                    """, (rs, n) -> {
                Timestamp createdTs = rs.getTimestamp("created_at");
                Timestamp nextTs = rs.getTimestamp("next_attempt_at");
                return new StuckOutboxItem(
                        "SUSPENSION", rs.getLong("id"), rs.getLong("member_id"), rs.getInt("attempt_count"),
                        createdTs != null ? createdTs.toInstant() : null,
                        nextTs != null ? nextTs.toInstant() : null,
                        rs.getString("last_error"));
            }));
        } catch (RuntimeException ignored) { }

        return items.size() > 20 ? List.copyOf(items.subList(0, 20)) : List.copyOf(items);
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

    private long safeCount(String sql) {
        try {
            Long value = jdbc.queryForObject(sql, Long.class);
            return value == null ? 0L : value;
        } catch (RuntimeException ex) {
            return 0L;
        }
    }

    private void recordAudit(
            Long adminId,
            String action,
            String targetType,
            String targetId,
            String summary,
            Map<String, Object> detail) {
        if (auditLogs != null) {
            auditLogs.record(adminId, action, targetType, targetId, summary, detail);
        }
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
