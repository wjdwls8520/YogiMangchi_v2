package com.yogimangchi.trading.binance.subscription;

import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbol;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolProvider;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface BinanceSubscriptionTargetRepository extends Repository<TradingSymbol, Long> {

    @Query("""
            select new com.yogimangchi.trading.binance.subscription.BinanceSubscriptionTarget(
                s.id, s.symbol, s.providerSymbol)
            from TradingSymbol s
            where s.status = :status and s.provider = :provider
            order by s.id asc
            """)
    List<BinanceSubscriptionTarget> findAllByStatusAndProvider(
            @Param("status") TradingSymbolStatus status,
            @Param("provider") TradingSymbolProvider provider);
}
