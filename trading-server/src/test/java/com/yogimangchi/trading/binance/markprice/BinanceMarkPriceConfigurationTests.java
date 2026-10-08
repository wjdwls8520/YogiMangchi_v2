package com.yogimangchi.trading.binance.markprice;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTargetLoader;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class BinanceMarkPriceConfigurationTests {
    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withBean(ObjectMapper.class, ObjectMapper::new)
            .withBean(BinanceSubscriptionTargetLoader.class, () -> mock(BinanceSubscriptionTargetLoader.class))
            .withUserConfiguration(BinanceMarkPriceClient.class);

    @Test
    void priceInfoLoggingIsOffUnlessExplicitlyEnabled() {
        // No ApplicationReadyEvent: verifies real Spring property binding without external connections.
        context.run(app -> assertThat(ReflectionTestUtils.getField(
                app.getBean(BinanceMarkPriceClient.class), "logPrices")).isEqualTo(false));
        context.withPropertyValues("binance.mark-price.log-prices=true")
                .run(app -> assertThat(ReflectionTestUtils.getField(
                        app.getBean(BinanceMarkPriceClient.class), "logPrices")).isEqualTo(true));
    }
}
