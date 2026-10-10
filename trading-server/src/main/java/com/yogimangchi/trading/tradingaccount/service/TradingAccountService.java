package com.yogimangchi.trading.tradingaccount.service;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.tradingaccount.dto.*;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.repository.TradingAccountRepository;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.security.GuestCredentials;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TradingAccountService {
    private static final Logger log = LoggerFactory.getLogger(TradingAccountService.class);
    private final TradingAccountRepository accounts;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final AccountLock accountLock;
    private final AccountValuation valuation;

    public TradingAccountService(TradingAccountRepository accounts, WalletRepository wallets,
            PositionRepository positions, AccountLock accountLock, AccountValuation valuation) {
        this.accounts = accounts;
        this.wallets = wallets;
        this.positions = positions;
        this.accountLock = accountLock;
        this.valuation = valuation;
    }

    @Transactional
    public GuestAccountResponse createGuest() {
        String token = GuestCredentials.issue();
        Instant now = Instant.now();
        TradingAccount account = accounts.save(TradingAccount.guest(GuestCredentials.hash(token), now.plus(Duration.ofDays(7)), now));
        Wallet wallet = wallets.save(Wallet.open(account.getId()));
        log.info("[Trading account] guest created accountId={}", account.getId());
        return new GuestAccountResponse(account.getId(), account.getStatus().name(), "USDT", decimal(wallet.getBalance()),
                token, "Bearer", account.getCredentialExpiresAt());
    }

    @Transactional
    public AccountSummaryResponse summary(Long accountId) {
        // Reads use the same short account lock so wallet and positions cannot span different commits.
        TradingAccount account = accountLock.lock(accountId);
        Wallet wallet = wallets.findById(accountId).orElseThrow(() -> new IllegalStateException("Account wallet missing"));
        List<Position> open = positions.findByAccountIdAndStatusOrderByIdAsc(accountId, Position.Status.OPEN);
        AccountValuation.Value value = valuation.calculate(wallet, open);
        WalletResponse walletResponse = new WalletResponse("USDT", decimal(wallet.getBalance()), decimal(wallet.getUsedMargin()),
                decimal(wallet.getReservedMargin()), decimal(wallet.getRealizedPnl()), decimal(value.unrealizedPnl()),
                decimal(value.equity()), decimal(value.availableBalance()), value.fresh() ? "FRESH" : "UNAVAILABLE");
        return new AccountSummaryResponse(account.getId(), account.getStatus().name(), account.getCreatedAt(), walletResponse,
                open.stream().map(position -> response(position, value.prices().get(position.getTradingSymbolId()))).toList(), value.capturedAt());
    }

    private PositionResponse response(Position position, LatestPriceStore.Snapshot snapshot) {
        boolean fresh = snapshot.status() == LatestPriceStore.Status.FRESH;
        BigDecimal mark = fresh ? snapshot.latestPrice().orElseThrow().domainMarkPrice() : null;
        BigDecimal pnl = fresh ? TradingMath.pnl(position.getSide(), position.getEntryPrice(), mark, position.getQuantity()) : null;
        return new PositionResponse(position.getId(), position.getTradingSymbolId(), position.getSide().name(), decimal(position.getQuantity()),
                decimal(position.getReservedCloseQuantity()), decimal(position.getFreeCloseQuantity()),
                decimal(position.getEntryPrice()), position.getLeverage(), decimal(position.getMargin()), position.getStatus().name(),
                decimal(position.getRealizedPnl()), decimal(mark), decimal(pnl), snapshot.status().name(),
                snapshot.latestPrice().map(price -> price.eventTime()).orElse(null), position.getOpenedAt());
    }

    private static String decimal(BigDecimal value) { return value == null ? null : value.toPlainString(); }
}
