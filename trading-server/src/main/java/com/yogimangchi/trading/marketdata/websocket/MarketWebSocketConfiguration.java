package com.yogimangchi.trading.marketdata.websocket;

import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration(proxyBeanMethods = false)
@EnableWebSocket
public class MarketWebSocketConfiguration implements WebSocketConfigurer {
    private final MarketWebSocketHandler handler;
    private final String[] allowedOrigins;

    public MarketWebSocketConfiguration(MarketWebSocketHandler handler,
            @Value("${marketdata.websocket.allowed-origins:http://localhost:5173,http://127.0.0.1:5173}") String origins) {
        this.handler = handler;
        this.allowedOrigins = Arrays.stream(origins.split(",")).map(String::trim)
                .filter(origin -> !origin.isBlank()).toArray(String[]::new);
        if (allowedOrigins.length == 0 || Arrays.stream(allowedOrigins).anyMatch(origin -> origin.contains("*"))) {
            throw new IllegalArgumentException("WebSocket origins must list explicit allowed origins");
        }
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws/market").setAllowedOrigins(allowedOrigins);
    }
}
