package com.yogimangchi.trading;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import org.springframework.context.annotation.Import;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springdoc.webmvc.api.OpenApiWebMvcResource;
import org.springdoc.webmvc.ui.SwaggerWelcomeWebMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("prod")
@Import(PostgresTestConfiguration.class)
class ProductionApplicationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ApplicationContext context;

    @Test
    void productionHasNoDocumentationOrGeneratedUser() throws Exception {
        assertThat(context.getBeansOfType(OpenApiWebMvcResource.class)).isEmpty();
        assertThat(context.getBeansOfType(SwaggerWelcomeWebMvc.class)).isEmpty();
        assertThat(context.getBeansOfType(UserDetailsService.class)).isEmpty();
        mockMvc.perform(get("/v3/api-docs")).andExpect(status().isForbidden());
        mockMvc.perform(get("/swagger-ui/index.html")).andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/symbols")).andExpect(status().isOk());
    }
}
