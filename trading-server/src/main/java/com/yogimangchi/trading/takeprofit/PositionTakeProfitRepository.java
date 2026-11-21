package com.yogimangchi.trading.takeprofit;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.repository.Repository;

public interface PositionTakeProfitRepository extends Repository<PositionTakeProfit, Long> {
    void flush();
    PositionTakeProfit save(PositionTakeProfit takeProfit);
    Optional<PositionTakeProfit> findById(Long positionId);
    List<PositionTakeProfit> findByPositionIdIn(Collection<Long> positionIds);
    List<PositionTakeProfit> findByAccountIdAndStatus(Long accountId, PositionTakeProfit.Status status);
}
