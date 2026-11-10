package com.yogimangchi.trading.tradingaccount.repository;

import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.repository.Repository;

public interface WalletRepository extends Repository<Wallet, Long> {
    Wallet save(Wallet wallet);
    Optional<Wallet> findById(Long accountId);
    List<Wallet> findByAccountIdIn(Collection<Long> accountIds);
}
