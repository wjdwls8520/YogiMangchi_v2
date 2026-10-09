package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.fill.entity.Fill;
import com.yogimangchi.trading.fill.repository.FillRepository;
import com.yogimangchi.trading.marketdata.LatestMarkPrice;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.repository.TradingOrderRepository;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.tradingaccount.entity.*;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.service.*;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import com.yogimangchi.trading.tradingsymbol.repository.TradingSymbolRepository;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;
import org.slf4j.*;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MarketOrderService {
    private static final Logger log = LoggerFactory.getLogger(MarketOrderService.class);
    private final AccountLock locks;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final TradingOrderRepository orders;
    private final FillRepository fills;
    private final TradingSymbolRepository symbols;
    private final AccountValuation valuation;

    public MarketOrderService(AccountLock locks, WalletRepository wallets, PositionRepository positions,
            TradingOrderRepository orders, FillRepository fills, TradingSymbolRepository symbols, AccountValuation valuation) {
        this.locks=locks; this.wallets=wallets; this.positions=positions; this.orders=orders;
        this.fills=fills; this.symbols=symbols; this.valuation=valuation;
    }

    @Transactional
    public OrderResponse create(Long accountId, String key, CreateOrderRequest request) {
        validateKey(key);
        if (request == null || request.type() != TradingOrder.Type.MARKET || request.tradingSymbolId() == null
                || request.tradingSymbolId() <= 0 || request.side() == null || request.quantity() == null || request.leverage() == null
                || request.quantity().signum() <= 0 || request.quantity().stripTrailingZeros().scale() > TradingMath.QUANTITY_SCALE
                || request.quantity().compareTo(TradingMath.MAX_QUANTITY) > 0
                || request.leverage() < 1 || request.leverage() > TradingMath.MAX_LEVERAGE)
            throw new BusinessException(ErrorCode.INVALID_ORDER);
        String hash = fingerprint("OPEN|" + request.type() + "|" + request.tradingSymbolId() + "|" + request.side()
                + "|" + request.quantity().stripTrailingZeros().toPlainString() + "|" + request.leverage());
        TradingAccount account = locks.lock(accountId);
        OrderResponse previous = existing(accountId, key, hash);
        if (previous != null) return previous;
        requireActive(account);
        if (symbols.findById(request.tradingSymbolId()).filter(s -> s.getStatus() == TradingSymbolStatus.ACTIVE).isEmpty())
            throw new BusinessException(ErrorCode.SYMBOL_NOT_AVAILABLE);
        Wallet wallet = wallet(accountId);
        List<Position> open = open(accountId);
        if (open.size() >= TradingMath.MAX_OPEN_POSITIONS) throw new BusinessException(ErrorCode.POSITION_LIMIT_REACHED);
        AccountValuation.Value value = valuation.calculate(wallet, open, Set.of(request.tradingSymbolId()));
        requireFresh(value);
        LatestMarkPrice price = value.prices().get(request.tradingSymbolId()).latestPrice().orElseThrow();
        BigDecimal margin;
        try { margin = TradingMath.margin(price.domainMarkPrice(), request.quantity(), request.leverage()); }
        catch (IllegalArgumentException exception) { throw new BusinessException(ErrorCode.INVALID_ORDER); }
        if (margin.compareTo(value.availableBalance()) > 0) throw new BusinessException(ErrorCode.INSUFFICIENT_MARGIN);
        if (value.equity().compareTo(value.maintenanceMargin().add(TradingMath.maintenance(price.domainMarkPrice(), request.quantity()))) <= 0)
            throw new BusinessException(ErrorCode.ACCOUNT_AT_RISK);
        Instant now = now();
        Position position = positions.save(Position.open(accountId, request.tradingSymbolId(), request.side(),
                request.quantity(), price.domainMarkPrice(), request.leverage(), now));
        wallet.openMargin(margin);
        account.recordFinancialChange(now);
        return record(position, TradingOrder.Action.OPEN, price, key, hash, now, BigDecimal.ZERO);
    }

    @Transactional
    public OrderResponse close(Long accountId, Long positionId, String key) {
        validateKey(key);
        String hash = fingerprint("CLOSE|" + positionId);
        TradingAccount account = locks.lock(accountId);
        OrderResponse previous = existing(accountId, key, hash);
        if (previous != null) return previous;
        requireActive(account);
        Wallet wallet = wallet(accountId);
        List<Position> open = open(accountId);
        Position position = positions.findById(positionId).filter(p -> p.getAccountId().equals(accountId))
                .orElseThrow(() -> new BusinessException(ErrorCode.POSITION_NOT_FOUND));
        if (position.getStatus() != Position.Status.OPEN) throw new BusinessException(ErrorCode.POSITION_NOT_OPEN);
        AccountValuation.Value value = valuation.calculate(wallet, open);
        requireFresh(value);
        if (value.equity().compareTo(value.maintenanceMargin()) <= 0) throw new BusinessException(ErrorCode.ACCOUNT_AT_RISK);
        LatestMarkPrice price = value.prices().get(position.getTradingSymbolId()).latestPrice().orElseThrow();
        BigDecimal pnl = TradingMath.pnl(position.getSide(), position.getEntryPrice(), price.domainMarkPrice(), position.getQuantity());
        if (wallet.getBalance().add(pnl).signum() < 0) throw new BusinessException(ErrorCode.INSUFFICIENT_MARGIN);
        Instant now = now();
        position.close(price.domainMarkPrice(), now, false);
        wallet.settle(position.getMargin(), pnl);
        account.recordFinancialChange(now);
        if (wallet.getBalance().signum() == 0 && open.size() == 1) account.declareBankrupt();
        return record(position, TradingOrder.Action.CLOSE, price, key, hash, now, pnl);
    }

    @Transactional
    public List<OrderResponse> history(Long accountId, Long beforeId, int limit) {
        if (limit < 1 || limit > 100 || beforeId != null && beforeId <= 0) throw new BusinessException(ErrorCode.INVALID_ORDER);
        locks.lock(accountId);
        List<TradingOrder> result = orders.history(accountId, beforeId == null ? Long.MAX_VALUE : beforeId, PageRequest.of(0, limit));
        Map<Long, Fill> byOrder = fills.findByOrderIdIn(result.stream().map(TradingOrder::getId).toList())
                .stream().collect(Collectors.toMap(Fill::getOrderId, fill -> fill));
        return result.stream().map(order -> OrderResponse.from(order, byOrder.get(order.getId()))).toList();
    }

    private OrderResponse record(Position position, TradingOrder.Action action, LatestMarkPrice price,
            String key, String hash, Instant now, BigDecimal pnl) {
        TradingOrder order = orders.save(TradingOrder.market(position, action, price.domainMarkPrice(), key, hash, now));
        Fill fill = fills.save(Fill.execute(order.getId(), price.domainMarkPrice(), position.getQuantity(), price.eventTime(), now, pnl));
        org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                new org.springframework.transaction.support.TransactionSynchronization() {
                    @Override public void afterCommit() {
                        log.info("[Trading] filled accountId={} orderId={} positionId={} symbolId={} action={}",
                                order.getAccountId(), order.getId(), position.getId(), position.getTradingSymbolId(), action);
                    }
                });
        return OrderResponse.from(order, fill);
    }
    private OrderResponse existing(Long accountId, String key, String hash) {
        return orders.findByAccountIdAndIdempotencyKey(accountId, key).map(order -> {
            if (!order.getRequestFingerprint().equals(hash)) throw new BusinessException(ErrorCode.IDEMPOTENCY_CONFLICT);
            return OrderResponse.from(order, fills.findByOrderId(order.getId()).orElseThrow());
        }).orElse(null);
    }
    private Wallet wallet(Long accountId) { return wallets.findById(accountId).orElseThrow(); }
    private List<Position> open(Long accountId) { return positions.findByAccountIdAndStatusOrderByIdAsc(accountId, Position.Status.OPEN); }
    private void requireActive(TradingAccount account) {
        if (account.getStatus() != TradingAccount.Status.ACTIVE) throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
    }
    private void requireFresh(AccountValuation.Value value) {
        if (!value.fresh()) throw new BusinessException(ErrorCode.PRICE_NOT_FRESH);
    }
    private static Instant now() { return Instant.now().truncatedTo(ChronoUnit.MICROS); }
    private static void validateKey(String key) {
        if (key == null || !key.matches("[A-Za-z0-9_-]{8,100}")) throw new BusinessException(ErrorCode.INVALID_IDEMPOTENCY_KEY);
    }
    private static String fingerprint(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
}
