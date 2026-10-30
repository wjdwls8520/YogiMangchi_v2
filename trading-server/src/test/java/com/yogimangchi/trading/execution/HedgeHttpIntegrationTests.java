package com.yogimangchi.trading.execution;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.support.PostgresTestConfiguration;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import static org.assertj.core.api.Assertions.*;

/** Real embedded HTTP server + migrated PostgreSQL/Redis containers; no Binance network. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false","trading.member-auth.enabled=false"})
@Import(PostgresTestConfiguration.class)
class HedgeHttpIntegrationTests {
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired LatestPriceStore prices;
    @MockitoBean TradingEngineGate gate; // Engine admission is covered by the real worker regression suite.
    final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @Test void realHttpSupportsPersistentHundredTimesHedgeOrdersAndPublicOpenApi() throws Exception {
        long symbol=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(symbol));
        try {
            Instant now=Instant.now(); prices.update(new LatestMarkPrice(symbol,new BigDecimal("1000"),now,now));
            var created=send("POST","/api/v1/trading/accounts/guest","",null);
            assertThat(created.statusCode()).isEqualTo(201);
            var guest=json.readTree(created.body()); String token=guest.path("accessToken").asText();
            String leveragePath="/api/v1/trading/account/symbols/"+symbol+"/leverage?side=LONG";
            assertThat(send("PUT",leveragePath,"{\"side\":\"LONG\",\"leverage\":100}",token).statusCode()).isEqualTo(200);
            assertThat(send("PUT",leveragePath,"{\"side\":\"SHORT\",\"leverage\":100}",token).statusCode()).isEqualTo(200);
            var first=open(symbol,"LONG",token); var second=open(symbol,"LONG",token); var shortOrder=open(symbol,"SHORT",token);
            assertThat(first.path("positionId")).isEqualTo(second.path("positionId")).isNotEqualTo(shortOrder.path("positionId"));
            var summary=json.readTree(send("GET","/api/v1/trading/account/summary",null,token).body());
            assertThat(summary.path("positions").size()).isEqualTo(2);
            assertThat(summary.path("wallet").path("usedMargin").asText()).isEqualTo("30.000000000000000000");
            assertThat(jdbc.queryForObject("select leverage from trading.symbol_leverage where account_id=? and trading_symbol_id=? and side='LONG'",Integer.class,guest.path("accountId").asLong(),symbol)).isEqualTo(100);
            var document=json.readTree(send("GET","/v3/api-docs",null,null).body());
            assertThat(document.path("paths").has("/api/v1/trading/account/symbols/{symbolId}/leverage")).isTrue();
            assertThat(send("GET",leveragePath,null,null).statusCode()).isEqualTo(401);
        } finally { prices.markUnavailable(); }
    }

    @Test void browserPreflightAllowsOnlyConfiguredOriginAndNewPutMethod() throws Exception {
        var request=HttpRequest.newBuilder(URI.create("http://localhost:"+port+"/api/v1/trading/account/symbols/1/leverage"))
                .timeout(Duration.ofSeconds(10)).header("Origin","http://localhost:3000")
                .header("Access-Control-Request-Method","PUT").header("Access-Control-Request-Headers","authorization,content-type")
                .method("OPTIONS",HttpRequest.BodyPublishers.noBody()).build();
        var response=client.send(request,HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Access-Control-Allow-Methods").orElseThrow()).contains("PUT");
    }

    @Test void realGuestHttpRequiresDirectionAndKeepsLongFifteenShortSevenSeparate() throws Exception {
        long symbol=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        var created=json.readTree(send("POST","/api/v1/trading/accounts/guest","",null).body());
        String token=created.path("accessToken").asText();long account=created.path("accountId").asLong();
        String path="/api/v1/trading/account/symbols/"+symbol+"/leverage";
        for(String suffix:List.of("","?side=","?side=BOTH","?side=long")) {
            var invalid=send("GET",path+suffix,null,token);
            assertThat(invalid.statusCode()).isEqualTo(400);
            assertThat(invalid.body()).doesNotContain(token,"Exception","SELECT ");
        }
        assertThat(send("PUT",path,"{\"leverage\":15}",token).statusCode()).isEqualTo(400);
        assertThat(jdbc.queryForObject("select count(*) from trading.symbol_leverage where account_id=?",Long.class,account)).isZero();
        for(String side:List.of("LONG","SHORT")) {
            var initial=send("GET",path+"?side="+side,null,token);
            assertThat(initial.statusCode()).isEqualTo(200);
            assertThat(json.readTree(initial.body()).path("leverage").asInt()).isEqualTo(1);
            assertThat(json.readTree(initial.body()).path("side").asText()).isEqualTo(side);
        }
        assertThat(jdbc.queryForObject("select count(*) from trading.symbol_leverage where account_id=?",Long.class,account)).isZero();
        for(String side:List.of("LONG","SHORT")) {
            int leverage=side.equals("LONG")?15:7;
            assertThat(send("PUT",path,"{\"side\":\""+side+"\",\"leverage\":"+leverage+"}",token).statusCode()).isEqualTo(200);
        }
        for(String side:List.of("LONG","SHORT")) {
            var response=send("GET",path+"?side="+side,null,token);
            assertThat(response.statusCode()).isEqualTo(200);
            assertThat(json.readTree(response.body()).path("side").asText()).isEqualTo(side);
            assertThat(json.readTree(response.body()).path("leverage").asInt()).isEqualTo(side.equals("LONG")?15:7);
        }
        assertThat(jdbc.queryForObject("select balance from trading.wallet where account_id=?",BigDecimal.class,account)).isEqualByComparingTo("10000");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_order where account_id=?",Long.class,account)).isZero();
        var api=json.readTree(send("GET","/v3/api-docs",null,null).body());
        var parameters=api.path("paths").path("/api/v1/trading/account/symbols/{symbolId}/leverage").path("get").path("parameters");
        JsonNode direction=null;for(var parameter:parameters)if(parameter.path("name").asText().equals("side"))direction=parameter;
        assertThat(direction).isNotNull();assertThat(direction.path("required").asBoolean()).isTrue();
        assertThat(direction.path("schema").path("enum").toString()).isEqualTo("[\"LONG\",\"SHORT\"]");
    }

    @Test void memberAuthenticationDisabledRejectsSignedAccessWithoutFunding() throws Exception {
        var key=new RSAKeyGenerator(2048).keyID("disabled-test-key").generate();
        var encoder=new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key)));
        Instant now=Instant.now();
        var claims=JwtClaimsSet.builder().issuer("http://localhost:18080").subject("987654321")
                .issuedAt(now).expiresAt(now.plusSeconds(900)).audience(List.of("content","trading"))
                .claim("token_use","access").claim("roles",List.of("MEMBER")).build();
        String token=encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).keyId(key.getKeyID()).build(),claims)).getTokenValue();
        long before=jdbc.queryForObject("select count(*) from trading.trading_account",Long.class);
        var response=send("POST","/api/v1/trading/accounts/member",null,token);
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(json.readTree(response.body()).path("code").asText()).isEqualTo("INVALID_ACCESS_TOKEN");
        assertThat(jdbc.queryForObject("select count(*) from trading.trading_account",Long.class)).isEqualTo(before);
    }

    @Test void unsavedGuestDirectionsQuoteSizeAndExecuteAtOneWithoutPersistingPreferences() throws Exception {
        long symbol=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        var guest=json.readTree(send("POST","/api/v1/trading/accounts/guest","",null).body());
        String token=guest.path("accessToken").asText(); long account=guest.path("accountId").asLong();
        prices.beginSubscription(Set.of(symbol));
        try {
            Instant now=Instant.now(); prices.update(new LatestMarkPrice(symbol,new BigDecimal("1000"),now,now));
            for(String side:List.of("LONG","SHORT")) {
                String quote="{\"type\":\"MARKET\",\"tradingSymbolId\":"+symbol+",\"side\":\""+side+"\",\"quantity\":\"1\"}";
                var response=send("POST","/api/v1/trading/account/orders/quote",quote,token);
                assertThat(response.statusCode()).isEqualTo(200);
                var estimate=json.readTree(response.body());
                assertThat(estimate.path("leverage").asInt()).isEqualTo(1);
                assertThat(new BigDecimal(estimate.path("margin").asText())).isEqualByComparingTo("1000");
            }
            String sizing="{\"type\":\"MARKET\",\"tradingSymbolId\":"+symbol+",\"side\":\"LONG\",\"balancePercentage\":10}";
            var sized=json.readTree(send("POST","/api/v1/trading/account/orders/quote",sizing,token).body());
            assertThat(sized.path("leverage").asInt()).isEqualTo(1);
            BigDecimal quantity=new BigDecimal(sized.path("quantity").asText());
            assertThat(quantity).isPositive().isLessThan(BigDecimal.ONE);
            assertThat(new BigDecimal(sized.path("totalRequired").asText())).isLessThanOrEqualTo(new BigDecimal("1000"));
            String order="{\"type\":\"MARKET\",\"tradingSymbolId\":"+symbol+",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":1}";
            var mismatch=send("POST","/api/v1/trading/account/orders",order.replace("\"leverage\":1","\"leverage\":10"),token);
            assertThat(mismatch.statusCode()).isEqualTo(409);
            assertThat(json.readTree(mismatch.body()).path("code").asText()).isEqualTo("LEVERAGE_MISMATCH");
            var opened=send("POST","/api/v1/trading/account/orders",order,token);
            assertThat(opened.statusCode()).isEqualTo(200);
            assertThat(json.readTree(opened.body()).path("leverage").asInt()).isEqualTo(1);
            String limit="{\"type\":\"LIMIT\",\"tradingSymbolId\":"+symbol+",\"side\":\"SHORT\",\"quantity\":\"1\",\"leverage\":1,\"limitPrice\":\"1010\"}";
            var pending=send("POST","/api/v1/trading/account/orders",limit,token);
            assertThat(pending.statusCode()).isEqualTo(200);
            assertThat(json.readTree(pending.body()).path("status").asText()).isEqualTo("PENDING");
            assertThat(new BigDecimal(json.readTree(pending.body()).path("reservedMargin").asText())).isGreaterThan(new BigDecimal("1010"));
            assertThat(jdbc.queryForObject("select count(*) from trading.symbol_leverage where account_id=?",Long.class,account)).isZero();
            String path="/api/v1/trading/account/symbols/"+symbol+"/leverage";
            var explicit=send("PUT",path,"{\"side\":\"LONG\",\"leverage\":1}",token);
            assertThat(explicit.statusCode()).isEqualTo(200);
            var saved=json.readTree(explicit.body()); assertThat(saved.path("updatedAt").isNull()).isFalse();
            assertThat(json.readTree(send("PUT",path,"{\"side\":\"LONG\",\"leverage\":1}",token).body())).isEqualTo(saved);
            assertThat(jdbc.queryForObject("select count(*) from trading.symbol_leverage where account_id=?",Long.class,account)).isEqualTo(1);
            var document=json.readTree(send("GET","/v3/api-docs",null,null).body());
            assertThat(document.path("paths").path("/api/v1/trading/account/symbols/{symbolId}/leverage").path("get").path("description").asText())
                    .contains("defaults to 1x","Existing saved settings");
        } finally { prices.markUnavailable(); }
    }

    private JsonNode open(long symbol,String side,String token) throws Exception {
        var response=send("POST","/api/v1/trading/account/orders","{\"type\":\"MARKET\",\"tradingSymbolId\":"+symbol+",\"side\":\""+side+"\",\"quantity\":\"1\",\"leverage\":100}",token);
        assertThat(response.statusCode()).isEqualTo(200); return json.readTree(response.body());
    }
    private HttpResponse<String> send(String method,String path,String body,String token) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(10));
        if(token!=null) builder.header("Authorization","Bearer "+token);
        if(body!=null) builder.header("Content-Type","application/json");
        if(path.endsWith("/orders")) builder.header("Idempotency-Key",UUID.randomUUID().toString());
        return client.send(builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
}
