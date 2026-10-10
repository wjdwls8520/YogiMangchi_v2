package com.yogimangchi.trading.execution.trigger;

import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.fill.entity.Fill;
import com.yogimangchi.trading.fill.repository.FillRepository;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.repository.TradingOrderRepository;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import com.yogimangchi.trading.tradingaccount.service.AccountValuation;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import com.yogimangchi.trading.tradingsymbol.repository.TradingSymbolRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class AccountTriggerService {
    private static final Logger log = LoggerFactory.getLogger(AccountTriggerService.class);
    private final AccountLock locks;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final TradingOrderRepository orders;
    private final FillRepository fills;
    private final TradingSymbolRepository symbols;
    private final AccountValuation valuation;
    private final LatestPriceStore livePrices;
    public AccountTriggerService(AccountLock locks, WalletRepository wallets, PositionRepository positions,
            TradingOrderRepository orders, FillRepository fills, TradingSymbolRepository symbols,
            AccountValuation valuation, LatestPriceStore livePrices) {
        this.locks=locks; this.wallets=wallets; this.positions=positions; this.orders=orders;
        this.fills=fills; this.symbols=symbols; this.valuation=valuation; this.livePrices=livePrices;
    }

    /** No Redis I/O here. Replay and live execution share the same account lock and atomic financial transaction. */
    @Transactional
    public void process(Long accountId, LatestMarkPrice tick, Map<Long, LatestMarkPrice> book) {
        TradingAccount account = locks.lock(accountId);
        if (account.getStatus() != TradingAccount.Status.ACTIVE) return;
        Wallet wallet = wallets.findById(accountId).orElseThrow();
        List<Position> open = new ArrayList<>(positions.findByAccountIdAndStatusOrderByIdAsc(accountId, Position.Status.OPEN));
        List<TradingOrder> pending = orders.findByAccountIdAndStatusOrderByIdAsc(accountId, TradingOrder.Status.PENDING);
        Set<Long> required = new HashSet<>(Set.of(tick.tradingSymbolId()));
        open.forEach(p -> required.add(p.getTradingSymbolId()));
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        var snapshots = snapshots(required, book, now);
        AccountValuation.Value value = valuation.evaluate(wallet, open, snapshots, now);
        if (!value.fresh()) return; // Re-evaluated on the next affected symbol tick; never invent a missing mark.
        if (!open.isEmpty() && value.equity().compareTo(value.maintenanceMargin()) <= 0) {
            liquidate(account, wallet, open, pending, book, now);
            return;
        }
        for (TradingOrder order : pending) {
            if (!order.getTradingSymbolId().equals(tick.tradingSymbolId()) || !order.crosses(tick.domainMarkPrice())
                    || order.getCreatedAt().isAfter(tick.receivedAt())) continue;
            String rejection = null;
            BigDecimal margin = null;
            try { margin = TradingMath.margin(tick.domainMarkPrice(), order.getQuantity(), order.getLeverage()); }
            catch (IllegalArgumentException exception) { rejection = "UNSUPPORTED_EXECUTION_NOTIONAL"; }
            if (symbols.findById(order.getTradingSymbolId()).filter(s -> s.getStatus()==TradingSymbolStatus.ACTIVE).isEmpty())
                rejection = "SYMBOL_NOT_ACTIVE";
            if (open.size() >= TradingMath.MAX_OPEN_POSITIONS) rejection = "POSITION_LIMIT";
            wallet.releaseReservation(order.getReservedMargin());
            value = valuation.evaluate(wallet, open, snapshots, now);
            if (margin != null && margin.compareTo(value.availableBalance()) > 0) rejection = "INSUFFICIENT_MARGIN";
            if (value.equity().compareTo(value.maintenanceMargin().add(TradingMath.maintenance(tick.domainMarkPrice(), order.getQuantity()))) <= 0)
                rejection = "ACCOUNT_AT_RISK";
            if (rejection != null) {
                order.reject(rejection, now);
                committed("rejected", accountId, order.getId(), tick.tradingSymbolId());
            } else {
                Position position = positions.save(Position.open(accountId, order.getTradingSymbolId(), order.getSide(),
                        order.getQuantity(), tick.domainMarkPrice(), order.getLeverage(), now));
                wallet.openMargin(margin);
                order.fill(position, tick.domainMarkPrice(), now);
                fills.save(Fill.execute(order.getId(), tick.domainMarkPrice(), order.getQuantity(), tick.eventTime(), now, BigDecimal.ZERO));
                open.add(position);
                committed("limit-filled", accountId, order.getId(), tick.tradingSymbolId());
            }
            account.recordFinancialChange(now);
        }
    }

    private Map<Long, LatestPriceStore.Snapshot> snapshots(Set<Long> ids, Map<Long, LatestMarkPrice> book, Instant now) {
        Map<Long, LatestPriceStore.Snapshot> live = livePrices.findAll(ids);
        Map<Long, LatestPriceStore.Snapshot> result = new HashMap<>();
        for (Long id : ids) {
            LatestMarkPrice historical = book.get(id);
            boolean fresh = historical != null && LatestPriceStore.isFreshAt(historical, now)
                    && live.get(id).status() == LatestPriceStore.Status.FRESH;
            result.put(id, new LatestPriceStore.Snapshot(fresh ? LatestPriceStore.Status.FRESH : LatestPriceStore.Status.UNAVAILABLE,
                    Optional.ofNullable(historical)));
        }
        return result;
    }

    private void liquidate(TradingAccount account, Wallet wallet, List<Position> open, List<TradingOrder> pending,
            Map<Long, LatestMarkPrice> book, Instant now) {
        for (TradingOrder order : pending) {
            wallet.releaseReservation(order.getReservedMargin());
            order.reject("ACCOUNT_LIQUIDATION", now);
        }
        for (Position position : open) {
            LatestMarkPrice price = book.get(position.getTradingSymbolId());
            Position.Settlement settlement = position.close(position.getQuantity(), price.domainMarkPrice(), now, true);
            wallet.settle(settlement.releasedMargin(), settlement.realizedPnl());
            // ':' cannot occur in any accepted client key, including orders created before this migration.
            String key = "liquidation:position:" + position.getId();
            TradingOrder order = orders.save(TradingOrder.market(position, TradingOrder.Action.LIQUIDATE,
                    settlement.quantity(), price.domainMarkPrice(), key, "0".repeat(64), now));
            fills.save(Fill.execute(order.getId(), price.domainMarkPrice(), settlement.quantity(), price.eventTime(), now, settlement.realizedPnl()));
            committed("liquidated", account.getId(), order.getId(), position.getTradingSymbolId());
        }
        if (wallet.getBalance().signum() <= 0) account.declareBankrupt();
        account.recordFinancialChange(now);
    }

    private void committed(String result, Long accountId, Long orderId, Long symbolId) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                log.info("[Trading trigger] result={} accountId={} orderId={} symbolId={}", result, accountId, orderId, symbolId);
            }
        });
    }
}
