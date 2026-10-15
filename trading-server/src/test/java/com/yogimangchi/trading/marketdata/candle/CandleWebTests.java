package com.yogimangchi.trading.marketdata.candle;

import com.yogimangchi.trading.binance.candle.BinanceCandleClient;
import com.yogimangchi.trading.binance.candle.BinanceCandleTargetLoader;
import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.security.SecurityConfig;
import com.yogimangchi.trading.tradingaccount.security.GuestCredentialService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

@WebMvcTest(CandleController.class)
@Import({SecurityConfig.class, ApiExceptionHandler.class, CandleService.class})
class CandleWebTests {
    @Autowired MockMvc mvc;
    @MockitoBean BinanceCandleTargetLoader targets;
    @MockitoBean BinanceCandleClient provider;
    @MockitoBean RedisCandleCache cache;
    @MockitoBean GuestCredentialService credentials;

    @BeforeEach void setup() {
        when(targets.load(1)).thenReturn(new BinanceSubscriptionTarget(1L, "BTC", "BTCUSDT", 1));
        when(cache.read(anyString(), any())).thenReturn(Optional.of(List.of(CandleServiceTests.candle(0))));
    }
    @ParameterizedTest @ValueSource(strings = {"1m", "3m", "5m", "15m", "30m", "1h", "4h", "12h", "24h"})
    void publicContractUsesIsoTimesAndDecimalStrings(String interval) throws Exception {
        mvc.perform(get("/api/v1/market/candles").param("tradingSymbolId", "1").param("interval", interval))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].openTime").value("2026-10-15T00:00:00Z"))
                .andExpect(jsonPath("$[0].closeTime").value("2026-10-15T00:00:59.999Z"))
                .andExpect(jsonPath("$[0].open").isString()).andExpect(jsonPath("$[0].high").isString())
                .andExpect(jsonPath("$[0].low").isString()).andExpect(jsonPath("$[0].close").isString());
        verifyNoInteractions(provider);
    }
    @ParameterizedTest @ValueSource(strings = {"10m", "1d", "2h", "bad"})
    void unsupportedIntervalsReturnProblemDetail(String interval) throws Exception {
        mvc.perform(get("/api/v1/market/candles").param("tradingSymbolId", "1").param("interval", interval))
                .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.code").value("INVALID_CANDLE_REQUEST"));
        verifyNoInteractions(targets, provider);
    }
    @ParameterizedTest @ValueSource(strings = {"0", "501", "wrong"})
    void invalidLimitsAreClientErrors(String limit) throws Exception {
        mvc.perform(get("/api/v1/market/candles").param("tradingSymbolId", "1").param("interval", "1m").param("limit", limit))
                .andExpect(status().isBadRequest());
    }
    @Test void missingOrMalformedQueryIs400AndWritesStayDenied() throws Exception {
        mvc.perform(get("/api/v1/market/candles")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/market/candles").param("tradingSymbolId", "x").param("interval", "1m")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/market/candles").with(csrf())).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/market/candles/admin")).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/trading/account/wallet")).andExpect(status().isUnauthorized());
    }
    @Test void businessAndProviderErrorsFollowExistingProblemDetailPolicy() throws Exception {
        for (var code : List.of(ErrorCode.TRADING_SYMBOL_NOT_FOUND, ErrorCode.SYMBOL_NOT_AVAILABLE, ErrorCode.CANDLE_MAPPING_INVALID)) {
            doThrow(new BusinessException(code)).when(targets).load(1);
            problem(code);
        }
        doReturn(new BinanceSubscriptionTarget(1L, "BTC", "BTCUSDT", 1)).when(targets).load(1);
        when(cache.read(anyString(), any())).thenReturn(Optional.empty());
        for (var code : List.of(ErrorCode.CANDLE_PROVIDER_FAILURE, ErrorCode.CANDLE_PROVIDER_TIMEOUT, ErrorCode.CANDLE_UNAVAILABLE)) {
            doThrow(new BusinessException(code)).when(provider).load(any(), any());
            problem(code);
        }
    }
    private void problem(ErrorCode code) throws Exception {
        mvc.perform(get("/api/v1/market/candles").param("tradingSymbolId", "1").param("interval", "1m"))
                .andExpect(status().is(code.status().value())).andExpect(jsonPath("$.code").value(code.name()))
                .andExpect(jsonPath("$.trace").doesNotExist());
    }
}
