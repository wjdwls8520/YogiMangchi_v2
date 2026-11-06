package com.yogimangchi.trading.qa;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;
import static org.assertj.core.api.Assertions.*;

class ControlledPriceQaTests {
    @TempDir Path directory;
    @Test void unsafeTargetsAndExternalCollectorsAreRejectedBeforeContextRefresh()throws Exception{
        MockEnvironment valid=settings();ControlledPriceQa.validate(valid,directory);
        for(var invalid:Map.ofEntries(Map.entry("server.port","8081"),Map.entry("server.address","0.0.0.0"),
                Map.entry("spring.datasource.url","jdbc:postgresql://localhost:5432/yogimangchi"),Map.entry("spring.data.redis.port","6379"),
                Map.entry("spring.flyway.url","jdbc:postgresql://localhost:5432/yogimangchi"),Map.entry("spring.data.redis.url","redis://localhost:6379"),
                Map.entry("binance.mark-price.enabled","true"),Map.entry("binance.order-book.enabled","true"),
                Map.entry("trading.trigger.enabled","false"),Map.entry("trading.risk-journal.enabled","false"),
                Map.entry("trading.http.allowed-origins","http://localhost:3310"),Map.entry("marketdata.websocket.allowed-origins","*"),
                Map.entry("trading.member-auth.issuer","http://localhost:8080")).entrySet()){
            var changed=settings().withProperty(invalid.getKey(),invalid.getValue());
            assertThatThrownBy(()->ControlledPriceQa.validate(changed,directory)).isInstanceOf(IllegalArgumentException.class);
        }
        valid.setActiveProfiles("prod");assertThatThrownBy(()->ControlledPriceQa.validate(valid,directory)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void scenarioIsExplicitBoundedAndUsesDomainSymbols(){
        var scenario=parse("{\"sequence\":1,\"phase\":\"NORMAL\",\"available\":true,\"prices\":{\"BTC\":\"1000\",\"PEPE\":\"0.00001\"}}");
        assertThat(scenario.prices()).containsOnlyKeys("BTC","PEPE");assertThat(scenario.prices().get("PEPE")).isEqualByComparingTo("0.00001");
        for(String invalid:List.of(
                "{\"sequence\":1,\"phase\":\"NORMAL\",\"available\":false,\"prices\":{\"BTC\":\"1000\"}}",
                "{\"sequence\":1,\"phase\":\"NORMAL\",\"available\":true,\"prices\":{\"BTCUSDT\":\"1000\"}}",
                "{\"sequence\":1,\"phase\":\"NORMAL\",\"available\":true,\"prices\":{\"BTC\":1000}}",
                "{\"sequence\":1,\"phase\":\"NORMAL\",\"available\":true,\"prices\":{\"BTC\":\"0\"}}",
                "{\"sequence\":1,\"phase\":\"NORMAL\",\"available\":true,\"prices\":{\"BTC\":\"1000\"},\"accountId\":1}","null")){
            assertThatThrownBy(()->parse(invalid)).isInstanceOf(IllegalArgumentException.class);
        }
        assertThatThrownBy(()->ControlledPriceQa.scenario(new byte[65537],Set.of("BTC"))).isInstanceOf(IllegalArgumentException.class);
    }
    private ControlledPriceQa.Scenario parse(String text){return ControlledPriceQa.scenario(text.getBytes(StandardCharsets.UTF_8),Set.of("BTC","PEPE"));}
    private MockEnvironment settings()throws Exception{
        Path scenario=directory.resolve("scenario.json"),key=directory.resolve("public.pem");Files.writeString(scenario,"{}");Files.writeString(key,"-----BEGIN PUBLIC KEY-----\npublic-fixture-only\n-----END PUBLIC KEY-----");
        var env=new MockEnvironment();Map.ofEntries(
                Map.entry("controlled-qa.enabled","true"),Map.entry("server.address","127.0.0.1"),Map.entry("server.port","18091"),
                Map.entry("spring.datasource.url","jdbc:postgresql://127.0.0.1:58491/yogimangchi"),Map.entry("spring.data.redis.host","127.0.0.1"),Map.entry("spring.data.redis.port","58492"),
                Map.entry("spring.jpa.hibernate.ddl-auto","validate"),Map.entry("spring.flyway.clean-disabled","true"),
                Map.entry("spring.flyway.default-schema","trading"),Map.entry("spring.flyway.schemas","trading"),Map.entry("spring.jpa.properties.hibernate.default_schema","trading"),
                Map.entry("binance.mark-price.enabled","false"),Map.entry("binance.order-book.enabled","false"),
                Map.entry("trading.risk-journal.enabled","true"),Map.entry("trading.trigger.enabled","true"),Map.entry("marketdata.redis.enabled","true"),
                Map.entry("trading.member-auth.enabled","true"),Map.entry("trading.member-auth.issuer","http://localhost:18080"),
                Map.entry("trading.http.allowed-origins","http://localhost:3311"),Map.entry("marketdata.websocket.allowed-origins","http://localhost:3311"),
                Map.entry("controlled-qa.scenario-path",scenario.toString()),Map.entry("trading.member-auth.public-key-path",key.toString())).forEach(env::setProperty);
        return env;
    }
}
