package com.yogimangchi.trading.order.config;

import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import java.math.BigDecimal;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class OrderJsonConfiguration {
    @Bean
    Jackson2ObjectMapperBuilderCustomizer rejectBlankDecimalInputs() {
        // A blank quantity must not become null and silently request a full position close.
        return builder -> builder.postConfigurer(mapper -> {
            mapper.disable(com.fasterxml.jackson.databind.DeserializationFeature.ACCEPT_FLOAT_AS_INT);
            mapper.coercionConfigFor(Integer.class).setCoercion(CoercionInputShape.String, CoercionAction.Fail);
            mapper.coercionConfigFor(BigDecimal.class)
                .setAcceptBlankAsEmpty(false)
                .setCoercion(CoercionInputShape.EmptyString, CoercionAction.Fail);
        });
    }
}
