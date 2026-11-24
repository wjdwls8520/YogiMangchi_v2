package com.yogimangchi.trading.marketdata.overview;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** Shared Redis store for display-only global market overview and live USD/KRW exchange rate. */
@Component
public class RedisMarketOverviewStore {

    private static final Logger log = LoggerFactory.getLogger(RedisMarketOverviewStore.class);
    public static final String OVERVIEW_KEY = "trading:market:v1:overview";
    public static final Duration TTL = Duration.ofMinutes(5);

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    @Autowired
    public RedisMarketOverviewStore(RedisConnectionFactory connections, ObjectMapper mapper) {
        this(new StringRedisTemplate(connections), mapper);
    }

    RedisMarketOverviewStore(StringRedisTemplate redis, ObjectMapper mapper) {
        this.redis = redis;
        this.mapper = mapper;
    }

    public boolean write(MarketOverviewSnapshot snapshot) {
        if (snapshot == null) {
            return false;
        }
        try {
            String payload = mapper.writeValueAsString(snapshot);
            redis.opsForValue().set(OVERVIEW_KEY, payload, TTL);
            return true;
        } catch (JsonProcessingException | DataAccessException exception) {
            log.warn("[Redis market overview] write unavailable: {}", exception.getClass().getSimpleName());
            return false;
        }
    }

    public MarketOverviewSnapshot read() {
        try {
            return parse(redis.opsForValue().get(OVERVIEW_KEY));
        } catch (DataAccessException exception) {
            log.debug("[Redis market overview] read unavailable: {}", exception.getClass().getSimpleName());
            return null;
        }
    }

    public MarketOverviewSnapshot parse(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return mapper.readValue(json, MarketOverviewSnapshot.class);
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            log.debug("[Redis market overview] invalid snapshot JSON: {}", exception.getClass().getSimpleName());
            return null;
        }
    }
}
