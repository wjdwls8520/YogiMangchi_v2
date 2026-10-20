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
import com.yogimangchi.trading.position.service.HedgePositions;
import com.yogimangchi.trading.position.service.IsolatedMargin;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import com.yogimangchi.trading.tradingaccount.service.IsolatedCutover;
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
    private final IsolatedMargin isolated;
    private final IsolatedCutover cutover;
    private final LatestPriceStore livePrices;
    private final HedgePositions hedge;
    private final SymbolLeverageService leverage;
    public AccountTriggerService(AccountLock locks, WalletRepository wallets, PositionRepository positions,
            TradingOrderRepository orders, FillRepository fills, TradingSymbolRepository symbols,
            IsolatedMargin isolated, IsolatedCutover cutover, LatestPriceStore livePrices, HedgePositions hedge, SymbolLeverageService leverage) {
        this.locks=locks; this.wallets=wallets; this.positions=positions; this.orders=orders;
        this.fills=fills; this.symbols=symbols; this.isolated=isolated; this.cutover=cutover; this.livePrices=livePrices;
        this.hedge=hedge; this.leverage=leverage;
    }

    /** No Redis I/O here. Replay and live execution share the same account lock and atomic financial transaction. */
    @Transactional
    public void process(Long accountId, LatestMarkPrice tick, Map<Long, LatestMarkPrice> book) {
        TradingAccount account = locks.lock(accountId);
        if (account.getStatus() != TradingAccount.Status.ACTIVE) return;
        Wallet wallet = wallets.findById(accountId).orElseThrow();
        List<Position> open = new ArrayList<>(positions.findByAccountIdAndStatusOrderByIdAsc(accountId, Position.Status.OPEN));
        Map<Long, Position> byId = new HashMap<>();
        open.forEach(position -> byId.put(position.getId(), position));
        List<TradingOrder> pending = orders.findByAccountIdAndStatusOrderByIdAsc(accountId, TradingOrder.Status.PENDING);
        Set<Long> required = new HashSet<>(Set.of(tick.tradingSymbolId()));
        open.forEach(p -> required.add(p.getTradingSymbolId()));
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        var snapshots = snapshots(required, book, now);
        if (!cutover.activateIfSafe(account, wallet, open, snapshots, now)) return;
        // Each position needs only its own fresh Mark. An unavailable unrelated symbol cannot mask liquidation.
        for (Position position : List.copyOf(open)) {
            var snapshot = snapshots.get(position.getTradingSymbolId());
            if (snapshot.status() == LatestPriceStore.Status.FRESH
                    && isolated.risk(position, snapshot.latestPrice().orElseThrow().domainMarkPrice()).atRisk()) {
                liquidate(account, wallet, position, pending, snapshot.latestPrice().orElseThrow(), now);
                // Hibernate inserts IDENTITY rows before dirty updates. Release the OPEN unique key
                // before an independently pending OPEN can start a new lifecycle on this same tick.
                positions.flush();
                open.remove(position);
                byId.remove(position.getId());
            }
        }
        if (wallet.getBalance().signum() <= 0 && open.isEmpty()) account.declareBankrupt();
        if (account.getStatus() != TradingAccount.Status.ACTIVE
                || snapshots.get(tick.tradingSymbolId()).status() != LatestPriceStore.Status.FRESH) return;
        for (TradingOrder order : pending) {
            if (order.getStatus() != TradingOrder.Status.PENDING
                    || !order.getTradingSymbolId().equals(tick.tradingSymbolId()) || !order.crosses(tick.domainMarkPrice())
                    || order.getCreatedAt().isAfter(tick.receivedAt())) continue;
            if (order.getAction() == TradingOrder.Action.CLOSE) {
                close(order, byId, open, wallet, tick, now);
                account.recordFinancialChange(now);
                continue;
            }
            String rejection = null;
            BigDecimal margin = null;
            int effectiveLeverage = leverage.current(accountId, order.getTradingSymbolId());
            if (order.getLeverage() != effectiveLeverage) throw new IllegalStateException("Pending reservation leverage differs from symbol setting");
            try { margin = hedge.additionalMargin(open, order.getTradingSymbolId(), order.getSide(), order.getQuantity(), tick.domainMarkPrice(), effectiveLeverage); }
            catch (IllegalArgumentException exception) { rejection = "UNSUPPORTED_EXECUTION_NOTIONAL"; }
            if (symbols.findById(order.getTradingSymbolId()).filter(s -> s.getStatus()==TradingSymbolStatus.ACTIVE).isEmpty())
                rejection = "SYMBOL_NOT_ACTIVE";
            if (open.size() >= TradingMath.MAX_OPEN_POSITIONS && hedge.existing(open, order.getTradingSymbolId(), order.getSide()) == null) rejection = "POSITION_LIMIT";
            wallet.releaseReservation(order.getReservedMargin());
            BigDecimal available = TradingMath.available(wallet.getBalance(), wallet.getUsedMargin(), wallet.getReservedMargin());
            if (margin != null && margin.compareTo(available) > 0) rejection = "INSUFFICIENT_MARGIN";
            if (margin != null && isolated.projectedOpenRisk(hedge.existing(open, order.getTradingSymbolId(), order.getSide()),
                    order.getSide(), order.getQuantity(), tick.domainMarkPrice(), effectiveLeverage, tick.domainMarkPrice()).atRisk())
                rejection = "ACCOUNT_AT_RISK";
            if (rejection != null) {
                order.reject(rejection, now);
                committed("rejected", accountId, order.getId(), tick.tradingSymbolId());
            } else {
                Position position = hedge.apply(open, accountId, order.getTradingSymbolId(), order.getSide(),
                        order.getQuantity(), tick.domainMarkPrice(), effectiveLeverage, now);
                wallet.openMargin(margin);
                order.fill(position, tick.domainMarkPrice(), now);
                fills.save(Fill.execute(order.getId(), tick.domainMarkPrice(), order.getQuantity(), tick.eventTime(), now, BigDecimal.ZERO));
                byId.put(position.getId(), position);
                committed("limit-filled", accountId, order.getId(), tick.tradingSymbolId());
            }
            account.recordFinancialChange(now);
        }
    }

    private void close(TradingOrder order, Map<Long, Position> byId, List<Position> open, Wallet wallet,
            LatestMarkPrice price, Instant now) {
        Position target = Objects.requireNonNull(byId.get(order.getPositionId()), "Pending CLOSE must reference an open lot");
        // Release only this order's reservation. Other pending CLOSE orders keep their reserved quantity.
        target.releaseCloseReservation(order.getQuantity());
        BigDecimal pnl = target.closingPnl(order.getQuantity(), price.domainMarkPrice());
        if (wallet.getBalance().add(pnl).signum() < 0) {
            order.reject("INSUFFICIENT_SETTLEMENT_CASH", now);
            committed("close-rejected", order.getAccountId(), order.getId(), order.getTradingSymbolId());
            return;
        }
        Position.Settlement settlement = target.close(order.getQuantity(), price.domainMarkPrice(), now, false);
        wallet.settle(settlement.releasedMargin(), settlement.realizedPnl());
        order.fill(target, price.domainMarkPrice(), now);
        fills.save(Fill.execute(order.getId(), price.domainMarkPrice(), settlement.quantity(), price.eventTime(), now, settlement.realizedPnl()));
        if (target.getStatus() != Position.Status.OPEN) { open.remove(target); byId.remove(target.getId()); }
        committed("limit-close-filled", order.getAccountId(), order.getId(), order.getTradingSymbolId());
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

    private void liquidate(TradingAccount account, Wallet wallet, Position position, List<TradingOrder> pending,
            LatestMarkPrice price, Instant now) {
        for (TradingOrder order : pending) {
            if (order.getStatus() == TradingOrder.Status.PENDING && order.getAction() == TradingOrder.Action.CLOSE
                    && position.getId().equals(order.getPositionId())) {
                position.releaseCloseReservation(order.getQuantity());
                order.reject("POSITION_LIQUIDATION", now);
            }
        }
        BigDecimal fee = isolated.liquidationFee(price.domainMarkPrice(), position.getQuantity());
        Position.Settlement settlement = position.close(position.getQuantity(), price.domainMarkPrice(), now, true);
        var costs = isolated.liquidationSettlement(settlement.releasedMargin(), settlement.realizedPnl(), fee);
        wallet.settle(settlement.releasedMargin(), costs.grossPnl(), costs.fee(), costs.shortfallAdjustment());
        // ':' cannot occur in any accepted client key. A retried completed lifecycle cannot settle twice.
        String key = "liquidation:position:" + position.getId();
        TradingOrder order = orders.save(TradingOrder.market(position, TradingOrder.Action.LIQUIDATE,
                settlement.quantity(), price.domainMarkPrice(), key, "0".repeat(64), now));
        fills.save(Fill.execute(order.getId(), price.domainMarkPrice(), settlement.quantity(), price.eventTime(), now,
                costs.grossPnl(), costs.fee(), costs.shortfallAdjustment()));
        committed("liquidated", account.getId(), order.getId(), position.getTradingSymbolId());
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
