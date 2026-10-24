package com.yogimangchi.content.error;

import com.yogimangchi.content.auth.controller.AuthController;
import com.yogimangchi.content.auth.service.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ApiErrorsTests {
    @Test void databaseOutageIs503WithoutCookieMutationOrInternalMessage() throws Exception {
        var auth=mock(AuthService.class);
        when(auth.refresh(null)).thenThrow(new DataAccessResourceFailureException("private@example.test secret-token"));
        var mvc=MockMvcBuilders.standaloneSetup(new AuthController(auth,false)).setControllerAdvice(new ApiErrors()).build();
        mvc.perform(post("/api/v1/auth/refresh")).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_TEMPORARILY_UNAVAILABLE"))
                .andExpect(jsonPath("$.detail").value("SERVICE_TEMPORARILY_UNAVAILABLE"))
                .andExpect(header().doesNotExist("Set-Cookie")).andExpect(header().string("Cache-Control","no-store"));
    }
    @Test void lockContentionIsDistinguishedFromOutage() throws Exception {
        var auth=mock(AuthService.class);
        when(auth.refresh(null)).thenThrow(new org.springframework.dao.CannotAcquireLockException("private SQL"));
        var mvc=MockMvcBuilders.standaloneSetup(new AuthController(auth,false)).setControllerAdvice(new ApiErrors()).build();
        mvc.perform(post("/api/v1/auth/refresh")).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("MEMBER_BUSY"))
                .andExpect(header().doesNotExist("Set-Cookie"));
    }
}
