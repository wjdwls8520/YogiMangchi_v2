package com.yogimangchi.trading.contest;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Periodically recomputes active public contest leaderboards against live Redis mark prices
 * and publishes ranked snapshots into {@link RedisContestLeaderboardStore}.
 */
@Component
public class ContestLeaderboardScheduler {

    private static final Logger log = LoggerFactory.getLogger(ContestLeaderboardScheduler.class);

    private final JdbcTemplate jdbc;
    private final ContestService contestService;
    private final boolean enabled;

    public ContestLeaderboardScheduler(
            JdbcTemplate jdbc,
            ContestService contestService,
            @Value("${trading.contest.leaderboard-refresh-enabled:true}") boolean enabled) {
        this.jdbc = jdbc;
        this.contestService = contestService;
        this.enabled = enabled;
    }

    @Scheduled(
            fixedDelayString = "${trading.contest.leaderboard-refresh-ms:2000}",
            initialDelayString = "${trading.contest.leaderboard-initial-delay-ms:2000}")
    public void refreshActiveLeaderboardsScheduled() {
        if (!enabled) {
            return;
        }
        refreshActiveLeaderboards(Instant.now());
    }

    public int refreshActiveLeaderboards(Instant now) {
        var tsNow = now.atOffset(ZoneOffset.UTC);
        List<Long> activeSeasonIds = jdbc.queryForList("""
                SELECT id
                FROM trading.contest_season
                WHERE is_public = true
                  AND is_canceled = false
                  AND settled_at IS NULL
                  AND contest_start_at <= ?
                  AND contest_end_at >= ?
                ORDER BY contest_start_at DESC, id DESC
                LIMIT 20
                """, Long.class, tsNow, tsNow);

        int refreshed = 0;
        try {
            contestService.refreshPublicSeasonsSnapshot();
        } catch (Exception ex) {
            log.debug("[Contest leaderboard scheduler] failed to refresh public seasons snapshot", ex);
        }

        for (Long seasonId : activeSeasonIds) {
            try {
                contestService.refreshLeaderboardSnapshot(seasonId);
                refreshed++;
            } catch (Exception ex) {
                log.debug("[Contest leaderboard scheduler] failed to refresh seasonId={}", seasonId, ex);
            }
        }
        return refreshed;
    }
}
