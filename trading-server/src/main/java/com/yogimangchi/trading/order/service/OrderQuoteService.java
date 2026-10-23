package com.yogimangchi.trading.order.service;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.*;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.leverage.service.SymbolLeverageService;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.position.service.*;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.service.*;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import com.yogimangchi.trading.tradingsymbol.repository.TradingSymbolRepository;
import java.math.*;
import java.util.*;
import java.util.function.Function;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderQuoteService {
    private final AccountLock locks;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final TradingSymbolRepository symbols;
    private final SymbolLeverageService leverages;
    private final AccountValuation valuation;
    private final TradingEngineGate gate;
    private final HedgePositions hedge;
    private final IsolatedMargin isolated;

    public OrderQuoteService(AccountLock locks, WalletRepository wallets, PositionRepository positions,
            TradingSymbolRepository symbols, SymbolLeverageService leverages, AccountValuation valuation,
            TradingEngineGate gate, HedgePositions hedge, IsolatedMargin isolated) {
        this.locks=locks; this.wallets=wallets; this.positions=positions; this.symbols=symbols;
        this.leverages=leverages; this.valuation=valuation; this.gate=gate; this.hedge=hedge; this.isolated=isolated;
    }

    @Transactional
    public OrderQuoteResponse quote(Long accountId, OrderQuoteRequest request) {
        if (request == null || request.type() == null || request.side() == null || request.tradingSymbolId() == null
                || request.tradingSymbolId() <= 0 || (request.quantity() == null) == (request.balancePercentage() == null)
                || request.balancePercentage() != null && (request.balancePercentage() < 1 || request.balancePercentage() > 100)
                || request.type() == TradingOrder.Type.MARKET && request.limitPrice() != null)
            throw new BusinessException(ErrorCode.INVALID_ORDER);
        gate.enterTradingTransaction();
        var account=locks.lock(accountId);
        if (account.getStatus() != TradingAccount.Status.ACTIVE) throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        if (!account.isIsolated()) throw new BusinessException(ErrorCode.MARGIN_MIGRATION_REQUIRED);
        if (symbols.findById(request.tradingSymbolId()).filter(s -> s.getStatus()==TradingSymbolStatus.ACTIVE).isEmpty())
            throw new BusinessException(ErrorCode.SYMBOL_NOT_AVAILABLE);
        var wallet=wallets.findById(accountId).orElseThrow();
        var open=positions.findByAccountIdAndStatusOrderByIdAsc(accountId, Position.Status.OPEN);
        Position target=hedge.existing(open, request.tradingSymbolId(), request.side());
        if (open.size() >= TradingMath.MAX_OPEN_POSITIONS && target==null) throw new BusinessException(ErrorCode.POSITION_LIMIT_REACHED);
        var value=valuation.calculate(wallet, open.stream().filter(p -> p.getTradingSymbolId().equals(request.tradingSymbolId())).toList(), Set.of(request.tradingSymbolId()));
        if (!value.fresh()) throw new BusinessException(ErrorCode.PRICE_NOT_FRESH);
        gate.requireCaughtUp(value.prices());
        var mark=value.prices().get(request.tradingSymbolId()).latestPrice().orElseThrow();
        BigDecimal price=request.type()==TradingOrder.Type.LIMIT ? request.limitPrice() : mark.domainMarkPrice();
        try { TradingMath.validatePrice(price); }
        catch (IllegalArgumentException e) { throw new BusinessException(ErrorCode.INVALID_ORDER); }
        if (request.type()==TradingOrder.Type.LIMIT && (request.side()==Position.Side.LONG
                ? price.compareTo(mark.domainMarkPrice())>=0 : price.compareTo(mark.domainMarkPrice())<=0))
            throw new BusinessException(ErrorCode.MARKETABLE_LIMIT_NOT_ALLOWED);
        if (target!=null && isolated.risk(target,mark.domainMarkPrice()).atRisk()) throw new BusinessException(ErrorCode.ACCOUNT_AT_RISK);
        int leverage=leverages.current(accountId,request.tradingSymbolId());
        BigDecimal rate=TradingFees.rate(request.type());
        Function<BigDecimal,BigDecimal> margin=q -> request.type()==TradingOrder.Type.LIMIT
                ? TradingMath.margin(price,q,leverage)
                : hedge.additionalMargin(open,request.tradingSymbolId(),request.side(),q,price,leverage);
        BigDecimal quantity=request.quantity();
        try {
            if (quantity==null) {
                BigDecimal budget=value.availableBalance().multiply(BigDecimal.valueOf(request.balancePercentage()))
                        .divide(BigDecimal.valueOf(100),TradingMath.AMOUNT_SCALE,RoundingMode.DOWN);
                BigDecimal cap=TradingMath.MAX_NOTIONAL.divide(price,TradingMath.QUANTITY_SCALE,RoundingMode.DOWN).min(TradingMath.MAX_QUANTITY);
                if (target!=null) cap=cap.min(TradingMath.MAX_QUANTITY.subtract(target.getQuantity()))
                        .min(TradingMath.MAX_NOTIONAL.subtract(target.getEntryNotional()).divide(price,TradingMath.QUANTITY_SCALE,RoundingMode.DOWN));
                BigDecimal minimum=TradingMath.MIN_ORDER_NOTIONAL.divide(price,TradingMath.QUANTITY_SCALE,RoundingMode.CEILING);
                quantity=size(minimum,cap,budget,q -> margin.apply(q).add(TradingFees.fee(price,q,rate)));
                if (quantity==null) throw new BusinessException(ErrorCode.INSUFFICIENT_MARGIN);
            }
            TradingMath.validateNewOrder(quantity,leverage,price);
            if (target!=null) {
                TradingMath.validateQuantity(target.getQuantity().add(quantity));
                if (target.getEntryNotional().add(price.multiply(quantity)).compareTo(TradingMath.MAX_NOTIONAL)>0)
                    throw new IllegalArgumentException("Position notional limit exceeded");
            }
            BigDecimal allocated=margin.apply(quantity), fee=TradingFees.fee(price,quantity,rate);
            if (allocated.add(fee).compareTo(value.availableBalance())>0) throw new BusinessException(ErrorCode.INSUFFICIENT_MARGIN);
            if (isolated.projectedOpenRisk(target,request.side(),quantity,price,leverage,mark.domainMarkPrice()).atRisk())
                throw new BusinessException(ErrorCode.ACCOUNT_AT_RISK);
            return new OrderQuoteResponse(request.tradingSymbolId(),request.type().name(),request.side().name(),leverage,
                    quantity.setScale(TradingMath.QUANTITY_SCALE).toPlainString(),price.toPlainString(),price.multiply(quantity).toPlainString(),
                    allocated.toPlainString(),rate.toPlainString(),fee.toPlainString(),allocated.add(fee).toPlainString(),
                    value.availableBalance().toPlainString(),request.balancePercentage(),mark.eventTime(),value.capturedAt());
        } catch (IllegalArgumentException | ArithmeticException e) { throw new BusinessException(ErrorCode.INVALID_ORDER); }
    }

    /** Integer quantity grid and exact ledger costs; at most 67 iterations for the supported quantity range. */
    static BigDecimal size(BigDecimal minimum, BigDecimal maximum, BigDecimal budget, Function<BigDecimal,BigDecimal> cost) {
        BigInteger low=minimum.movePointRight(TradingMath.QUANTITY_SCALE).toBigIntegerExact();
        BigInteger high=maximum.movePointRight(TradingMath.QUANTITY_SCALE).toBigIntegerExact();
        BigInteger best=null;
        while (low.compareTo(high)<=0) {
            BigInteger middle=low.add(high).shiftRight(1);
            BigDecimal quantity=new BigDecimal(middle,TradingMath.QUANTITY_SCALE);
            if (cost.apply(quantity).compareTo(budget)<=0) { best=middle; low=middle.add(BigInteger.ONE); }
            else high=middle.subtract(BigInteger.ONE);
        }
        return best==null ? null : new BigDecimal(best,TradingMath.QUANTITY_SCALE);
    }
}
