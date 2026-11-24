package com.yogimangchi.trading.contest;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.contest.ContestDtos.LeaderboardEntry;
import com.yogimangchi.trading.contest.ContestDtos.PublicSeasonsOverviewResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Shared Redis snapshot store for public contest season catalogs and real-time ranked leaderboards.
 * PostgreSQL remains the authoritative financial ledger; Redis serves low-latency ranked snapshots.
 */
@Component
public class RedisContestLeaderboardStore {

    private static final Logger log = LoggerFactory.getLogger(RedisContestLeaderboardStore.class);
    public static final String PUBLIC_SEASONS_KEY = "trading:contest:v1:public-seasons";
    public static final String LEADERBOARD_KEY_PREFIX = "trading:contest:v1:leaderboard:";
    public static final Duration PUBLIC_SEASONS_TTL = Duration.ofSeconds(5);
    public static final Duration LIVE_LEADERBOARD_TTL = Duration.ofSeconds(5);
    public static final Duration SETTLED_LEADERBOARD_TTL = Duration.ofSeconds(60);

    public record ContestLeaderboardSnapshot(
            long seasonId,
            Instant updatedAt,
            List<LeaderboardEntry> entries
    ) { }

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    @Autowired
    public RedisContestLeaderboardStore(RedisConnectionFactory connections, ObjectMapper mapper) {
        this(new StringRedisTemplate(connections), mapper);
    }

    RedisContestLeaderboardStore(StringRedisTemplate redis, ObjectMapper mapper) {
        this.redis = redis;
        this.mapper = mapper;
    }

    public static String leaderboardKey(long seasonId) {
        return LEADERBOARD_KEY_PREFIX + seasonId;
    }

    public boolean writePublicSeasons(PublicSeasonsOverviewResponse overview) {
        if (overview == null) {
            return false;
        }
        try {
            String payload = mapper.writeValueAsString(overview);
            redis.opsForValue().set(PUBLIC_SEASONS_KEY, payload, PUBLIC_SEASONS_TTL);
            return true;
        } catch (JsonProcessingException | DataAccessException exception) {
            log.debug("[Redis contest seasons] write unavailable: {}", exception.getClass().getSimpleName());
            return false;
        }
    }

    public PublicSeasonsOverviewResponse readPublicSeasons() {
        try {
            String raw = redis.opsForValue().get(PUBLIC_SEASONS_KEY);
            if (raw == null || raw.isBlank()) {
                return null;
            }
            return mapper.readValue(raw, PublicSeasonsOverviewResponse.class);
        } catch (JsonProcessingException | IllegalArgumentException | DataAccessException exception) {
            log.debug("[Redis contest seasons] read unavailable: {}", exception.getClass().getSimpleName());
            return null;
        }
    }

    public boolean writeLeaderboard(long seasonId, List<LeaderboardEntry> entries, boolean settled) {
        if (seasonId <= 0 || entries == null) {
            return false;
        }
        Duration ttl = settled ? SETTLED_LEADERBOARD_TTL : LIVE_LEADERBOARD_TTL;
        try {
            ContestLeaderboardSnapshot snapshot = new ContestLeaderboardSnapshot(
                    seasonId,
                    Instant.now(),
                    List.copyOf(entries));
            String payload = mapper.writeValueAsString(snapshot);
            redis.opsForValue().set(leaderboardKey(seasonId), payload, ttl);
            return true;
        } catch (JsonProcessingException | DataAccessException exception) {
            log.debug("[Redis contest leaderboard] write unavailable seasonId={}: {}",
                    seasonId, exception.getClass().getSimpleName());
            return false;
        }
    }

    public ContestLeaderboardSnapshot readLeaderboard(long seasonId) {
        if (seasonId <= 0) {
            return null;
        }
        try {
            String raw = redis.opsForValue().get(leaderboardKey(seasonId));
            if (raw == null || raw.isBlank()) {
                return null;
            }
            ContestLeaderboardSnapshot parsed = mapper.readValue(raw, ContestLeaderboardSnapshot.class);
            if (parsed == null || parsed.seasonId() != seasonId || parsed.entries() == null) {
                return null;
            }
            return parsed;
        } catch (JsonProcessingException | IllegalArgumentException | DataAccessException exception) {
            log.debug("[Redis contest leaderboard] read unavailable seasonId={}: {}",
                    seasonId, exception.getClass().getSimpleName());
            return null;
        }
    }

    public void evictSeason(long seasonId) {
        runAndAfterCommit(() -> {
            try {
                if (seasonId > 0) {
                    redis.delete(List.of(PUBLIC_SEASONS_KEY, leaderboardKey(seasonId)));
                } else {
                    redis.delete(PUBLIC_SEASONS_KEY);
                }
            } catch (DataAccessException exception) {
                log.debug("[Redis contest leaderboard] evict unavailable seasonId={}: {}",
                        seasonId, exception.getClass().getSimpleName());
            }
        });
    }

    public void evictPublicSeasons() {
        evictSeason(0L);
    }

    private void runAndAfterCommit(Runnable eviction) {
        eviction.run();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    eviction.run();
                }
            });
        }
    }
}
