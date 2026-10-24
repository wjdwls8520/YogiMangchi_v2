package com.yogimangchi.trading.execution;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import static org.assertj.core.api.Assertions.*;

/** Real embedded HTTP server + migrated PostgreSQL/Redis containers; no Binance network. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties={"binance.mark-price.enabled=false","binance.order-book.enabled=false"})
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
