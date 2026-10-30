package com.yogimangchi.trading.tradingaccount;

import com.yogimangchi.trading.support.LegacyLeverageFixtures;

import com.fasterxml.jackson.databind.*;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.yogimangchi.trading.execution.TradingOrderService;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import com.yogimangchi.trading.tradingaccount.service.*;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false","trading.member-auth.enabled=true"})
@AutoConfigureMockMvc @Import(PostgresTestConfiguration.class)
class MemberJwtIntegrationTests {
    static final RSAKey KEY=key();
    static final Path PUBLIC_KEY=publicFile();
    static final JwtEncoder ENCODER=new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(KEY)));
    static final AtomicLong MEMBERS=new AtomicLong(6000000);
    @DynamicPropertySource static void jwtSettings(DynamicPropertyRegistry registry) {
        registry.add("trading.member-auth.public-key-path",PUBLIC_KEY::toString);
        registry.add("trading.member-auth.issuer",() -> "https://content.test");
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired TradingAccountService guests;
    @Autowired MemberAccounts members;
    @Autowired MemberWithdrawal withdrawals;
    @Autowired GuestRetryService guestRetries;
    @Autowired com.yogimangchi.trading.tradinground.MemberRounds rounds;
    @Autowired com.yogimangchi.trading.execution.trigger.AccountTriggerService triggers;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @Autowired com.yogimangchi.trading.tradingevent.service.TradingEvents events;
    @Autowired TradingOrderService orders;
    @Autowired LatestPriceStore prices;
    @Autowired DataSource dataSource;
    @LocalServerPort int port;
    @MockitoBean TradingEngineGate gate;
    long member,btc;
    @BeforeEach void setup() {
        member=MEMBERS.incrementAndGet();
        btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc)); Instant now=Instant.now();
        assertThat(prices.update(new LatestMarkPrice(btc,new BigDecimal("1000"),now,now))).isTrue();
    }
    @AfterEach void cleanup() { prices.markUnavailable(); }

    @Test void authenticationAndReadNeverCreateAnAccountAndExplicitOpeningIsIdempotent() throws Exception {
        long before=jdbc.queryForObject("select count(*) from trading.trading_account",Long.class);
        String token=token(member,Instant.now().plusSeconds(300),"https://content.test","trading","access",List.of("MEMBER"),123L);
        mvc.perform(get("/api/v1/trading/account/summary").header("Authorization","Bearer "+token))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("TRADING_ACCOUNT_REQUIRED"));
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_account",Long.class)).isEqualTo(before);
        var response=mvc.perform(post("/api/v1/trading/accounts/member").header("Authorization","Bearer "+token)
                .contentType("application/json").content("{\"memberId\":123,\"accountId\":123,\"balance\":10000}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.memberId").value(member)).andReturn();
        long account=json.readTree(response.getResponse().getContentAsString()).path("accountId").longValue();
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,account)).isEqualByComparingTo("10000");
        assertThat(jdbc.queryForObject("select credential_hash from trading.trading_account where id=?",String.class,account)).isNull();
        jdbc.update("update trading.wallet set balance=123.45 where account_id=?",account); // Disposable fixture, not a funding API.
        mvc.perform(post("/api/v1/trading/accounts/member").header("Authorization","Bearer "+token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.accountId").value(account));
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,account)).isEqualByComparingTo("123.45");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_account where member_id=?",Long.class,member)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select to_regclass('content.member')::text",String.class)).isNull();
    }

    @Test void concurrentOpeningKeepsOneAccountAndOneInitialGrantWallet() throws Exception {
        var start=new CountDownLatch(1); var pool=Executors.newFixedThreadPool(4);
        try {
            List<Future<Long>> tasks=new ArrayList<>();
            for(int i=0;i<4;i++) tasks.add(pool.submit(() -> { start.await(); return members.open(member).accountId(); }));
            start.countDown(); var ids=new HashSet<Long>();
            for(var task:tasks) ids.add(task.get(10,TimeUnit.SECONDS));
            assertThat(ids).hasSize(1);
            assertThat(jdbc.queryForObject("select count(*) from trading.wallet where account_id=?",Long.class,ids.iterator().next())).isEqualTo(1);
            assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,ids.iterator().next())).isEqualByComparingTo("10000");
        } finally { start.countDown(); pool.shutdownNow(); }
    }

    @Test void realHttpAcceptsContentFifteenMinuteAccessWithKidAndBothAudiencesWithoutDuplicateFunding() throws Exception {
        Instant issued=Instant.now();
        var claims=JwtClaimsSet.builder().issuer("https://content.test").subject(Long.toString(member))
                .issuedAt(issued).expiresAt(issued.plusSeconds(900)).audience(List.of("content","trading"))
                .id(UUID.randomUUID().toString()).claim("token_use","access").claim("roles",List.of("MEMBER")).build();
        var contentEncoder=new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(new RSAKey.Builder(KEY).keyID("content-test-key").build())));
        String access=contentEncoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).keyId("content-test-key").build(),claims)).getTokenValue();
        var http=HttpClient.newHttpClient();
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/trading/accounts/member"))
                .timeout(Duration.ofSeconds(10)).header("Origin","http://localhost:3000")
                .header("Authorization","Bearer "+access).POST(HttpRequest.BodyPublishers.noBody()).build();
        var first=http.send(request,HttpResponse.BodyHandlers.ofString());
        assertThat(first.statusCode()).isEqualTo(200);
        assertThat(first.headers().firstValue("Access-Control-Allow-Origin")).contains("http://localhost:3000");
        assertThat(first.headers().firstValue("Cache-Control").orElseThrow()).contains("no-store");
        var opened=json.readTree(first.body());
        assertThat(opened.path("memberId").asLong()).isEqualTo(member);
        assertThat(new BigDecimal(opened.path("balance").asText())).isEqualByComparingTo("10000");
        for(int i=0;i<2;i++) {
            var replay=http.send(request,HttpResponse.BodyHandlers.ofString());
            assertThat(replay.statusCode()).isEqualTo(200);
            assertThat(json.readTree(replay.body())).isEqualTo(opened);
        }
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_account where member_id=?",Long.class,member)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.member_trading_round where member_id=? and funding='INITIAL_GRANT'",Long.class,member)).isEqualTo(1);
    }

    @Test void realHttpDistinguishesMissingMemberAccessFromGuestAndInvalidAccessWithoutFunding() throws Exception {
        var http=HttpClient.newHttpClient();
        var uri=URI.create("http://127.0.0.1:"+port+"/api/v1/trading/accounts/member");
        var missing=http.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(10))
                .header("Cookie","refresh_token=not-an-access-token").POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());
        assertThat(missing.statusCode()).isEqualTo(401);
        assertThat(json.readTree(missing.body()).path("code").asText()).isEqualTo("MEMBER_CREDENTIAL_REQUIRED");
        mvc.perform(post("/api/v1/trading/accounts/member")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("MEMBER_CREDENTIAL_REQUIRED"));
        var guest=guests.createGuest();
        var denied=http.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(10)).header("Authorization","Bearer "+guest.accessToken())
                .POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());
        assertThat(denied.statusCode()).isEqualTo(403);
        assertThat(json.readTree(denied.body()).path("code").asText()).isEqualTo("ACCESS_DENIED");
        var wrongKey=new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(new RSAKey.Builder(key()).keyID("content-test-key").build())));
        Instant issued=Instant.now();
        String invalid=wrongKey.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).keyId("content-test-key").build(),
                JwtClaimsSet.builder().issuer("https://content.test").subject(Long.toString(member)).issuedAt(issued).expiresAt(issued.plusSeconds(900))
                        .audience(List.of("content","trading")).claim("token_use","access").claim("roles",List.of("MEMBER")).build())).getTokenValue();
        for(String access:List.of(invalid,token(member,Instant.now().minusSeconds(1),"https://content.test","trading","access",List.of("MEMBER"),0L))) {
            var response=http.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(10)).header("Authorization","Bearer "+access)
                    .POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(401);
            assertThat(json.readTree(response.body()).path("code").asText()).isEqualTo("INVALID_ACCESS_TOKEN");
            assertThat(response.body()).doesNotContain(access,"Exception","SELECT ");
        }
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_account where member_id=?",Long.class,member)).isZero();
    }

    @Test void openApiDistinguishesMemberOnlyProvisioningFromEitherCredentialTrading() throws Exception {
        var api=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var own=api.path("paths").path("/api/v1/trading/accounts/member").path("post").path("security");
        assertThat(own.toString()).contains("memberBearer").doesNotContain("guestBearer");
        var existing=api.path("paths").path("/api/v1/trading/account/wallet").path("get").path("security");
        assertThat(existing).hasSize(2);
        assertThat(existing.toString()).contains("memberBearer","guestBearer");
    }

    @Test void memberCannotSelectGuestOrAnotherMembersPositionAndHistoryByForgingIds() throws Exception {
        var guest=guests.createGuest(); var own=members.open(member);
        LegacyLeverageFixtures.bothDirections(jdbc,own.accountId(),btc); var other=members.open(MEMBERS.incrementAndGet());
        jdbc.update("update trading.wallet set balance=1000 where account_id=?",own.accountId());
        var opened=orders.create(own.accountId(),UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        String token=token(member,Instant.now().plusSeconds(300),"https://content.test","trading","access",List.of("MEMBER"),guest.accountId());
        mvc.perform(get("/api/v1/trading/account/summary").header("Authorization","Bearer "+token).param("accountId",guest.accountId().toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.accountId").value(own.accountId()));
        String otherToken=normalToken(other.memberId());
        mvc.perform(post("/api/v1/trading/account/positions/"+opened.positionId()+"/close").header("Authorization","Bearer "+otherToken).header("Idempotency-Key",UUID.randomUUID().toString()))
                .andExpect(status().isNotFound());
        for(String endpoint:List.of("orders","fills","events"))
            mvc.perform(get("/api/v1/trading/account/"+endpoint).header("Authorization","Bearer "+otherToken))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
        assertThat(guests.summary(guest.accountId()).positions()).isEmpty();
        assertThat(new BigDecimal(guests.wallet(guest.accountId()).balance())).isEqualByComparingTo("10000");
        mvc.perform(post("/api/v1/trading/accounts/member").header("Authorization","Bearer "+guest.accessToken()))
                .andExpect(status().isForbidden());
    }

    @Test void expiredTamperedProviderAndWrongContractJwtCannotProvisionAccounts() throws Exception {
        String good=normalToken(member); String[] parts=good.split("\\.");
        String tampered=parts[0]+"."+parts[1]+"."+(parts[2].charAt(0)=='A' ? 'B' : 'A')+parts[2].substring(1);
        long before=jdbc.queryForObject("select count(*) from trading.trading_account",Long.class);
        for(String value:List.of(tampered,token(member,Instant.now().minusSeconds(1),"https://content.test","trading","access",List.of("MEMBER"),0L),
                token(member,Instant.now().plusSeconds(60),"https://accounts.google.com","trading","access",List.of("MEMBER"),0L),
                token(member,Instant.now().plusSeconds(60),"https://content.test","content","access",List.of("MEMBER"),0L),
                token(member,Instant.now().plusSeconds(60),"https://content.test","trading","refresh",List.of("MEMBER"),0L),
                token(member,Instant.now().plusSeconds(60),"https://content.test","trading","access",List.of("GUEST"),0L)))
            mvc.perform(post("/api/v1/trading/accounts/member").header("Authorization","Bearer "+value)).andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_account",Long.class)).isEqualTo(before);
    }

    @Test void ownMemberJwtAuthenticatesPrivateWebsocketAndExpiresWithoutLeakingGuestEvents() throws Exception {
        var own=members.open(member);
        LegacyLeverageFixtures.bothDirections(jdbc,own.accountId(),btc); jdbc.update("update trading.wallet set balance=1000 where account_id=?",own.accountId());
        var order=orders.create(own.accountId(),UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        var guest=guests.createGuest();
        LegacyLeverageFixtures.bothDirections(jdbc,guest.accountId(),btc);
        orders.create(guest.accountId(),UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        var messages=new LinkedBlockingQueue<JsonNode>(); var closed=new CompletableFuture<Integer>();
        var listener=new WebSocket.Listener() {
            final StringBuilder text=new StringBuilder();
            @Override public void onOpen(WebSocket socket) { socket.request(1); }
            @Override public CompletionStage<?> onText(WebSocket socket,CharSequence data,boolean last) {
                text.append(data); if(last) { try { messages.add(json.readTree(text.toString())); text.setLength(0); } catch(Exception e) { return CompletableFuture.failedFuture(e); } }
                socket.request(1); return CompletableFuture.completedFuture(null);
            }
            @Override public CompletionStage<?> onClose(WebSocket socket,int code,String reason) { closed.complete(code); return CompletableFuture.completedFuture(null); }
        };
        var socket=HttpClient.newHttpClient().newWebSocketBuilder().header("Origin","http://localhost:3000")
                .buildAsync(URI.create("ws://127.0.0.1:"+port+"/ws/trading"),listener).get(5,TimeUnit.SECONDS);
        try {
            assertThat(messages.poll(3,TimeUnit.SECONDS).path("type").asText()).isEqualTo("CONNECTED");
            String shortToken=token(member,Instant.now().plusSeconds(4),"https://content.test","trading","access",List.of("MEMBER"),guest.accountId());
            socket.sendText(json.writeValueAsString(Map.of("type","AUTHENTICATE","credential",shortToken)),true).join();
            assertThat(messages.poll(3,TimeUnit.SECONDS).path("type").asText()).isEqualTo("AUTHENTICATED");
            var event=messages.poll(3,TimeUnit.SECONDS);
            assertThat(event.path("data").path("order").path("orderId").longValue()).isEqualTo(order.orderId());
            assertThat(event.toString()).doesNotContain(shortToken,guest.accessToken());
            assertThat(closed.get(6,TimeUnit.SECONDS)).isEqualTo(1008);
            assertThat(messages).isEmpty();
        } finally { socket.abort(); }
    }

    @Test void v14PreservesExistingGuestCredentialsAndWalletAndRejectsAmbiguousOwnership() {
        String schema="member_upgrade_"+UUID.randomUUID().toString().replace("-","");
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("13").load().migrate();
            Long old=jdbc.queryForObject("insert into "+schema+".trading_account(status,credential_hash,credential_expires_at,created_at,last_financial_change_at,guest_account,margin_transition_status,isolated_activated_at) values ('ACTIVE',repeat('a',64),now()+interval '7 days',now(),now(),true,'COMPLETE',now()) returning id",Long.class);
            jdbc.update("insert into "+schema+".wallet(account_id,balance,used_margin,reserved_margin,realized_pnl,fees_paid,settlement_adjustment) values (?,1234.5,0,0,0,0,0)",old);
            var before=jdbc.queryForList("select id,credential_hash,credential_expires_at,guest_account from "+schema+".trading_account");
            var migrate=Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("14").load();
            assertThat(migrate.migrate().migrationsExecuted).isEqualTo(1); assertThat(migrate.migrate().migrationsExecuted).isZero();
            assertThat(jdbc.queryForList("select id,credential_hash,credential_expires_at,guest_account from "+schema+".trading_account")).isEqualTo(before);
            assertThat(jdbc.queryForObject("select balance from "+schema+".wallet",BigDecimal.class)).isEqualByComparingTo("1234.5");
            assertThatThrownBy(() -> jdbc.update("update "+schema+".trading_account set member_id=1 where id=?",old)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        } finally { jdbc.execute("drop schema if exists "+schema+" cascade"); } // Disposable Testcontainers schema only.
    }

    @Test void memberRestartKeepsLedgerLinksSnapshotsAndOriginalIdempotentResult() throws Exception {
        Long id=members.open(member).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc,id,btc);
        var first=rounds.current(id).round();
        assertThat(first.roundNumber()).isEqualTo(1);assertThat(first.initialBalance()).startsWith("10000");
        var opening=orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        orders.createLimitClose(id,opening.positionId(),UUID.randomUUID().toString(),new com.yogimangchi.trading.order.dto.LimitCloseRequest(new BigDecimal("0.7"),new BigDecimal("1100")));
        orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.SHORT,BigDecimal.ONE,10,new BigDecimal("1100")));
        var before=jdbc.queryForMap("select balance,realized_pnl,fees_paid,settlement_adjustment from trading.wallet where account_id=?",id);
        long fills=jdbc.queryForObject("select count(*) from trading.fill where round_id=?",Long.class,first.roundId());
        prices.markUnavailable(); // Administrative reset must not require any Binance/Redis quote.
        String key=UUID.randomUUID().toString();var result=rounds.restart(id,key);
        assertThat(result.roundNumber()).isEqualTo(2);assertThat(result.canceledOrderCount()).isEqualTo(2);assertThat(result.closedPositionCount()).isEqualTo(1);
        assertThat(result.nextAvailableAt()).isEqualTo(result.restartedAt().plusSeconds(86400));
        assertThat(rounds.restart(id,key)).isEqualTo(result);
        assertThat(jdbc.queryForObject("select count(*) from trading.fill where round_id=?",Long.class,first.roundId())).isEqualTo(fills);
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'",Long.class,id)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='OPEN'",Long.class,id)).isZero();
        assertThat(jdbc.queryForObject("select close_reason from trading.position where id=?",String.class,opening.positionId())).isEqualTo("MEMBER_RESTART");
        assertThat(jdbc.queryForObject("select used_margin+reserved_margin from trading.wallet where account_id=?",BigDecimal.class,id)).isZero();
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,id)).isEqualByComparingTo("10000");
        var old=rounds.summary(id,first.roundId());assertThat(old.currentAccount()).isNull();
        assertThat(old.round().finalWallet().path("balance").asText()).isEqualTo(before.get("balance").toString());
        assertThat(rounds.current(id).feesPaid()).startsWith("0.000");
        Instant now=Instant.now();prices.beginSubscription(Set.of(btc));prices.update(new LatestMarkPrice(btc,new BigDecimal("1000"),now,now));
        var nextOrder=orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        assertThat(jdbc.queryForObject("select round_id from trading.trading_order where id=?",Long.class,nextOrder.orderId())).isEqualTo(result.roundId());
        assertThat(jdbc.queryForObject("select round_id from trading.position where id=?",Long.class,nextOrder.positionId())).isEqualTo(result.roundId());
        assertThat(jdbc.queryForObject("select round_id from trading.fill where order_id=?",Long.class,nextOrder.orderId())).isEqualTo(result.roundId());
        assertThat(events.after(id,0,100)).anyMatch(e->first.roundId().equals(e.roundId())).anyMatch(e->result.roundId().equals(e.roundId()));
        assertThat(rounds.summary(id,first.roundId()).round().finalWallet()).isEqualTo(old.round().finalWallet());
        String ownBearer="Bearer "+normalToken(member),base="/api/v1/trading/account/rounds/"+first.roundId();
        mvc.perform(get(base+"/positions").header("Authorization",ownBearer)).andExpect(status().isOk()).andExpect(jsonPath("$.content[0].closeReason").value("MEMBER_RESTART")).andExpect(jsonPath("$.content[0].exitPrice").isEmpty());
        mvc.perform(get(base+"/orders").header("Authorization",ownBearer)).andExpect(status().isOk()).andExpect(jsonPath("$.content[0].roundId").value(first.roundId()));
        mvc.perform(get(base+"/fills").header("Authorization",ownBearer)).andExpect(status().isOk()).andExpect(jsonPath("$.content[0].fee").isString());
        mvc.perform(post("/api/v1/trading/account/restart").header("Authorization","Bearer "+normalToken(member)).header("Idempotency-Key",UUID.randomUUID().toString()))
            .andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.nextAvailableAt").exists()).andExpect(jsonPath("$.code").value("MEMBER_RESTART_LIMITED"));
        assertThat(rounds.restart(id,key)).isEqualTo(result); // Reconfirmation must not reset new exposure.
        assertThat(jdbc.queryForObject("select status from trading.position where id=?",String.class,nextOrder.positionId())).isEqualTo("OPEN");
    }
    @Test void concurrentDifferentRestartKeysCreateExactlyOneRoundAndCredit() throws Exception {
        Long id=members.open(member).accountId();var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(4);
        try {
            var tasks=new ArrayList<Future<Boolean>>();
            for(int i=0;i<4;i++)tasks.add(pool.submit(()->{start.await();try{rounds.restart(id,UUID.randomUUID().toString());return true;}catch(com.yogimangchi.trading.tradinground.RestartLimited expected){return false;}}));
            start.countDown();int success=0;for(var task:tasks)if(task.get(12,TimeUnit.SECONDS))success++;
            assertThat(success).isEqualTo(1);
            assertThat(jdbc.queryForObject("select count(*) from trading.member_restart where account_id=?",Long.class,id)).isEqualTo(1);
            assertThat(rounds.list(id,null,100).content()).hasSize(2);
        }finally{pool.shutdownNow();}
    }
    @Test void restartRollbackRestoresPendingOrdersWalletAndRoundAndRetryCanSucceed() {
        Long id=members.open(member).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc,id,btc);
        orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,BigDecimal.ONE,10,new BigDecimal("900")));
        var before=jdbc.queryForMap("select * from trading.wallet where account_id=?",id);String key=UUID.randomUUID().toString();
        var tx=new org.springframework.transaction.support.TransactionTemplate(transactions);
        assertThatThrownBy(()->tx.execute(status->{rounds.restart(id,key);throw new IllegalStateException("response before failed commit");})).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForMap("select * from trading.wallet where account_id=?",id)).isEqualTo(before);
        assertThat(rounds.list(id,null,100).content()).hasSize(1);
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'",Long.class,id)).isEqualTo(1);
        assertThat(rounds.restart(id,key).roundNumber()).isEqualTo(2);
    }
    @Test void thirdRoundRequiresElapsed24HoursAndGuestAndOtherOwnersCannotUseRoundApi() throws Exception {
        Long id=members.open(member).accountId();rounds.restart(id,UUID.randomUUID().toString());
        // Test-only persisted clock fixture: never a browser-supplied timestamp.
        jdbc.update("update trading.member_restart set restarted_at=clock_timestamp()-interval '24 hours' where account_id=?",id);
        assertThat(rounds.restart(id,UUID.randomUUID().toString()).roundNumber()).isEqualTo(3);
        var other=members.open(MEMBERS.incrementAndGet());long foreign=rounds.current(other.accountId()).round().roundId();
        mvc.perform(get("/api/v1/trading/account/rounds/"+foreign).header("Authorization","Bearer "+normalToken(member))).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/trading/account/rounds/"+foreign+"/fills").header("Authorization","Bearer "+normalToken(member))).andExpect(status().isNotFound());
        var guest=guests.createGuest();mvc.perform(post("/api/v1/trading/account/restart").header("Authorization","Bearer "+guest.accessToken()).header("Idempotency-Key",UUID.randomUUID().toString())).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/trading/account/rounds").header("Authorization","Bearer "+normalToken(member)).param("limit","1")).andExpect(status().isOk()).andExpect(jsonPath("$.nextCursorId").isNumber());
    }
    @Test void staleTickCannotRevivePastOrdersOrLiquidateNewRoundPosition() {
        Long id=members.open(member).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc,id,btc);
        var oldOrder=orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,BigDecimal.ONE,10,new BigDecimal("900")));
        Instant oldTime=Instant.now();var oldTick=new LatestMarkPrice(btc,BigDecimal.ONE,oldTime,oldTime);
        rounds.restart(id,UUID.randomUUID().toString());
        Instant now=Instant.now();prices.update(new LatestMarkPrice(btc,new BigDecimal("1000"),now,now));
        var fresh=orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        triggers.process(id,oldTick,Map.of(btc,oldTick));
        assertThat(jdbc.queryForObject("select status from trading.trading_order where id=?",String.class,oldOrder.orderId())).isEqualTo("CANCELED");
        assertThat(jdbc.queryForObject("select status from trading.position where id=?",String.class,fresh.positionId())).isEqualTo("OPEN");
    }
    @Test void concurrentRestartAndWithdrawalCannotLeaveActiveRoundOrExposure() throws Exception {
        Long id=members.open(member).accountId();var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try {
            var restart=pool.submit(()->{start.await();try{rounds.restart(id,UUID.randomUUID().toString());}catch(com.yogimangchi.trading.error.BusinessException expected){assertThat(expected.getCode()).isEqualTo(com.yogimangchi.trading.error.ErrorCode.ACCOUNT_NOT_ACTIVE);}return null;});
            var withdrawal=pool.submit(()->{start.await();withdrawals.withdraw(member);return null;});start.countDown();restart.get(12,TimeUnit.SECONDS);withdrawal.get(12,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("select status from trading.trading_account where id=?",String.class,id)).isEqualTo("WITHDRAWN");
            assertThat(jdbc.queryForObject("select count(*) from trading.member_trading_round where account_id=? and status='ACTIVE'",Long.class,id)).isZero();
        }finally{pool.shutdownNow();}
    }
    @Test void provisioningCredentialCannotWithdrawAndMemberAccessCannotProvisionInternally() throws Exception {
        String credential=token(member,Instant.now().plusSeconds(55),"https://content.test","trading-internal","member_provisioning",List.of(),0L);
        String endpoint="/internal/v1/members/"+member;
        mvc.perform(post(endpoint+"/trading-account").header("Authorization","Bearer "+normalToken(member))).andExpect(status().isUnauthorized());
        mvc.perform(post(endpoint+"/withdrawal").header("Authorization","Bearer "+credential)).andExpect(status().isForbidden());
        for(int i=0;i<2;i++)mvc.perform(post(endpoint+"/trading-account").header("Authorization","Bearer "+credential)).andExpect(status().isNoContent());
        assertThat(rounds.current(members.open(member).accountId()).round().roundNumber()).isEqualTo(1);
    }

    @Test void v17BackfillsExplicitLegacyRoundWithoutCreditingOrRewritingFinancialLedger() {
        Long id=members.open(member).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc,id,btc);
        orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.SHORT,BigDecimal.ONE,10,new BigDecimal("1100")));
        String schema="round_upgrade_"+UUID.randomUUID().toString().replace("-","");
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("16").load().migrate();
            for(String table:List.of("trading_account","wallet","position","trading_order","fill","trading_event")) {
                var columns=jdbc.queryForList("select column_name from information_schema.columns where table_schema=? and table_name=? order by ordinal_position",String.class,schema,table);
                String names=String.join(",",columns);
                String filter=table.equals("trading_account")?"id=?":table.equals("fill")?"order_id in (select id from trading.trading_order where account_id=?)":"account_id=?";
                jdbc.update("insert into "+schema+"."+table+"("+names+") select "+names+" from trading."+table+" where "+filter,id);
            }
            var before=jdbc.queryForMap("select * from "+schema+".wallet where account_id=?",id);
            var migrate=Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("17").load();
            jdbc.update("delete from "+schema+".wallet where account_id=?",id); // Disposable legacy-corruption fixture only.
            assertThatThrownBy(migrate::migrate).isInstanceOf(org.flywaydb.core.api.FlywayException.class).hasStackTraceContaining("member wallet missing");
            jdbc.update("insert into "+schema+".wallet select * from trading.wallet where account_id=?",id);
            assertThat(migrate.migrate().migrationsExecuted).isEqualTo(1);assertThat(migrate.migrate().migrationsExecuted).isZero();
            assertThat(jdbc.queryForMap("select * from "+schema+".wallet where account_id=?",id)).isEqualTo(before);
            var round=jdbc.queryForMap("select * from "+schema+".member_trading_round where account_id=?",id);
            assertThat(round.get("initial_balance")).isNull();assertThat(round.get("funding")).isEqualTo("LEGACY_UNVERIFIED");
            for(String table:List.of("position","trading_order","fill","trading_event"))
                assertThat(jdbc.queryForObject("select count(*) from "+schema+"."+table+" where round_id is null",Long.class)).isZero();
        }finally{jdbc.execute("drop schema if exists "+schema+" cascade");} // Disposable Testcontainers schema only.
    }

    @org.junit.jupiter.params.ParameterizedTest @org.junit.jupiter.params.provider.ValueSource(strings={"ORDER","CANCEL","LIQUIDATION","SUMMARY"})
    void restartSerializesWithFinancialEngineAndReads(String competing) throws Exception {
        Long id=members.open(member).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc,id,btc);
        orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        var pending=orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,BigDecimal.ONE,10,new BigDecimal("900")));
        var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);Instant captured=Instant.now();
        var tick=new LatestMarkPrice(btc,BigDecimal.ONE,captured,captured);
        try{
            var reset=pool.submit(()->{start.await();return rounds.restart(id,UUID.randomUUID().toString());});
            var other=pool.submit(()->{start.await();switch(competing){
                case "ORDER"->orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,BigDecimal.ONE,10,new BigDecimal("900")));
                case "CANCEL"->orders.cancel(id,pending.orderId());
                case "LIQUIDATION"->triggers.process(id,tick,Map.of(btc,tick));
                case "SUMMARY"->guests.summary(id);
                default->throw new IllegalArgumentException();
            }return null;});start.countDown();var result=reset.get(12,TimeUnit.SECONDS);other.get(12,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING' and round_id<>?",Long.class,id,result.roundId())).isZero();
            assertThat(jdbc.queryForObject("select used_margin from trading.wallet where account_id=?",BigDecimal.class,id)).isZero();
            var reserved=jdbc.queryForObject("select coalesce(sum(reserved_margin),0) from trading.trading_order where account_id=? and status='PENDING'",BigDecimal.class,id);
            assertThat(jdbc.queryForObject("select reserved_margin from trading.wallet where account_id=?",BigDecimal.class,id)).isEqualByComparingTo(reserved);
            // If the tick wins the lock, liquidation and the already-pending OPEN can both
            // legitimately execute in round1 before reset. Reset itself must never add a Fill.
            long fills=jdbc.queryForObject("select count(*) from trading.fill f join trading.trading_order o on o.id=f.order_id where o.account_id=?",Long.class,id);
            if(competing.equals("LIQUIDATION"))assertThat(fills).isIn(1L,3L);else assertThat(fills).isEqualTo(1L);
            assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='FILLED'",Long.class,id)).isEqualTo(fills);
            assertThat(jdbc.queryForObject("select count(*) from trading.fill where round_id=?",Long.class,result.roundId())).isZero();
        }finally{pool.shutdownNow();}
    }
    @Test void sameRestartKeyConcurrentCallsReturnOneOriginalResult() throws Exception {
        Long id=members.open(member).accountId();String key=UUID.randomUUID().toString();var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(3);
        try{
            var tasks=new ArrayList<Future<com.yogimangchi.trading.tradinground.MemberRounds.Restart>>();for(int i=0;i<3;i++)tasks.add(pool.submit(()->{start.await();return rounds.restart(id,key);}));
            start.countDown();var results=new HashSet<com.yogimangchi.trading.tradinground.MemberRounds.Restart>();for(var task:tasks)results.add(task.get(12,TimeUnit.SECONDS));
            assertThat(results).hasSize(1);assertThat(rounds.list(id,null,100).content()).hasSize(2);
        }finally{pool.shutdownNow();}
    }
    @Test void inconsistentExposureRollsBackCancellationsEventsAndNewRound() {
        Long id=members.open(member).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc,id,btc);
        var pending=orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,BigDecimal.ONE,10,new BigDecimal("900")));
        jdbc.update("update trading.wallet set reserved_margin=reserved_margin+1 where account_id=?",id);
        long count=jdbc.queryForObject("select count(*) from trading.trading_event where account_id=?",Long.class,id);
        assertThatThrownBy(()->rounds.restart(id,UUID.randomUUID().toString())).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("select status from trading.trading_order where id=?",String.class,pending.orderId())).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_event where account_id=?",Long.class,id)).isEqualTo(count);
        assertThat(rounds.list(id,null,100).content()).hasSize(1);
    }
    @Test void retirementPreservesRemainingBasisAndAlreadyExecutedFeesAfterPartialClose() {
        Long id=members.open(member).accountId();
        LegacyLeverageFixtures.bothDirections(jdbc,id,btc);
        var opened=orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        orders.close(id,opened.positionId(),UUID.randomUUID().toString(),new com.yogimangchi.trading.order.dto.ClosePositionRequest(new BigDecimal("0.2")));
        var before=jdbc.queryForMap("select realized_pnl,fees_paid,settlement_adjustment from trading.wallet where account_id=?",id);
        var first=rounds.current(id).round();rounds.restart(id,UUID.randomUUID().toString());
        var retired=rounds.positions(id,first.roundId(),null,20).content().get(0);
        assertThat(new BigDecimal(retired.retiredQuantity())).isEqualByComparingTo("0.8");
        assertThat(new BigDecimal(retired.retiredEntryNotional())).isEqualByComparingTo("800");
        assertThat(new BigDecimal(retired.retiredMargin())).isEqualByComparingTo("80");
        assertThat(jdbc.queryForMap("select realized_pnl,fees_paid,settlement_adjustment from trading.wallet where account_id=?",id)).isEqualTo(before);
    }
    @Test void databaseLockTimeoutLeavesRoundAndFundingUntouched() throws Exception {
        Long id=members.open(member).accountId();var locked=new CountDownLatch(1);var release=new CountDownLatch(1);var pool=Executors.newSingleThreadExecutor();
        try{
            var holding=pool.submit(()->new org.springframework.transaction.support.TransactionTemplate(transactions).execute(status->{jdbc.queryForObject("select id from trading.trading_account where id=? for update",Long.class,id);locked.countDown();try{release.await(8,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}return null;}));
            assertThat(locked.await(5,TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(()->rounds.restart(id,UUID.randomUUID().toString())).isInstanceOf(org.springframework.dao.PessimisticLockingFailureException.class);
            release.countDown();holding.get(5,TimeUnit.SECONDS);
            assertThat(rounds.current(id).round().roundNumber()).isEqualTo(1);
            assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,id)).isEqualByComparingTo("10000");
        }finally{release.countDown();pool.shutdownNow();}
    }

    @Test void roundApiOpenApiDescribesTypedLedgersAndIdempotentRestart() throws Exception {
        var api=json.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        for(String kind:List.of("orders","fills","positions")){
            var route=api.path("paths").path("/api/v1/trading/account/rounds/{roundId}/"+kind).path("get");
            assertThat(route.path("security").toString()).contains("memberBearer");
            assertThat(route.path("responses").path("200").path("content").path("application/json").path("schema").toString()).contains("$ref");
        }
        assertThat(api.path("paths").path("/api/v1/trading/account/restart").path("post").path("parameters").toString()).contains("Idempotency-Key");
    }

    @Test void concurrentFirstProvisionAndWithdrawalCannotCreateUsableAccountAfterAcknowledgement() throws Exception {
        var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try{
            var provision=pool.submit(()->{start.await();try{members.open(member);}catch(com.yogimangchi.trading.error.BusinessException expected){assertThat(expected.getCode()).isEqualTo(com.yogimangchi.trading.error.ErrorCode.ACCOUNT_NOT_ACTIVE);}return null;});
            var withdrawal=pool.submit(()->{start.await();withdrawals.withdraw(member);return null;});start.countDown();provision.get(12,TimeUnit.SECONDS);withdrawal.get(12,TimeUnit.SECONDS);
            Long id=jdbc.queryForObject("select id from trading.trading_account where member_id=?",Long.class,member);
            assertThat(jdbc.queryForObject("select status from trading.trading_account where id=?",String.class,id)).isEqualTo("WITHDRAWN");
            assertThat(jdbc.queryForObject("select count(*) from trading.member_trading_round where account_id=? and status='ACTIVE'",Long.class,id)).isZero();
            assertThatThrownBy(()->members.open(member)).isInstanceOf(com.yogimangchi.trading.error.BusinessException.class);
        }finally{pool.shutdownNow();}
    }
    private static String normalToken(long member) { return token(member,Instant.now().plusSeconds(300),"https://content.test","trading","access",List.of("MEMBER"),0L); }
    @Test void memberCannotUseGuestRetryWithOrWithoutProvisionedAccount() throws Exception {
        for(int i=0;i<2;i++) {
            mvc.perform(post("/api/v1/trading/account/retry").header("Authorization","Bearer "+normalToken(member)).header("Idempotency-Key",UUID.randomUUID().toString()))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("GUEST_ACCOUNT_REQUIRED"));
            members.open(member);
        }
        Long account=jdbc.queryForObject("select id from trading.trading_account where member_id=?",Long.class,member);
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,account)).isEqualByComparingTo("10000");
        assertThatThrownBy(() -> guestRetries.retry(account,UUID.randomUUID().toString())).isInstanceOf(com.yogimangchi.trading.error.BusinessException.class);
    }
    @Test void withdrawalCancelsAllOrdersRetiresPositionsWithoutPriceFillFeeOrPnlAndIsIdempotent() throws Exception {
        var own=members.open(member);
        LegacyLeverageFixtures.bothDirections(jdbc,own.accountId(),btc); Long id=own.accountId();
        jdbc.update("update trading.wallet set balance=10000 where account_id=?",id);
        var opened=orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        Instant changed=Instant.now();
        assertThat(prices.update(new LatestMarkPrice(btc,new BigDecimal("1050"),changed,changed))).isTrue();
        orders.close(id,opened.positionId(),UUID.randomUUID().toString(),new com.yogimangchi.trading.order.dto.ClosePositionRequest(new BigDecimal("0.1")));
        orders.createLimitClose(id,opened.positionId(),UUID.randomUUID().toString(),new com.yogimangchi.trading.order.dto.LimitCloseRequest(new BigDecimal("0.7"),new BigDecimal("1100")));
        orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.SHORT,BigDecimal.ONE,10,new BigDecimal("1100")));
        var ledger=jdbc.queryForMap("select balance,realized_pnl,fees_paid,settlement_adjustment from trading.wallet where account_id=?",id);
        assertThat((BigDecimal)ledger.get("realized_pnl")).isPositive();
        long fills=jdbc.queryForObject("select count(*) from trading.fill",Long.class);
        prices.markUnavailable(); // No provider, Redis Mark or engine readiness is required for administrative closure.
        String internal=token(member,Instant.now().plusSeconds(40),"https://content.test","trading-internal","member_withdrawal",List.of(),0L);
        for(int i=0;i<2;i++) mvc.perform(post("/internal/v1/members/"+member+"/withdrawal").header("Authorization","Bearer "+internal)).andExpect(status().isNoContent());
        assertThat(jdbc.queryForMap("select balance,realized_pnl,fees_paid,settlement_adjustment from trading.wallet where account_id=?",id)).isEqualTo(ledger);
        assertThat(jdbc.queryForObject("select count(*) from trading.fill",Long.class)).isEqualTo(fills);
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'",Long.class,id)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='CANCELED' and reason='MEMBER_WITHDRAWAL'",Long.class,id)).isEqualTo(2);
        assertThat(jdbc.queryForObject("select count(*) from trading.position where account_id=? and status='CLOSED' and close_reason='MEMBER_WITHDRAWAL' and exit_price is null and reserved_close_quantity=0",Long.class,id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select used_margin+reserved_margin from trading.wallet where account_id=?",BigDecimal.class,id)).isZero();
        mvc.perform(post("/api/v1/trading/accounts/member").header("Authorization","Bearer "+normalToken(member))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/trading/account/wallet").header("Authorization","Bearer "+normalToken(member))).andExpect(status().isUnauthorized());
        assertThatThrownBy(() -> members.open(member)).isInstanceOf(com.yogimangchi.trading.error.BusinessException.class);
    }

    @Test void withdrawalRequiresDedicatedSignedPurposeAndMatchingMemberAndLeavesGuestAlone() throws Exception {
        var guest=guests.createGuest();
        String endpoint="/internal/v1/members/"+member+"/withdrawal";
        mvc.perform(post(endpoint)).andExpect(status().isUnauthorized());
        mvc.perform(post(endpoint).header("Authorization","Bearer "+normalToken(member))).andExpect(status().isUnauthorized());
        mvc.perform(post(endpoint).header("Authorization","Bearer "+guest.accessToken())).andExpect(status().isUnauthorized());
        String internal=token(member,Instant.now().plusSeconds(40),"https://content.test","trading-internal","member_withdrawal",List.of(),0L);
        mvc.perform(post("/internal/v1/members/"+(member+100000)+"/withdrawal").header("Authorization","Bearer "+internal)).andExpect(status().isForbidden());
        mvc.perform(post(endpoint).header("Authorization","Bearer "+internal)).andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/trading/accounts/member").header("Authorization","Bearer "+normalToken(member))).andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("select status from trading.trading_account where member_id=?",String.class,member)).isEqualTo("WITHDRAWN");
        mvc.perform(get("/api/v1/trading/account/wallet").header("Authorization","Bearer "+guest.accessToken())).andExpect(status().isOk());
        mvc.perform(post("/api/v1/trading/accounts/member").header("Authorization","Bearer "+internal)).andExpect(status().isUnauthorized());
    }

    @Test void inconsistentWithdrawalRollsBackAndLegacyMarginHoldDoesNotRequireConversion() {
        var own=members.open(member);
        LegacyLeverageFixtures.bothDirections(jdbc,own.accountId(),btc); Long id=own.accountId();
        jdbc.update("update trading.wallet set balance=10000 where account_id=?",id);
        orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        jdbc.update("update trading.wallet set used_margin=used_margin+1 where account_id=?",id);
        assertThatThrownBy(() -> withdrawals.withdraw(member)).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("select status from trading.trading_account where id=?",String.class,id)).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("select status from trading.position where account_id=?",String.class,id)).isEqualTo("OPEN");
        jdbc.update("update trading.wallet set used_margin=used_margin-1,balance=1 where account_id=?",id);
        jdbc.update("update trading.trading_account set margin_transition_status='REVIEW_REQUIRED',isolated_activated_at=null where id=?",id);
        withdrawals.withdraw(member);
        assertThat(jdbc.queryForObject("select status from trading.trading_account where id=?",String.class,id)).isEqualTo("WITHDRAWN");
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,id)).isEqualByComparingTo("1");
    }

    @Test void concurrentOrderAndWithdrawalCannotLeaveExecutableExposure() throws Exception {
        var own=members.open(member);
        LegacyLeverageFixtures.bothDirections(jdbc,own.accountId(),btc); Long id=own.accountId();
        jdbc.update("update trading.wallet set balance=10000 where account_id=?",id);
        var start=new CountDownLatch(1); var pool=Executors.newFixedThreadPool(2);
        try {
            var order=pool.submit(() -> {
                start.await();
                try { orders.create(id,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.LIMIT,btc,Position.Side.LONG,BigDecimal.ONE,10,new BigDecimal("900"))); }
                catch(com.yogimangchi.trading.error.BusinessException expected) { assertThat(expected.getCode()).isEqualTo(com.yogimangchi.trading.error.ErrorCode.ACCOUNT_NOT_ACTIVE); }
                return null;
            });
            var withdrawal=pool.submit(() -> { start.await(); withdrawals.withdraw(member); return null; });
            start.countDown(); order.get(10,TimeUnit.SECONDS); withdrawal.get(10,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=? and status='PENDING'",Long.class,id)).isZero();
            assertThat(jdbc.queryForObject("select used_margin+reserved_margin from trading.wallet where account_id=?",BigDecimal.class,id)).isZero();
            assertThat(jdbc.queryForObject("select status from trading.trading_account where id=?",String.class,id)).isEqualTo("WITHDRAWN");
        } finally { start.countDown(); pool.shutdownNow(); }
    }
    @Test void newMemberUsesUnsavedOneTimesPerDirectionAndPreservesExplicitSettings() throws Exception {
        String access=normalToken(member);
        var own=members.open(member); long account=own.accountId();
        String path="/api/v1/trading/account/symbols/"+btc+"/leverage";
        for(String side:List.of("LONG","SHORT")) {
            mvc.perform(get(path+"?side="+side).header("Authorization","Bearer "+access))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.leverage").value(1))
                    .andExpect(jsonPath("$.updatedAt").isEmpty());
            String quote="{\"type\":\"MARKET\",\"tradingSymbolId\":"+btc+",\"side\":\""+side+"\",\"balancePercentage\":10}";
            var result=mvc.perform(post("/api/v1/trading/account/orders/quote").header("Authorization","Bearer "+access)
                    .contentType("application/json").content(quote))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.leverage").value(1)).andReturn();
            assertThat(new BigDecimal(json.readTree(result.getResponse().getContentAsString()).path("quantity").asText()))
                    .isPositive().isLessThan(BigDecimal.ONE);
        }
        assertThat(jdbc.queryForObject("select count(*) from trading.symbol_leverage where account_id=?",Long.class,account)).isZero();
        var opened=orders.create(account,UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,1,null));
        assertThat(opened.leverage()).isEqualTo(1);
        var first=jdbc.queryForMap("select * from trading.position where id=?",opened.positionId());
        mvc.perform(put(path).header("Authorization","Bearer "+access).contentType("application/json").content("{\"side\":\"SHORT\",\"leverage\":7}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.leverage").value(7));
        assertThat(jdbc.queryForMap("select * from trading.position where id=?",opened.positionId())).isEqualTo(first);
        mvc.perform(get(path+"?side=LONG").header("Authorization","Bearer "+access)).andExpect(jsonPath("$.leverage").value(1));
        for(int leverage:List.of(10,15)) {
            mvc.perform(put(path).header("Authorization","Bearer "+access).contentType("application/json").content("{\"side\":\"LONG\",\"leverage\":"+leverage+"}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.leverage").value(leverage));
            mvc.perform(get(path+"?side=LONG").header("Authorization","Bearer "+access)).andExpect(jsonPath("$.leverage").value(leverage));
            mvc.perform(get(path+"?side=SHORT").header("Authorization","Bearer "+access)).andExpect(jsonPath("$.leverage").value(7));
        }
        long eth=jdbc.queryForObject("select id from trading.trading_symbol where symbol='ETH'",Long.class);
        mvc.perform(get("/api/v1/trading/account/symbols/"+eth+"/leverage?side=LONG").header("Authorization","Bearer "+access))
                .andExpect(status().isOk()).andExpect(jsonPath("$.leverage").value(1));
        assertThat(orders.history(account,null,100)).containsExactly(opened);
        assertThat(jdbc.queryForObject("select leverage from trading.position where id=?",Integer.class,opened.positionId())).isEqualTo(15);
    }

    private static String token(long member,Instant expiry,String issuer,String audience,String use,List<String> roles,Long claimedAccount) {
        var claims=JwtClaimsSet.builder().issuer(issuer).subject(Long.toString(member)).issuedAt(Instant.now().minusSeconds(2)).expiresAt(expiry)
                .audience(List.of(audience)).claim("token_use",use).claim("roles",roles).claim("accountId",claimedAccount).build();
        return ENCODER.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(),claims)).getTokenValue();
    }
    private static RSAKey key() { try { return new RSAKeyGenerator(2048).generate(); } catch(Exception e) { throw new ExceptionInInitializerError(e); } }
    private static Path publicFile() {
        try { var file=Files.createTempFile("yogimangchi-public-test-key-",".pem"); file.toFile().deleteOnExit();
            Files.writeString(file,"-----BEGIN PUBLIC KEY-----\n"+Base64.getMimeEncoder(64,new byte[]{'\n'}).encodeToString(KEY.toRSAPublicKey().getEncoded())+"\n-----END PUBLIC KEY-----\n"); return file;
        } catch(Exception e) { throw new ExceptionInInitializerError(e); }
    }
}
