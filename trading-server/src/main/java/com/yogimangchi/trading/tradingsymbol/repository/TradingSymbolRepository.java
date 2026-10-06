package com.yogimangchi.trading.tradingsymbol.repository;

import com.yogimangchi.trading.tradingsymbol.dto.TradingSymbolResponse;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

// Expose only the query needed now; no inherited hard-delete or administration operations.
public interface TradingSymbolRepository extends Repository<TradingSymbol, Long> {

    @Query("""
            select new com.yogimangchi.trading.tradingsymbol.dto.TradingSymbolResponse(
                s.id, s.symbol, s.name, s.quoteAsset)
            from TradingSymbol s
            where s.status = :status
            order by s.symbol asc, s.id asc
            """)
    List<TradingSymbolResponse> findAllByStatus(@Param("status") TradingSymbolStatus status);
}
