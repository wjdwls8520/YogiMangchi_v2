package com.yogimangchi.trading.marketdata.websocket;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.marketdata.MarketDataFanout;
import com.yogimangchi.trading.tradingsymbol.dto.TradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.service.TradingSymbolService;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class MarketWebSocketHandlerTests {
    @Test
    void duplicateSubscribeReflectsLocalDisconnectBeforeAsynchronousStatusDelivery() throws Exception {
        var mapper = new ObjectMapper().findAndRegisterModules();
        var prices = new LatestPriceStore();
        prices.beginSubscription(Set.of(1L));
        prices.update(new LatestMarkPrice(1L, new BigDecimal("100"), Instant.now(), Instant.now()));
        var symbols = mock(TradingSymbolService.class);
        when(symbols.findActiveSymbols()).thenReturn(List.of(new TradingSymbolResponse(1L, "BTC", "Bitcoin", "USDT")));
        var session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("duplicate-subscription");
        var frames = new CopyOnWriteArrayList<JsonNode>();
        doAnswer(invocation -> {
            frames.add(mapper.readTree(((TextMessage) invocation.getArgument(0)).getPayload()));
            return null;
        }).when(session).sendMessage(any());
        var fanout = new MarketDataFanout();
        var handler = new MarketWebSocketHandler(mapper, symbols, prices, fanout, mock(ObjectProvider.class));
        try {
            // No fanout listener is started: simulate status delivery lag while the local state is definitive.
            handler.afterConnectionEstablished(session);
            var subscribe = new TextMessage("{\"type\":\"SUBSCRIBE\",\"tradingSymbolIds\":[1]}");
            handler.handleTextMessage(session, subscribe);
            await().atMost(Duration.ofSeconds(2)).until(() -> frames.stream()
                    .anyMatch(frame -> frame.path("type").asText().equals("SNAPSHOT")));
            prices.markUnavailable();
            handler.handleTextMessage(session, subscribe);
            await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
                var snapshots = frames.stream().filter(frame -> frame.path("type").asText().equals("SNAPSHOT")).toList();
                assertThat(snapshots).hasSize(2);
                assertThat(snapshots.get(0).at("/prices/0/status").asText()).isEqualTo("FRESH");
                assertThat(snapshots.get(1).at("/prices/0/status").asText()).isEqualTo("UNAVAILABLE");
            });
        } finally {
            handler.stop();
            fanout.close();
        }
    }
}
