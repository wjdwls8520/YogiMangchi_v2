package com.yogimangchi.trading.order.repository;
import com.yogimangchi.trading.order.entity.TradingOrder;
import java.util.*;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
public interface TradingOrderRepository extends Repository<TradingOrder, Long> {
    TradingOrder save(TradingOrder order);
    Optional<TradingOrder> findByAccountIdAndIdempotencyKey(Long accountId, String key);
    Optional<TradingOrder> findById(Long id);
    List<TradingOrder> findByAccountIdAndStatusOrderByIdAsc(Long accountId, TradingOrder.Status status);
    @Query("select o from TradingOrder o where o.accountId=:accountId and o.id<:beforeId order by o.id desc")
    List<TradingOrder> history(Long accountId, Long beforeId, Pageable page);
    @Query("select o from TradingOrder o where o.accountId=:accountId and o.id<:beforeId "
            + "and (:symbolId is null or o.tradingSymbolId=:symbolId) and (:side is null or o.side=:side) "
            + "and (:action is null or o.action=:action) and (:status is null or o.status=:status) "
            + "and (:type is null or o.type=:type) order by o.id desc")
    List<TradingOrder> filteredHistory(Long accountId,Long beforeId,Long symbolId,
            com.yogimangchi.trading.position.entity.Position.Side side,TradingOrder.Action action,
            TradingOrder.Status status,TradingOrder.Type type,Pageable page);
    @Query("select o from TradingOrder o where o.accountId=:accountId and o.id<:beforeId "
            + "and (:symbolId is null or o.tradingSymbolId=:symbolId) "
            + "and exists (select 1 from TradingSymbol s where s.id=o.tradingSymbolId and (upper(s.symbol) like :symbolPattern or upper(s.providerSymbol) like :symbolPattern or concat(upper(s.symbol),upper(s.quoteAsset)) like :symbolPattern)) "
            + "and (:side is null or o.side=:side) "
            + "and (:action is null or o.action=:action) and (:status is null or o.status=:status) "
            + "and (:type is null or o.type=:type) "
            + "and o.createdAt>=:createdFrom and o.createdAt<:createdBefore "
            + "order by o.id desc")
    List<TradingOrder> filteredHistoryExtended(Long accountId,Long beforeId,Long symbolId,String symbolPattern,
            com.yogimangchi.trading.position.entity.Position.Side side,TradingOrder.Action action,
            TradingOrder.Status status,TradingOrder.Type type,java.time.Instant createdFrom,java.time.Instant createdBefore,Pageable page);
}
