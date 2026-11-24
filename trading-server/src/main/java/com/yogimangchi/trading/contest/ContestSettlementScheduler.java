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

@Component
public class ContestSettlementScheduler {
    private static final Logger log = LoggerFactory.getLogger(ContestSettlementScheduler.class);

    private final JdbcTemplate jdbc;
    private final ContestSettlementService settlementService;
    private final boolean enabled;

    public ContestSettlementScheduler(
            JdbcTemplate jdbc,
            ContestSettlementService settlementService,
            @Value("${trading.contest.auto-settlement-enabled:true}") boolean enabled) {
        this.jdbc = jdbc;
        this.settlementService = settlementService;
        this.enabled = enabled;
    }

    @Scheduled(
            fixedDelayString = "${trading.contest.settlement-interval-ms:60000}",
            initialDelayString = "${trading.contest.settlement-initial-delay-ms:15000}")
    public void settleExpiredSeasonsScheduled() {
        if (!enabled) {
            return;
        }
        settleDueSeasons(Instant.now());
    }

    public int settleDueSeasons(Instant now) {
        List<Long> dueSeasonIds = jdbc.queryForList("""
                SELECT id
                FROM trading.contest_season
                WHERE contest_end_at <= ?
                  AND settled_at IS NULL
                  AND is_canceled = false
                ORDER BY contest_end_at ASC, id ASC
                LIMIT 20
                """, Long.class, now.atOffset(ZoneOffset.UTC));

        int settledCount = 0;
        for (Long seasonId : dueSeasonIds) {
            try {
                settlementService.settleSeason(seasonId, "SYSTEM_SCHEDULER", false);
                settledCount++;
            } catch (Exception ex) {
                log.warn("[Contest scheduler] failed to settle due seasonId={}", seasonId, ex);
            }
        }
        return settledCount;
    }
}
