package com.yogimangchi.trading;

import com.yogimangchi.trading.support.PostgresTestConfiguration;
import io.swagger.v3.core.util.Yaml;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Import(PostgresTestConfiguration.class)
class LocalApplicationTests {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void localOpenApiIsAvailable() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openapi").exists());
        mockMvc.perform(get("/swagger-ui/index.html"))
                .andExpect(status().isOk());
    }

    @Test
    void generatedOpenApiMatchesCommittedContract() throws Exception {
        String actual = mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        String expected = Files.readString(Path.of("../docs/trading-openapi.yaml"));
        assertThat(Yaml.mapper().readTree(actual))
                .as("Regenerate docs/trading-openapi.yaml from the local endpoint after API changes")
                .isEqualTo(Yaml.mapper().readTree(expected));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/orders", "/login", "/logout"})
    void applicationRequestsAreDeniedWithoutLoginEndpoints(String path) throws Exception {
        mockMvc.perform(get(path)).andExpect(status().isForbidden());
    }
}
