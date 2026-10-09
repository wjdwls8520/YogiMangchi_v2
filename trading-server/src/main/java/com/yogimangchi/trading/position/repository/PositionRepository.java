package com.yogimangchi.trading.position.repository;

import com.yogimangchi.trading.position.entity.Position;
import java.util.List;
import java.util.Optional;
import org.springframework.data.repository.Repository;

public interface PositionRepository extends Repository<Position, Long> {
    Position save(Position position);
    Optional<Position> findById(Long id);
    List<Position> findByAccountIdAndStatusOrderByIdAsc(Long accountId, Position.Status status);
}
