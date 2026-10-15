package com.yogimangchi.trading.binance.candle;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.tradingsymbol.entity.*;
import com.yogimangchi.trading.tradingsymbol.repository.TradingSymbolRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class BinanceCandleTargetLoaderTests {
    private final TradingSymbolRepository repository = mock(TradingSymbolRepository.class);
    private final BinanceCandleTargetLoader loader = new BinanceCandleTargetLoader(repository);

    @Test void missingInactiveAndInvalidMappingHaveDistinctErrors() {
        when(repository.findById(1L)).thenReturn(Optional.empty());
        failure(ErrorCode.TRADING_SYMBOL_NOT_FOUND);
        var symbol = mock(TradingSymbol.class);
        when(repository.findById(1L)).thenReturn(Optional.of(symbol));
        when(symbol.getStatus()).thenReturn(TradingSymbolStatus.INACTIVE);
        failure(ErrorCode.SYMBOL_NOT_AVAILABLE);
        when(symbol.getStatus()).thenReturn(TradingSymbolStatus.ACTIVE);
        when(symbol.getProvider()).thenReturn(TradingSymbolProvider.BINANCE);
        when(symbol.getProviderSymbol()).thenReturn("BTCUSDT&interval=1d");
        failure(ErrorCode.CANDLE_MAPPING_INVALID);
        when(symbol.getProviderSymbol()).thenReturn("BTCUSDT");
        when(symbol.getProviderUnitMultiplier()).thenReturn(3L);
        failure(ErrorCode.CANDLE_MAPPING_INVALID);
    }
    private void failure(ErrorCode code) {
        assertThatThrownBy(() -> loader.load(1)).isInstanceOfSatisfying(BusinessException.class,
                error -> assertThat(error.getCode()).isEqualTo(code));
    }
}
