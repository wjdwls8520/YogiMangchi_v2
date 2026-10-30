package com.yogimangchi.trading.execution.recovery;

import com.fasterxml.jackson.databind.*;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.reconciliation.LedgerReconciler;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.Set;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;

/** Real embedded HTTP server and temporary infrastructure; no external Binance or user database. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"trading.risk-journal.enabled=true","trading.reconciliation.enabled=false","trading.trigger.enabled=false","trading.guest-cleanup.enabled=false","binance.mark-price.enabled=false","binance.order-book.enabled=false"})
@Import(DurableRiskIntegrationTests.Infrastructure.class)
class TradingHttpVerificationTests {
    @LocalServerPort int port;
    @Autowired LatestPriceStore prices;
    @Autowired RedisMarketDataBridge bridge;
    @Autowired DurableRiskWorker worker;
    @Autowired JdbcTemplate jdbc;
    @Autowired LedgerReconciler reconciler;
    @Autowired ObjectMapper json;
    final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    @AfterEach void cleanup(){prices.markUnavailable();}

    @Test void realHttpVerifiesIndependentLeverageTradingPerformanceRecoveryAndOwnership()throws Exception{
        long btc=jdbc.queryForObject("select id from trading.trading_symbol where symbol='BTC'",Long.class);
        prices.beginSubscription(Set.of(btc));
        await().atMost(Duration.ofSeconds(12)).until(()->bridge.health().state()==RedisMarketDataBridge.State.HEALTHY);
        mark(btc);
        var guest=request("POST","/api/v1/trading/accounts/guest",null,null,201);
        String token=guest.path("accessToken").asText();long id=guest.path("accountId").asLong();
        assertThat(id).isPositive();assertThat(token).isNotBlank();
        String leverage="/api/v1/trading/account/symbols/"+btc+"/leverage";
        assertThat(request("GET",leverage+"?side=LONG",null,token,200).path("leverage").asInt()).isEqualTo(1);
        request("PUT",leverage,"{\"side\":\"LONG\",\"leverage\":20}",token,200);
        request("PUT",leverage,"{\"side\":\"SHORT\",\"leverage\":5}",token,200);
        mark(btc);
        request("POST","/api/v1/trading/account/orders","{\"type\":\"MARKET\",\"tradingSymbolId\":"+btc+",\"side\":\"LONG\",\"quantity\":\"1\",\"leverage\":20}",token,200);
        mark(btc);
        request("POST","/api/v1/trading/account/orders","{\"type\":\"MARKET\",\"tradingSymbolId\":"+btc+",\"side\":\"SHORT\",\"quantity\":\"1\",\"leverage\":5}",token,200);
        var summary=request("GET","/api/v1/trading/account/summary",null,token,200);
        assertThat(summary.path("positions").size()).isEqualTo(2);
        assertThat(new BigDecimal(summary.path("wallet").path("usedMargin").asText())).isEqualByComparingTo("250");
        assertThat(new BigDecimal(summary.path("wallet").path("feesPaid").asText())).isEqualByComparingTo("1");
        var performance=request("GET","/api/v1/trading/account/performance/symbols",null,token,200);
        assertThat(performance.path("totals").path("fillCount").asLong()).isEqualTo(2);
        assertThat(new BigDecimal(performance.path("totals").path("turnover").asText())).isEqualByComparingTo("2000");
        request("GET","/api/v1/trading/account/recovery",null,null,401);
        assertThat(request("GET","/api/v1/trading/account/recovery",null,token,200).path("status").asText()).isEqualTo("CLEAR");
        var docs=request("GET","/v3/api-docs",null,null,200);
        assertThat(docs.path("paths").has("/api/v1/trading/account/performance/symbols")).isTrue();
        assertThat(docs.path("paths").has("/api/v1/trading/account/recovery")).isTrue();
        assertThat(reconciler.check(id).status()).isEqualTo("MATCHED");
        System.out.println("HTTP_VERIFICATION branch="+System.getenv("TRADING_VERIFICATION_BRANCH")+" commit="+System.getenv("TRADING_VERIFICATION_COMMIT")+" port="+port+" infrastructure=temporary-postgresql17-redis7 externalBinance=false");
    }
    private void mark(long btc)throws Exception{
        Instant now=Instant.now();assertThat(prices.update(new LatestMarkPrice(btc,new BigDecimal("1000"),now,now))).isTrue();worker.runOnce();
    }
    private JsonNode request(String method,String path,String body,String token,int expected)throws Exception{
        var builder=HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(10));
        if(token!=null)builder.header("Authorization","Bearer "+token);
        if(body!=null)builder.header("Content-Type","application/json");
        if(method.equals("POST")&&path.endsWith("/orders"))builder.header("Idempotency-Key",java.util.UUID.randomUUID().toString());
        builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body));
        var response=client.send(builder.build(),HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as(method+" "+path).isEqualTo(expected);
        return response.body().isBlank()?json.createObjectNode():json.readTree(response.body());
    }
}
