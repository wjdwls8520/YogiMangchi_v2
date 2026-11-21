package com.yogimangchi.content.ops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.yogimangchi.content.community.CommunityService;
import com.yogimangchi.content.community.CommunityUxSseService;
import com.yogimangchi.content.community.TradingPositionVerifier;
import com.yogimangchi.content.error.AuthFailure;
import com.yogimangchi.content.news.NewsSseService;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class Pass2HardeningUnitTests {

    @Test
    void tradingPositionVerifierConfirmsOwnedOpenPositionAndRejectsSpoofingOrUnreachableServer() throws Exception {
        ObjectMapper json = new ObjectMapper();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        try {
            server.createContext("/api/v1/symbols", exchange -> {
                byte[] body = """
                        [{"id":1,"symbol":"BTCUSDT"},{"id":2,"symbol":"ETHUSDT"}]
                        """.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(body);
                }
            });
            server.createContext("/api/v1/trading/account/summary", exchange -> {
                String authHeader = exchange.getRequestHeaders().getFirst("Authorization");
                if (!"Bearer valid-member-jwt".equals(authHeader)) {
                    exchange.sendResponseHeaders(401, -1);
                    exchange.close();
                    return;
                }
                byte[] body = """
                        {
                          "accountId": 100,
                          "status": "ACTIVE",
                          "positions": [
                            {
                              "id": 42,
                              "tradingSymbolId": 1,
                              "side": "LONG",
                              "leverage": 20,
                              "entryPrice": "90000.00",
                              "markPrice": "94500.00",
                              "liquidationPrice": "85500.00",
                              "margin": "500.00",
                              "unrealizedPnl": "250.00",
                              "status": "OPEN"
                            }
                          ]
                        }
                        """.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(body);
                }
            });
            server.createContext("/api/v1/trading/contest/seasons/7/account/summary", exchange -> {
                byte[] body = """
                        {
                          "accountId": 200,
                          "status": "ACTIVE",
                          "positions": [
                            {
                              "id": 99,
                              "tradingSymbolId": 2,
                              "side": "SHORT",
                              "leverage": 10,
                              "entryPrice": "3200.00",
                              "markPrice": "3100.00",
                              "liquidationPrice": "3500.00",
                              "margin": "400.00",
                              "unrealizedPnl": "100.00",
                              "status": "OPEN"
                            }
                          ]
                        }
                        """.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(body);
                }
            });
            server.start();

            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            TradingPositionVerifier verifier = new TradingPositionVerifier(baseUrl, 1500, json);

            // 1. Matching owned open position -> verified=true with authoritative server values overwriting spoofed PnL/leverage!
            var spoofedNumbers = new CommunityService.SharedPositionSnapshot(
                    "MOCK_POS_42", "모의투자 선물", "BTC", "BTCUSDT", "LONG", 50,
                    "1.00", "999999.00", "-", "+99999.00%", "+999999.00 USDT", true, true, true);
            var confirmed = verifier.verify(1L, "valid-member-jwt", spoofedNumbers);
            assertThat(confirmed.verified()).isTrue();
            assertThat(confirmed.snapshot().verified()).isTrue();
            assertThat(confirmed.snapshot().leverage()).isEqualTo(20);
            assertThat(confirmed.snapshot().entryPrice()).isEqualTo("90000.00");
            assertThat(confirmed.snapshot().markPrice()).isEqualTo("94500.00");
            assertThat(confirmed.snapshot().roePct()).isEqualTo("+50.00%");
            assertThat(confirmed.snapshot().pnlUsdt()).isEqualTo("+250.00 USDT");

            // 2. Wrong positionId / wrong side / wrong symbol / bad token -> verified=false
            var wrongId = new CommunityService.SharedPositionSnapshot(
                    "MOCK_POS_999", "모의투자 선물", "BTC", "BTCUSDT", "LONG", 20,
                    "90000", "94500", "85500", "+50%", "+250 USDT", true, true, true);
            assertThat(verifier.verify(1L, "valid-member-jwt", wrongId).verified()).isFalse();

            var wrongSide = new CommunityService.SharedPositionSnapshot(
                    "MOCK_POS_42", "모의투자 선물", "BTC", "BTCUSDT", "SHORT", 20,
                    "90000", "94500", "85500", "+50%", "+250 USDT", true, true, true);
            assertThat(verifier.verify(1L, "valid-member-jwt", wrongSide).verified()).isFalse();

            var wrongSymbol = new CommunityService.SharedPositionSnapshot(
                    "MOCK_POS_42", "모의투자 선물", "ETH", "ETHUSDT", "LONG", 20,
                    "90000", "94500", "85500", "+50%", "+250 USDT", true, true, true);
            assertThat(verifier.verify(1L, "valid-member-jwt", wrongSymbol).verified()).isFalse();

            assertThat(verifier.verify(1L, "invalid-jwt", spoofedNumbers).verified()).isFalse();
            assertThat(verifier.verify(1L, null, spoofedNumbers).verified()).isFalse();

            // 3. Contest position CONTEST_7_POS_99 verified against contest summary
            var contestReq = new CommunityService.SharedPositionSnapshot(
                    "CONTEST_7_POS_99", "시즌 7", "ETH", "ETHUSDT", "SHORT", 10,
                    "3200", "3100", "3500", "+25%", "+100 USDT", true, false, true);
            var contestResult = verifier.verify(1L, "valid-member-jwt", contestReq);
            assertThat(contestResult.verified()).isTrue();
            assertThat(contestResult.snapshot().id()).isEqualTo("CONTEST_7_POS_99");
            assertThat(contestResult.snapshot().roePct()).isEqualTo("+25.00%");
            assertThat(contestResult.snapshot().showPnlAmount()).isFalse();

            // 4. Leverage > 100 rejected immediately with 400 INVALID_REQUEST
            var overLeveraged = new CommunityService.SharedPositionSnapshot(
                    "MOCK_POS_42", "모의투자 선물", "BTC", "BTCUSDT", "LONG", 101,
                    "90000", "94500", "85500", "+50%", "+250 USDT", true, true, true);
            assertThatThrownBy(() -> verifier.verify(1L, "valid-member-jwt", overLeveraged))
                    .isInstanceOf(AuthFailure.class);
        } finally {
            server.stop(0);
        }

        // 5. Unconfigured base URL safely returns verified=false without I/O
        TradingPositionVerifier offline = new TradingPositionVerifier("", 1500, json);
        var req = new CommunityService.SharedPositionSnapshot(
                "MOCK_POS_42", "모의투자 선물", "BTC", "BTCUSDT", "LONG", 10,
                "90000", "91000", "-", "+10%", "+50 USDT", true, true, true);
        assertThat(offline.verify(1L, "valid-member-jwt", req).verified()).isFalse();
    }

    @Test
    void newsSseServiceEnforcesMaxEmitterCapPrunesDeadEmittersOnHeartbeatAndCleansUpOnShutdown() {
        List<ControllableEmitter> created = new ArrayList<>();
        NewsSseService sse = new NewsSseService(false, 6, 3) {
            @Override
            protected SseEmitter newEmitter() {
                ControllableEmitter e = new ControllableEmitter();
                created.add(e);
                return e;
            }
        };
        try {
            // Subscribe 5 times with cap=3 -> oldest 2 evicted & completed, count stays 3
            for (int i = 0; i < 5; i++) {
                sse.subscribe();
            }
            assertThat(sse.activeConnectionCount()).isEqualTo(3);
            assertThat(created.get(0).completed.get()).isTrue();
            assertThat(created.get(1).completed.get()).isTrue();
            assertThat(created.get(2).completed.get()).isFalse();

            // Mark emitter #2 as broken -> heartbeat prunes it cleanly while pinging #3 and #4
            created.get(2).failNextSend.set(true);
            sse.sendHeartbeat();
            assertThat(sse.activeConnectionCount()).isEqualTo(2);
            assertThat(created.get(3).sendCount.get()).isGreaterThanOrEqualTo(2);
            assertThat(created.get(4).sendCount.get()).isGreaterThanOrEqualTo(2);

            // @PreDestroy shutdown completes and clears remaining emitters
            sse.shutdown();
            assertThat(sse.activeConnectionCount()).isZero();
            assertThat(created.get(3).completed.get()).isTrue();
            assertThat(created.get(4).completed.get()).isTrue();
        } finally {
            sse.shutdown();
        }
    }

    @Test
    void communityUxSseServiceEnforcesMaxEmitterCapPrunesDeadEmittersOnHeartbeatAndCleansUpOnShutdown() {
        List<ControllableEmitter> created = new ArrayList<>();
        CommunityUxSseService sse = new CommunityUxSseService(3) {
            @Override
            protected SseEmitter newEmitter() {
                ControllableEmitter e = new ControllableEmitter();
                created.add(e);
                return e;
            }
        };
        try {
            for (int i = 0; i < 5; i++) {
                sse.subscribeFeed();
            }
            assertThat(sse.activeConnectionCount()).isEqualTo(3);
            assertThat(created.get(0).completed.get()).isTrue();
            assertThat(created.get(1).completed.get()).isTrue();

            created.get(2).failNextSend.set(true);
            sse.sendHeartbeat();
            assertThat(sse.activeConnectionCount()).isEqualTo(2);
            assertThat(created.get(3).sendCount.get()).isGreaterThanOrEqualTo(2);
            assertThat(created.get(4).sendCount.get()).isGreaterThanOrEqualTo(2);

            sse.shutdown();
            assertThat(sse.activeConnectionCount()).isZero();
            assertThat(created.get(3).completed.get()).isTrue();
            assertThat(created.get(4).completed.get()).isTrue();
        } finally {
            sse.shutdown();
        }
    }

    private static final class ControllableEmitter extends SseEmitter {
        final AtomicBoolean completed = new AtomicBoolean(false);
        final AtomicBoolean failNextSend = new AtomicBoolean(false);
        final AtomicInteger sendCount = new AtomicInteger(0);

        ControllableEmitter() {
            super(60_000L);
        }

        @Override
        public void send(SseEventBuilder builder) throws IOException {
            if (failNextSend.get()) {
                throw new IOException("Broken pipe");
            }
            sendCount.incrementAndGet();
        }

        @Override
        public synchronized void complete() {
            completed.set(true);
            super.complete();
        }
    }
}
