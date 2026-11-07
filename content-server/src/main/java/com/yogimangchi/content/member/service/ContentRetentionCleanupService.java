package com.yogimangchi.content.member.service;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ContentRetentionCleanupService {
    private final JdbcTemplate jdbc;
    private final boolean enabled;
    private final Duration retentionDuration;
    private final int batchSize;

    public ContentRetentionCleanupService(
            JdbcTemplate jdbc,
            @Value("${content.retention.enabled:true}") boolean enabled,
            @Value("${content.retention.duration:PT720H}") Duration retentionDuration,
            @Value("${content.retention.batch-size:500}") int batchSize) {
        if (retentionDuration == null || retentionDuration.isNegative() || retentionDuration.isZero()) {
            throw new IllegalArgumentException("content.retention.duration must be positive");
        }
        this.jdbc = jdbc;
        this.enabled = enabled;
        this.retentionDuration = retentionDuration;
        this.batchSize = Math.max(1, Math.min(5000, batchSize));
    }

    @Scheduled(fixedDelayString = "${content.retention.fixed-delay-ms:3600000}", initialDelayString = "${content.retention.initial-delay-ms:60000}")
    public void purgeExpiredScheduled() {
        if (!enabled) return;
        purgeExpired(Instant.now());
    }

    @Transactional(timeout = 5)
    public ContentPurgeResult purgeExpired(Instant now) {
        Instant effectiveNow = now == null ? Instant.now() : now;
        Timestamp cutoff = Timestamp.from(effectiveNow.minus(retentionDuration));
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
        return new ContentPurgeResult(purgedRefreshSessions, purgedProvisions);
    }
}
