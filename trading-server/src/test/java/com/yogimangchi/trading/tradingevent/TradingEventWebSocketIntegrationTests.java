package com.yogimangchi.trading.tradingevent;

import com.fasterxml.jackson.databind.*;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.dto.GuestAccountResponse;
import com.yogimangchi.trading.tradingaccount.service.TradingAccountService;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(PostgresTestConfiguration.class)
class TradingEventWebSocketIntegrationTests {
    @LocalServerPort int port;
    @Autowired ObjectMapper mapper;
    @Autowired TradingAccountService accounts;
    @Autowired TradingOrderService orders;
    @Autowired LatestPriceStore prices;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;
    @MockitoBean TradingEngineGate gate;
    final List<Client> connections=new ArrayList<>();
    GuestAccountResponse guest;
    long btc;
    @BeforeEach void setup() {
        guest=accounts.createGuest();
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc));
        Instant now=Instant.now(); assertThat(prices.update(new LatestMarkPrice(btc,new BigDecimal("1000"),now,now))).isTrue();
    }
    @AfterEach void cleanup() { connections.forEach(c -> c.socket.abort()); prices.markUnavailable(); }

    @Test void anonymousHandshakeNeverCreatesAnAccountOrSendsFinancialData() throws Exception {
        long before=jdbc.queryForObject("select count(*) from trading.trading_account",Long.class);
        open(guest);
        Client client=connect("/ws/trading","http://localhost:3000");
        assertThat(client.next("CONNECTED").path("data").path("authenticationDeadlineSeconds").intValue()).isEqualTo(5);
        assertThat(client.messages.poll(400,TimeUnit.MILLISECONDS)).isNull();
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_account",Long.class)).isEqualTo(before);
    }

    @Test void liveAndReplayedMessagesAreScopedToTheAuthenticatedAccount() throws Exception {
        var other=accounts.createGuest();
        var own=open(guest); open(other);
        Client client=authenticate(guest,"0");
        JsonNode initial=client.next("TRADING_EVENT").path("data");
        assertThat(initial.path("order").path("orderId").longValue()).isEqualTo(own.orderId());
        String cursor=initial.path("eventId").asText();
        assertThat(initial.toString()).doesNotContain(guest.accessToken(),other.accessToken(),"credential_hash");
        var nextOwn=open(guest); open(other);
        JsonNode live=client.next("TRADING_EVENT").path("data");
        assertThat(live.path("order").path("orderId").longValue()).isEqualTo(nextOwn.orderId());
        assertThat(client.messages.poll(400,TimeUnit.MILLISECONDS)).isNull();
        client.socket.abort();
        Client resumed=authenticate(guest,cursor);
        assertThat(resumed.next("TRADING_EVENT").path("data").path("eventId").asText()).isEqualTo(live.path("eventId").asText());
        assertThat(resumed.messages.poll(400,TimeUnit.MILLISECONDS)).isNull();
    }

    @Test void websocketNeverPublishesAnUncommittedOrRolledBackExecution() throws Exception {
        Client client=authenticate(guest,"0");
        var template=new TransactionTemplate(transactions);
        template.executeWithoutResult(status -> {
            open(guest);
            try { assertThat(client.messages.poll(300,TimeUnit.MILLISECONDS)).isNull(); }
            catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
            status.setRollbackOnly();
        });
        assertThat(client.messages.poll(300,TimeUnit.MILLISECONDS)).isNull();
        var committed=template.execute(status -> {
            var order=open(guest);
            try { assertThat(client.messages.poll(300,TimeUnit.MILLISECONDS)).isNull(); }
            catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
            return order;
        });
        assertThat(client.next("TRADING_EVENT").path("data").path("order").path("orderId").longValue()).isEqualTo(committed.orderId());
    }

    @Test void invalidCredentialAndCallerSuppliedAccountIdAreRejected() throws Exception {
        Client invalid=connect("/ws/trading","http://localhost:3000"); invalid.next("CONNECTED");
        invalid.send(mapper.writeValueAsString(Map.of("type","AUTHENTICATE","credential","invalid")));
        assertThat(invalid.closed.get(5,TimeUnit.SECONDS)).isEqualTo(1008);
        Client forged=connect("/ws/trading","http://localhost:3000"); forged.next("CONNECTED");
        forged.send(mapper.writeValueAsString(Map.of("type","AUTHENTICATE","credential",guest.accessToken(),"accountId",guest.accountId())));
        assertThat(forged.closed.get(5,TimeUnit.SECONDS)).isEqualTo(1008);
    }

    @Test void credentialExpiryClosesAnAlreadyAuthenticatedConnection() throws Exception {
        jdbc.update("update trading.trading_account set credential_expires_at=? where id=?",Instant.now().plusSeconds(2).atOffset(ZoneOffset.UTC),guest.accountId());
        Client client=authenticate(guest,"0");
        assertThat(client.closed.get(6,TimeUnit.SECONDS)).isEqualTo(1008);
        open(guest); // A worker/service may still process retained financial state after credential expiry.
        assertThat(client.messages.poll(300,TimeUnit.MILLISECONDS)).isNull();
    }

    @Test void unauthenticatedConnectionsExpireAndAccountConnectionCountIsBounded() throws Exception {
        Client idle=connect("/ws/trading","http://localhost:3000"); idle.next("CONNECTED");
        assertThat(idle.closed.get(7,TimeUnit.SECONDS)).isEqualTo(1008);
        authenticate(guest,"0"); authenticate(guest,"0"); authenticate(guest,"0");
        Client fourth=connect("/ws/trading","http://localhost:3000"); fourth.next("CONNECTED");
        fourth.send(mapper.writeValueAsString(Map.of("type","AUTHENTICATE","credential",guest.accessToken())));
        assertThat(fourth.closed.get(5,TimeUnit.SECONDS)).isEqualTo(1013);
    }

    @Test void unexpectedOriginsAndQueryCredentialsAreNotAccepted() throws Exception {
        assertThatThrownBy(() -> connect("/ws/trading","https://unexpected.invalid"))
                .hasCauseInstanceOf(WebSocketHandshakeException.class);
        Client query=connect("/ws/trading?credential=forbidden","http://localhost:3000");
        assertThat(query.closed.get(5,TimeUnit.SECONDS)).isEqualTo(1008);
    }

    private Client authenticate(GuestAccountResponse account,String cursor) throws Exception {
        Client client=connect("/ws/trading","http://localhost:3000"); client.next("CONNECTED");
        client.send(mapper.writeValueAsString(Map.of("type","AUTHENTICATE","credential",account.accessToken(),"afterEventId",cursor)));
        client.next("AUTHENTICATED"); return client;
    }
    private com.yogimangchi.trading.order.dto.OrderResponse open(GuestAccountResponse account) {
        return orders.create(account.accountId(),UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
    }
    private Client connect(String path,String origin) throws Exception {
        Client client=new Client();
        client.socket=HttpClient.newHttpClient().newWebSocketBuilder().header("Origin",origin)
                .buildAsync(URI.create("ws://127.0.0.1:"+port+path),client).get(5,TimeUnit.SECONDS);
        connections.add(client); return client;
    }
    private final class Client implements WebSocket.Listener {
        final BlockingQueue<JsonNode> messages=new LinkedBlockingQueue<>();
        final CompletableFuture<Integer> closed=new CompletableFuture<>();
        final StringBuilder text=new StringBuilder();
        WebSocket socket;
        @Override public void onOpen(WebSocket socket) { socket.request(1); }
        @Override public CompletionStage<?> onText(WebSocket socket,CharSequence data,boolean last) {
            text.append(data);
            if(last) {
                try { messages.add(mapper.readTree(text.toString())); text.setLength(0); }
                catch(Exception e) { return CompletableFuture.failedFuture(e); }
            }
            socket.request(1); return CompletableFuture.completedFuture(null);
        }
        @Override public CompletionStage<?> onClose(WebSocket socket,int status,String reason) {
            closed.complete(status); return CompletableFuture.completedFuture(null);
        }
        void send(String value) { socket.sendText(value,true).join(); }
        JsonNode next(String expected) throws Exception {
            JsonNode message=messages.poll(5,TimeUnit.SECONDS);
            assertThat(message).as("Expected %s",expected).isNotNull();
            assertThat(message.path("type").asText()).isEqualTo(expected); return message;
        }
    }
}
