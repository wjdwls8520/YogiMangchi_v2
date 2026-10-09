package com.yogimangchi.trading.tradingaccount.security;

import com.yogimangchi.trading.tradingaccount.repository.TradingAccountRepository;
import java.time.Instant;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GuestCredentialService {
    private final TradingAccountRepository accounts;
    public GuestCredentialService(TradingAccountRepository accounts) { this.accounts = accounts; }

    @Transactional(readOnly = true)
    public Optional<GuestPrincipal> authenticate(String token) {
        if (!GuestCredentials.isValidFormat(token)) return Optional.empty();
        return accounts.findByCredentialHash(GuestCredentials.hash(token))
                .filter(account -> account.getCredentialExpiresAt().isAfter(Instant.now()))
                .map(account -> new GuestPrincipal(account.getId()));
    }
}
