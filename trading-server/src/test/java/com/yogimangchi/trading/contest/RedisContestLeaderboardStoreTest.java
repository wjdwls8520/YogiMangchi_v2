package com.yogimangchi.trading.contest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.yogimangchi.trading.contest.ContestDtos.LeaderboardEntry;
import com.yogimangchi.trading.contest.ContestDtos.PublicSeasonsOverviewResponse;
import com.yogimangchi.trading.contest.ContestDtos.SeasonView;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class RedisContestLeaderboardStoreTest {

    @Test
    @SuppressWarnings("unchecked")
    void writesReadsAndEvictsContestSeasonsAndLeaderboardInRedis() {
        Map<String, String> backing = new HashMap<>();
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        org.mockito.Mockito.doAnswer(inv -> {
            backing.put(inv.getArgument(0), inv.getArgument(1));
            return null;
        }).when(ops).set(any(), any(), any());
        when(ops.get(any())).thenAnswer(inv -> backing.get(inv.getArgument(0)));
        when(redis.delete(anyList())).thenAnswer(inv -> {
            List<String> keys = inv.getArgument(0);
            keys.forEach(backing::remove);
            return (long) keys.size();
        });

        ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());
        RedisContestLeaderboardStore store = new RedisContestLeaderboardStore(redis, mapper);

        Instant now = Instant.parse("2026-11-11T00:00:00Z");
        SeasonView season = new SeasonView(
                2L, "제2회 실전 대회", "설명", "10000",
                now.minusSeconds(3600), now.plusSeconds(3600),
                now.minusSeconds(1800), now.plusSeconds(7200),
                true, false, null, "LIVE", "대회 진행중",
                2L, 0L, 0L, 1L, now, now);
        PublicSeasonsOverviewResponse overview = new PublicSeasonsOverviewResponse(
                List.of(), List.of(season), List.of(), List.of(season));

        assertThat(store.writePublicSeasons(overview)).isTrue();
        PublicSeasonsOverviewResponse readOverview = store.readPublicSeasons();
        assertThat(readOverview).isNotNull();
        assertThat(readOverview.running()).hasSize(1);
        assertThat(readOverview.running().get(0).title()).isEqualTo("제2회 실전 대회");

        List<LeaderboardEntry> entries = List.of(
                new LeaderboardEntry(1, 10L, 1L, "안녕4", 34L, "10000", "11250", "10500", "500", "750", "12.5", 1L, false, null, 3L, "66.7%"),
                new LeaderboardEntry(2, 11L, 2L, "트레이더2", 35L, "10000", "10100", "10100", "100", "0", "1", 0L, false, null, 1L, "100.0%"));
        assertThat(store.writeLeaderboard(2L, entries, false)).isTrue();
        verify(ops).set(eq("trading:contest:v1:leaderboard:2"), any(), eq(RedisContestLeaderboardStore.LIVE_LEADERBOARD_TTL));

        var snapshot = store.readLeaderboard(2L);
        assertThat(snapshot).isNotNull();
        assertThat(snapshot.entries()).hasSize(2);
        assertThat(snapshot.entries().get(0).nickname()).isEqualTo("안녕4");
        assertThat(snapshot.entries().get(0).roiPct()).isEqualTo("12.5");

        store.evictSeason(2L);
        assertThat(store.readPublicSeasons()).isNull();
        assertThat(store.readLeaderboard(2L)).isNull();
    }
}
