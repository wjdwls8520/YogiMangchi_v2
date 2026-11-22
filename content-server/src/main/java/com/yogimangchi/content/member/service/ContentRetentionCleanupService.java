package com.yogimangchi.content.member.service;

import com.yogimangchi.content.community.CommunityS3Service;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ContentRetentionCleanupService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final JdbcTemplate jdbc;
    private final CommunityS3Service s3;
    private final boolean enabled;
    private final Duration retentionDuration;
    private final int batchSize;

    public ContentRetentionCleanupService(
            JdbcTemplate jdbc,
            boolean enabled,
            Duration retentionDuration,
            int batchSize) {
        this(jdbc, null, enabled, retentionDuration, batchSize);
    }

    @Autowired
    public ContentRetentionCleanupService(
            JdbcTemplate jdbc,
            @Autowired(required = false) CommunityS3Service s3,
            @Value("${content.retention.enabled:true}") boolean enabled,
            @Value("${content.retention.duration:PT720H}") Duration retentionDuration,
            @Value("${content.retention.batch-size:500}") int batchSize) {
        if (retentionDuration == null || retentionDuration.isNegative() || retentionDuration.isZero()) {
            throw new IllegalArgumentException("content.retention.duration must be positive");
        }
        this.jdbc = jdbc;
        this.s3 = s3;
        this.enabled = enabled;
        this.retentionDuration = retentionDuration;
        this.batchSize = Math.max(1, Math.min(5000, batchSize));
    }

    @Scheduled(fixedDelayString = "${content.retention.fixed-delay-ms:3600000}", initialDelayString = "${content.retention.initial-delay-ms:60000}")
    public void purgeExpiredScheduled() {
        if (!enabled) return;
        purgeExpired(Instant.now());
    }

    @Transactional(timeout = 10)
    public ContentPurgeResult purgeExpired(Instant now) {
        Instant effectiveNow = now == null ? Instant.now() : now;
        Timestamp cutoff = Timestamp.from(effectiveNow.minus(retentionDuration));
        Timestamp softDeleteAttachmentCutoff = Timestamp.from(effectiveNow.minus(Duration.ofDays(30)));
        Timestamp notificationCutoff = Timestamp.from(effectiveNow.minus(Duration.ofDays(90)));
        LocalDate kstToday = effectiveNow.atZone(KST).toLocalDate();

        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        int purgedRefreshSessions = jdbc.update(
                "delete from content.refresh_session where id in ("
                        + "select id from content.refresh_session where expires_at < ? order by expires_at asc, id asc limit ? for update skip locked"
                        + ")",
                cutoff, batchSize);
        int purgedProvisions = jdbc.update(
                "delete from content.member_trading_provision where member_id in ("
                        + "select member_id from content.member_trading_provision where status in ('COMPLETED','CANCELED') and next_attempt_at < ? order by next_attempt_at asc, member_id asc limit ? for update skip locked"
                        + ")",
                cutoff, batchSize);

        // Completed suspension outbox rows older than retention duration
        jdbc.update(
                "delete from content.member_suspension_delivery where id in ("
                        + "select id from content.member_suspension_delivery "
                        + "where status = 'COMPLETED' and completed_at is not null and completed_at < ? "
                        + "order by completed_at asc, id asc limit ? for update skip locked"
                        + ")",
                cutoff, batchSize);

        // 30-day permanent attachment purge ONLY for soft-deleted posts older than 30 days
        List<String> expiredAttachmentKeys = jdbc.queryForList(
                "delete from content.community_post_file where id in ("
                        + "select f.id from content.community_post_file f "
                        + "join content.community_post p on p.id = f.post_id "
                        + "where p.deleted_at is not null and p.deleted_at < ? "
                        + "order by p.deleted_at asc, f.id asc limit ? for update of f skip locked"
                        + ") returning s3_key",
                String.class,
                softDeleteAttachmentCutoff, batchSize);
        List<String> validKeys = expiredAttachmentKeys.stream()
                .filter(k -> k != null && !k.isBlank())
                .toList();
        if (s3 != null && !validKeys.isEmpty()) {
            s3.registerAfterCommitDelete(validKeys, "SOFT_DELETED_POST_RETENTION_30D");
        }

        // 14-day retention cleanup for daily community post view dedupe table
        jdbc.update(
                "delete from content.community_post_viewer_daily where viewed_date < ?",
                Date.valueOf(kstToday.minusDays(14)));

        // Retention cleanup for anonymous daily news views (moved from NewsIngestionService)
        jdbc.update(
                "delete from content.news_article_anon_daily_view where viewed_date < ?",
                Date.valueOf(kstToday.minusDays(2)));

        // 90-day retention purge for old notifications & notification dedupe state
        jdbc.update(
                "delete from content.notification where id in ("
                        + "select id from content.notification where created_at < ? "
                        + "order by created_at asc, id asc limit ? for update skip locked"
                        + ")",
                notificationCutoff, batchSize);
        jdbc.update(
                "delete from content.notification_dedupe_state where id in ("
                        + "select id from content.notification_dedupe_state where last_notified_at < ? "
                        + "order by last_notified_at asc, id asc limit ? for update skip locked"
                        + ")",
                notificationCutoff, batchSize);

        // News breaking 6-hour & overflow retention
        Timestamp breakingCutoff = Timestamp.from(effectiveNow.minus(Duration.ofHours(6)));
        jdbc.update(
                "delete from content.news_article where id in ("
                        + "select id from content.news_article "
                        + "where section = 'BREAKING' and id > 20 "
                        + "and external_hash is not null and external_hash not like 'seed-%' and published_at < ? "
                        + "order by published_at asc, id asc limit ? for update skip locked"
                        + ")",
                breakingCutoff, batchSize);
        jdbc.update(
                "delete from content.news_article where id in ("
                        + "select id from content.news_article "
                        + "where id > 20 and external_hash is not null and external_hash not like 'seed-%' and published_at < ? "
                        + "order by published_at asc, id asc limit ? for update skip locked"
                        + ")",
                cutoff, batchSize);
        jdbc.update(
                "delete from content.news_article where id in ("
                        + "select id from content.news_article "
                        + "where id > 20 and external_hash is not null and external_hash not like 'seed-%' "
                        + "order by id desc offset 1000 limit ? for update skip locked"
                        + ")",
                batchSize);
        return new ContentPurgeResult(purgedRefreshSessions, purgedProvisions);
    }
}
