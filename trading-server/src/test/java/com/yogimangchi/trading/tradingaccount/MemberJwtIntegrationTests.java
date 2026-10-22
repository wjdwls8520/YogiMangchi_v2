package com.yogimangchi.trading.tradingaccount;

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
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,account)).isZero();
        assertThat(jdbc.queryForObject("select credential_hash from trading.trading_account where id=?",String.class,account)).isNull();
        jdbc.update("update trading.wallet set balance=123.45 where account_id=?",account); // Disposable fixture, not a funding API.
        mvc.perform(post("/api/v1/trading/accounts/member").header("Authorization","Bearer "+token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.accountId").value(account));
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,account)).isEqualByComparingTo("123.45");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_account where member_id=?",Long.class,member)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select to_regclass('content.member')::text",String.class)).isNull();
    }

    @Test void concurrentOpeningKeepsOneAccountAndOneZeroBalanceWallet() throws Exception {
        var start=new CountDownLatch(1); var pool=Executors.newFixedThreadPool(4);
        try {
            List<Future<Long>> tasks=new ArrayList<>();
            for(int i=0;i<4;i++) tasks.add(pool.submit(() -> { start.await(); return members.open(member).accountId(); }));
            start.countDown(); var ids=new HashSet<Long>();
            for(var task:tasks) ids.add(task.get(10,TimeUnit.SECONDS));
            assertThat(ids).hasSize(1);
            assertThat(jdbc.queryForObject("select count(*) from trading.wallet where account_id=?",Long.class,ids.iterator().next())).isEqualTo(1);
            assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,ids.iterator().next())).isZero();
        } finally { start.countDown(); pool.shutdownNow(); }
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
        var guest=guests.createGuest(); var own=members.open(member); var other=members.open(MEMBERS.incrementAndGet());
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
        var own=members.open(member); jdbc.update("update trading.wallet set balance=1000 where account_id=?",own.accountId());
        var order=orders.create(own.accountId(),UUID.randomUUID().toString(),new CreateOrderRequest(TradingOrder.Type.MARKET,btc,Position.Side.LONG,BigDecimal.ONE,10,null));
        var guest=guests.createGuest();
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
    private static String normalToken(long member) { return token(member,Instant.now().plusSeconds(300),"https://content.test","trading","access",List.of("MEMBER"),0L); }
    @Test void memberCannotUseGuestRetryWithOrWithoutProvisionedAccount() throws Exception {
        for(int i=0;i<2;i++) {
            mvc.perform(post("/api/v1/trading/account/retry").header("Authorization","Bearer "+normalToken(member)).header("Idempotency-Key",UUID.randomUUID().toString()))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("GUEST_ACCOUNT_REQUIRED"));
            members.open(member);
        }
        Long account=jdbc.queryForObject("select id from trading.trading_account where member_id=?",Long.class,member);
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,account)).isZero();
        assertThatThrownBy(() -> guestRetries.retry(account,UUID.randomUUID().toString())).isInstanceOf(com.yogimangchi.trading.error.BusinessException.class);
    }
    @Test void withdrawalCancelsAllOrdersRetiresPositionsWithoutPriceFillFeeOrPnlAndIsIdempotent() throws Exception {
        var own=members.open(member); Long id=own.accountId();
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
        var own=members.open(member); Long id=own.accountId();
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
        var own=members.open(member); Long id=own.accountId();
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
