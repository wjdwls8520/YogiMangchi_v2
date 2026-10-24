package com.yogimangchi.trading.leverage.service;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.execution.TradingFees;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.leverage.dto.LeverageResponse;
import com.yogimangchi.trading.leverage.entity.SymbolLeverage;
import com.yogimangchi.trading.leverage.repository.SymbolLeverageRepository;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.repository.TradingOrderRepository;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.service.IsolatedMargin;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.service.*;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import com.yogimangchi.trading.tradingsymbol.repository.TradingSymbolRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SymbolLeverageService {
    private final AccountLock locks;
    private final SymbolLeverageRepository settings;
    private final PositionRepository positions;
    private final TradingOrderRepository orders;
    private final WalletRepository wallets;
    private final TradingSymbolRepository symbols;
    private final AccountValuation valuation;
    private final TradingEngineGate gate;
    private final IsolatedMargin isolated;

    public SymbolLeverageService(AccountLock locks, SymbolLeverageRepository settings, PositionRepository positions,
            TradingOrderRepository orders, WalletRepository wallets, TradingSymbolRepository symbols,
            AccountValuation valuation, TradingEngineGate gate, IsolatedMargin isolated) {
        this.locks=locks; this.settings=settings; this.positions=positions; this.orders=orders;
        this.wallets=wallets; this.symbols=symbols; this.valuation=valuation; this.gate=gate;
        this.isolated=isolated;
    }

    /** Used under AccountLock. No implicit setting changes from an OPEN order. */
    public int current(Long accountId, Long symbolId, Position.Side side) {
        requireSide(side);
        return settings.findByAccountIdAndTradingSymbolIdAndSide(accountId, symbolId, side)
                .map(SymbolLeverage::getLeverage).orElse(TradingMath.DEFAULT_LEVERAGE);
    }

    @Transactional
    public LeverageResponse get(Long accountId, Long symbolId, Position.Side side) {
        TradingAccount account = locks.lock(accountId); requireSymbol(symbolId); requireSide(side);
        return settings.findByAccountIdAndTradingSymbolIdAndSide(accountId, symbolId, side)
                .map(s -> response(account, symbolId, side, s.getLeverage(), s.getUpdatedAt()))
                .orElseGet(() -> response(account, symbolId, side, TradingMath.DEFAULT_LEVERAGE, null));
    }

    @Transactional
    public LeverageResponse change(Long accountId, Long symbolId, Position.Side side, Integer leverage) {
        if (leverage == null || leverage < 1 || leverage > TradingMath.MAX_LEVERAGE) throw new BusinessException(ErrorCode.INVALID_LEVERAGE);
        gate.enterTradingTransaction();
        TradingAccount account = locks.lock(accountId);
        gate.requireAccountClear(accountId);
        requireSymbol(symbolId); requireSide(side);
        if (account.getStatus() != TradingAccount.Status.ACTIVE) throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        if (!account.isIsolated()) throw new BusinessException(ErrorCode.MARGIN_MIGRATION_REQUIRED);
        var previous = settings.findByAccountIdAndTradingSymbolIdAndSide(accountId, symbolId, side);
        if (previous.isPresent() && previous.get().getLeverage() == leverage) return response(account, symbolId, side, leverage, previous.get().getUpdatedAt());
        var wallet = wallets.findById(accountId).orElseThrow();
        var open = positions.findByAccountIdAndStatusOrderByIdAsc(accountId, Position.Status.OPEN);
        var affected = open.stream().filter(p -> p.getTradingSymbolId().equals(symbolId) && p.getSide() == side).toList();
        var pending = orders.findByAccountIdAndStatusOrderByIdAsc(accountId, TradingOrder.Status.PENDING).stream()
                .filter(o -> o.getTradingSymbolId().equals(symbolId) && o.getSide() == side && o.getAction() == TradingOrder.Action.OPEN).toList();
        BigDecimal usedDelta = affected.stream().map(p -> p.marginAtLeverage(leverage).subtract(p.getMargin())).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal reservedDelta = pending.stream().map(o -> TradingFees.reservation(o.getLimitPrice(), o.getQuantity(), leverage, o.getFeeRate())
                .subtract(o.getReservedMargin())).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (!affected.isEmpty() || !pending.isEmpty()) {
            var value = valuation.calculate(wallet, affected, java.util.Set.of(symbolId));
            if (!value.fresh()) throw new BusinessException(ErrorCode.PRICE_NOT_FRESH);
            gate.requireCaughtUp(value.prices());
            var mark = value.prices().get(symbolId).latestPrice().orElseThrow().domainMarkPrice();
            if (affected.stream().anyMatch(p -> isolated.risk(p, mark).atRisk()
                    || isolated.risk(p.getSide(), p.getQuantity(), p.getEntryNotional(), p.marginAtLeverage(leverage), mark).atRisk()))
                throw new BusinessException(ErrorCode.ACCOUNT_AT_RISK);
            BigDecimal capacity = wallet.getBalance();
            if (wallet.getUsedMargin().add(usedDelta).add(wallet.getReservedMargin()).add(reservedDelta).compareTo(capacity) > 0)
                throw new BusinessException(ErrorCode.INSUFFICIENT_MARGIN);
        }
        wallet.reallocateMargin(wallet.getUsedMargin().add(usedDelta), wallet.getReservedMargin().add(reservedDelta));
        affected.forEach(p -> p.changeLeverage(leverage));
        pending.forEach(o -> o.repricePendingOpen(leverage));
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        var setting = previous.orElseGet(() -> SymbolLeverage.configure(accountId, symbolId, side, leverage, now));
        setting.change(leverage, now);
        settings.save(setting);
        // A preference-only change does not turn an otherwise unused Guest into permanent financial history.
        if (!affected.isEmpty() || !pending.isEmpty()) account.recordFinancialChange(now);
        return response(account, symbolId, side, leverage, now);
    }

    private static void requireSide(Position.Side side) {
        if (side == null) throw new BusinessException(ErrorCode.INVALID_ORDER);
    }

    private void requireSymbol(Long symbolId) {
        if (symbolId == null || symbolId <= 0 || symbols.findById(symbolId).filter(s -> s.getStatus() == TradingSymbolStatus.ACTIVE).isEmpty())
            throw new BusinessException(ErrorCode.SYMBOL_NOT_AVAILABLE);
    }
    private static LeverageResponse response(TradingAccount account, Long symbolId, Position.Side side, int leverage, Instant updated) {
        return new LeverageResponse(symbolId, side, leverage, TradingMath.MAX_LEVERAGE, account.getMarginMode(), updated,
                account.getMarginTransitionStatus().name());
    }
}
