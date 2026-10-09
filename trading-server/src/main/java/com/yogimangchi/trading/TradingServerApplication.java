package com.yogimangchi.trading;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.servers.Server;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;

// Guest bearer credentials do not enable generated username/password login.
@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
@OpenAPIDefinition(info = @Info(title = "Yogimangchi Trading API", version = "v1"), servers = @Server(url = "/"))
public class TradingServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(TradingServerApplication.class, args);
    }
}
