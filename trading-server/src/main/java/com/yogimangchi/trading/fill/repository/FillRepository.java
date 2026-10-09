package com.yogimangchi.trading.fill.repository;
import com.yogimangchi.trading.fill.entity.Fill;
import java.util.*;
import org.springframework.data.repository.Repository;
public interface FillRepository extends Repository<Fill, Long> {
    Fill save(Fill fill);
    Optional<Fill> findByOrderId(Long orderId);
    List<Fill> findByOrderIdIn(Collection<Long> orderIds);
}

