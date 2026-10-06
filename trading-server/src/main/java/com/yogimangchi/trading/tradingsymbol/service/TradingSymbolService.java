package com.yogimangchi.trading.tradingsymbol.service;

import com.yogimangchi.trading.tradingsymbol.dto.TradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import com.yogimangchi.trading.tradingsymbol.repository.TradingSymbolRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class TradingSymbolService {

    private final TradingSymbolRepository repository;

    public TradingSymbolService(TradingSymbolRepository repository) {
        this.repository = repository;
    }

    public List<TradingSymbolResponse> findActiveSymbols() {
        return repository.findAllByStatus(TradingSymbolStatus.ACTIVE);
    }
}
