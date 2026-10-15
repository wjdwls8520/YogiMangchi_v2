package com.yogimangchi.trading.binance.candle;

import com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolProvider;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import com.yogimangchi.trading.tradingsymbol.repository.TradingSymbolRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BinanceCandleTargetLoader {
    private final TradingSymbolRepository symbols;
    public BinanceCandleTargetLoader(TradingSymbolRepository symbols) { this.symbols = symbols; }

    @Transactional(readOnly = true)
    public BinanceSubscriptionTarget load(long id) {
        var symbol = symbols.findById(id).orElseThrow(() -> new BusinessException(ErrorCode.TRADING_SYMBOL_NOT_FOUND));
        if (symbol.getStatus() != TradingSymbolStatus.ACTIVE) throw new BusinessException(ErrorCode.SYMBOL_NOT_AVAILABLE);
        if (symbol.getProvider() != TradingSymbolProvider.BINANCE || symbol.getProviderSymbol() == null
                || !symbol.getProviderSymbol().matches("[A-Z0-9]{1,40}")) throw new BusinessException(ErrorCode.CANDLE_MAPPING_INVALID);
        try {
            TradingSymbol.requireProviderUnitMultiplier(symbol.getProviderUnitMultiplier());
            return new BinanceSubscriptionTarget(symbol.getId(), symbol.getSymbol(), symbol.getProviderSymbol(), symbol.getProviderUnitMultiplier());
        } catch (IllegalArgumentException exception) { throw new BusinessException(ErrorCode.CANDLE_MAPPING_INVALID); }
    }
}
