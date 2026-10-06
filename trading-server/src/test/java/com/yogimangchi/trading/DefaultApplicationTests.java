package com.yogimangchi.trading;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import org.springframework.context.annotation.Import;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springdoc.webmvc.api.OpenApiWebMvcResource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration.class)
class DefaultApplicationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ApplicationContext context;

    @Test
    void profileOmissionDoesNotExposeDocumentation() throws Exception {
        assertThat(context.getBeansOfType(OpenApiWebMvcResource.class)).isEmpty();
        mockMvc.perform(get("/v3/api-docs")).andExpect(status().isForbidden());
    }
}
