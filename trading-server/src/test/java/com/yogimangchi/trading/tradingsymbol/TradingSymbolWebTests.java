package com.yogimangchi.trading.tradingsymbol;

import com.yogimangchi.trading.error.ApiExceptionHandler;
import com.yogimangchi.trading.security.SecurityConfig;
import com.yogimangchi.trading.tradingsymbol.controller.TradingSymbolController;
import com.yogimangchi.trading.tradingsymbol.service.TradingSymbolService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(TradingSymbolController.class)
@Import({SecurityConfig.class, ApiExceptionHandler.class})
class TradingSymbolWebTests {

    @Autowired private MockMvc mockMvc;
    @MockitoBean private TradingSymbolService service;
    @MockitoBean private com.yogimangchi.trading.tradingaccount.security.GuestCredentialService credentials;

    @Test
    void unexpectedServerErrorIsSanitized() throws Exception {
        given(service.findActiveSymbols()).willThrow(new IllegalStateException("private database details"));
        mockMvc.perform(get("/api/v1/symbols"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.status").value(500))
                .andExpect(jsonPath("$.detail").value("요청을 처리하는 중 서버 오류가 발생했습니다."))
                .andExpect(jsonPath("$.trace").doesNotExist())
                .andExpect(content().string(not(containsString("private database details"))))
                .andExpect(content().string(not(containsString("IllegalStateException"))));
    }

    @Test
    void unsupportedResponseMediaTypeRemainsClientError() throws Exception {
        given(service.findActiveSymbols()).willReturn(List.of());
        mockMvc.perform(get("/api/v1/symbols").accept("application/xml"))
                .andExpect(status().isNotAcceptable());
    }

    @Test
    void writeRequestIsDeniedEvenWithValidCsrfToken() throws Exception {
        mockMvc.perform(post("/api/v1/symbols").with(csrf()))
                .andExpect(status().isForbidden());
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/v1/symbols/1", "/api/v1/symbols/admin", "/api/v1/orders", "/api/v1/wallet", "/login"})
    void publicMatcherDoesNotExposeOtherRoutes(String path) throws Exception {
        mockMvc.perform(get(path)).andExpect(status().isForbidden());
    }
}
