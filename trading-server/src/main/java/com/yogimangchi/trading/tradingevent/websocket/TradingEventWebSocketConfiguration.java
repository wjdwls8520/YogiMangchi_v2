package com.yogimangchi.trading.tradingevent.websocket;

import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.*;

@Configuration(proxyBeanMethods=false)
public class TradingEventWebSocketConfiguration implements WebSocketConfigurer {
    private final TradingEventWebSocketHandler handler;
    private final String[] origins;
    public TradingEventWebSocketConfiguration(TradingEventWebSocketHandler handler,
            @Value("${marketdata.websocket.allowed-origins:http://localhost:3000,http://127.0.0.1:3000}") String allowed) {
        this.handler=handler;
        origins=Arrays.stream(allowed.split(",")).map(String::trim).filter(s -> !s.isBlank()).toArray(String[]::new);
        if(origins.length==0 || Arrays.stream(origins).anyMatch(s -> s.contains("*"))) throw new IllegalArgumentException("Trading stream requires explicit origins");
    }
    @Override public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler,"/ws/trading").setAllowedOrigins(origins);
    }
}
