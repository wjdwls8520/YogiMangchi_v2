package com.yogimangchi.trading.marketdata;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MarketClockConfiguration {

    @Bean
    public MarkPriceTimePolicy.Policy markPriceTimePolicy(
            @Value("${marketdata.clock.skew-check-enabled:false}") boolean skewCheckEnabled,
            @Value("${marketdata.clock.warning-threshold:12h}") Duration warningThreshold,
            @Value("${marketdata.clock.degraded-threshold:48h}") Duration degradedThreshold,
            @Value("${marketdata.clock.reject-threshold:365d}") Duration rejectThreshold,
            @Value("${marketdata.clock.max-receipt-future:5m}") Duration maxReceiptFuture) {
        return new MarkPriceTimePolicy.Policy(
                skewCheckEnabled,
                warningThreshold,
                degradedThreshold,
                rejectThreshold,
                maxReceiptFuture);
    }
}
