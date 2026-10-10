package com.yogimangchi.trading.marketdata;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/** Versioned domain-unit event shared through Redis. Provider contract names never cross this boundary. */
public record MarketDataEvent(int version, String eventId, Type type, Set<Long> tradingSymbolIds,
                              LatestMarkPrice price, Instant occurredAt) {
    public enum Type { PRICE, RECONNECTING, UNAVAILABLE }

    public MarketDataEvent {
        tradingSymbolIds = Set.copyOf(tradingSymbolIds);
        if (version != 1 || eventId == null || type == null || occurredAt == null
                || tradingSymbolIds.stream().anyMatch(id -> id == null || id <= 0)
                || (type == Type.PRICE && (price == null
                    || !tradingSymbolIds.equals(Set.of(price.tradingSymbolId()))))
                || (type != Type.PRICE && price != null)) {
            throw new IllegalArgumentException("Invalid market data event");
        }
    }

    public static MarketDataEvent price(LatestMarkPrice price) {
        return new MarketDataEvent(1, UUID.randomUUID().toString(), Type.PRICE,
                Set.of(price.tradingSymbolId()), price, price.receivedAt());
    }

    public static MarketDataEvent state(Type type, Set<Long> ids, Instant now) {
        return new MarketDataEvent(1, UUID.randomUUID().toString(), type, ids, null, now);
    }
}
