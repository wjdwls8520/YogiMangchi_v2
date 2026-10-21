package com.yogimangchi.content.auth.security;

import io.swagger.v3.oas.models.*;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.*;

@Configuration(proxyBeanMethods=false)
public class OpenApiConfig {
    @Bean OpenAPI contentOpenApi() {
        return new OpenAPI().info(new Info().title("Yogimangchi Content API").version("v1"))
                .components(new Components().addSecuritySchemes("memberBearer",new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")));
    }
}
