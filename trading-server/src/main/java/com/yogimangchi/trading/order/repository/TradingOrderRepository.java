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
    @Query("select o from TradingOrder o where o.accountId=:accountId and o.id<:beforeId order by o.id desc")
    List<TradingOrder> history(Long accountId, Long beforeId, Pageable page);
}

