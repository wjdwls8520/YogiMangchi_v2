package com.yogimangchi.trading.takeprofit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.execution.TradingCommandFingerprint;
import com.yogimangchi.trading.execution.TradingMath;
import com.yogimangchi.trading.execution.trigger.TradingEngineGate;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.position.service.IsolatedMargin;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import com.yogimangchi.trading.tradingevent.service.TradingEvents;
import com.yogimangchi.trading.tradingsymbol.entity.TradingSymbolStatus;
import com.yogimangchi.trading.tradingsymbol.repository.TradingSymbolRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TakeProfitService {
    private final AccountLock locks;
    private final PositionRepository positions;
    private final PositionTakeProfitRepository takeProfits;
    private final TradingEngineGate gate;
    private final LatestPriceStore prices;
    private final IsolatedMargin isolated;
    private final TradingSymbolRepository symbols;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final TradingEvents events;

    public TakeProfitService(
            AccountLock locks,
            PositionRepository positions,
            PositionTakeProfitRepository takeProfits,
            TradingEngineGate gate,
            LatestPriceStore prices,
            IsolatedMargin isolated,
            TradingSymbolRepository symbols,
            JdbcTemplate jdbc,
            ObjectMapper json,
            TradingEvents events) {
        this.locks = locks;
        this.positions = positions;
        this.takeProfits = takeProfits;
        this.gate = gate;
        this.prices = prices;
        this.isolated = isolated;
        this.symbols = symbols;
        this.jdbc = jdbc;
        this.json = json;
        this.events = events;
    }

    @Transactional
    public TakeProfitResponse get(Long accountId, Long positionId) {
        locks.lock(accountId);
        Position position = owned(accountId, positionId);
        return takeProfits.findById(positionId)
                .map(TakeProfitResponse::from)
                .orElseGet(() -> TakeProfitResponse.none(position));
    }

    @Transactional
    public TakeProfitResponse put(Long accountId, Long positionId, String key, TakeProfitRequest request) {
        if (request == null) {
            throw new BusinessException(ErrorCode.INVALID_TAKE_PROFIT);
        }
        try {
            TradingMath.validatePrice(request.takeProfitPrice());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.INVALID_TAKE_PROFIT);
        }
        return change(accountId, positionId, key, request.expectedVersion(), request.takeProfitPrice());
    }

    @Transactional
    public TakeProfitResponse delete(Long accountId, Long positionId, String key, Long expectedVersion) {
        return change(accountId, positionId, key, expectedVersion, null);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void expireIfActive(Position position, String reason, Instant now) {
        if (position == null || position.getId() == null) {
            return;
        }
        takeProfits.findById(position.getId()).ifPresent(tp -> {
            if (tp.expire(reason, now)) {
                takeProfits.save(tp);
                takeProfits.flush();
                events.recordTakeProfit(tp);
            }
        });
    }

    private TakeProfitResponse change(Long accountId, Long positionId, String key, Long expected, BigDecimal targetPrice) {
        if (key == null || !key.matches("[A-Za-z0-9_-]{8,100}")) {
            throw new BusinessException(ErrorCode.INVALID_IDEMPOTENCY_KEY);
        }
        if (expected == null || expected < 0) {
            throw new BusinessException(ErrorCode.INVALID_TAKE_PROFIT);
        }
        gate.enterTradingTransaction();
        TradingAccount account = locks.lock(accountId);
        String hash = TradingCommandFingerprint.takeProfit(positionId, expected, targetPrice);
        var old = jdbc.queryForList(
                "select request_fingerprint,response::text from trading.position_take_profit_command where account_id=? and request_key=?",
                accountId, key);
        if (!old.isEmpty()) {
            if (!hash.equals(old.get(0).get("request_fingerprint"))) {
                throw new BusinessException(ErrorCode.IDEMPOTENCY_CONFLICT);
            }
            try {
                return json.readValue(old.get(0).get("response").toString(), TakeProfitResponse.class);
            } catch (JsonProcessingException exception) {
                throw new IllegalStateException("Invalid retained take profit command", exception);
            }
        }
        Position position = owned(accountId, positionId);
        PositionTakeProfit existing = takeProfits.findById(positionId).orElse(null);
        long currentVersion = existing == null ? 0L : existing.getVersion();
        if (currentVersion != expected) {
            throw new BusinessException(ErrorCode.TAKE_PROFIT_VERSION_CONFLICT);
        }
        if (position.getStatus() != Position.Status.OPEN) {
            throw new BusinessException(ErrorCode.POSITION_NOT_OPEN);
        }
        gate.requireAccountClear(accountId);
        if (account.getStatus() != TradingAccount.Status.ACTIVE) {
            throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        }
        if (!account.isIsolated()) {
            throw new BusinessException(ErrorCode.MARGIN_MIGRATION_REQUIRED);
        }
        if (targetPrice != null) {
            if (symbols.findById(position.getTradingSymbolId())
                    .filter(s -> s.getStatus() == TradingSymbolStatus.ACTIVE).isEmpty()) {
                throw new BusinessException(ErrorCode.SYMBOL_NOT_AVAILABLE);
            }
            var snapshot = prices.find(position.getTradingSymbolId());
            if (snapshot.status() != LatestPriceStore.Status.FRESH) {
                throw new BusinessException(ErrorCode.PRICE_NOT_FRESH);
            }
            gate.requireCaughtUp(Map.of(position.getTradingSymbolId(), snapshot));
            BigDecimal mark = snapshot.latestPrice().orElseThrow().domainMarkPrice();
            if (isolated.risk(position, mark).atRisk()) {
                throw new BusinessException(ErrorCode.ACCOUNT_AT_RISK);
            }
            if (position.getSide() == Position.Side.LONG
                    ? targetPrice.compareTo(mark) <= 0
                    : targetPrice.compareTo(mark) >= 0) {
                throw new BusinessException(ErrorCode.TAKE_PROFIT_NOT_PROFITABLE);
            }
        }

        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        TakeProfitResponse response;
        if (targetPrice == null) {
            if (existing != null) {
                boolean wasActive = existing.getStatus() == PositionTakeProfit.Status.ACTIVE;
                existing.cancel(now);
                if (wasActive) {
                    takeProfits.save(existing);
                    takeProfits.flush();
                    events.recordTakeProfit(existing);
                }
                response = TakeProfitResponse.from(existing);
            } else {
                response = TakeProfitResponse.none(position);
            }
        } else {
            PositionTakeProfit tp = existing != null ? existing : PositionTakeProfit.createFor(position);
            tp.configure(position, targetPrice, now);
            takeProfits.save(tp);
            takeProfits.flush();
            events.recordTakeProfit(tp);
            response = TakeProfitResponse.from(tp);
        }

        try {
            jdbc.update(
                    "insert into trading.position_take_profit_command(account_id,request_key,position_id,request_fingerprint,response) values(?,?,?,?,?::jsonb)",
                    accountId, key, positionId, hash, json.writeValueAsString(response));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot retain take profit command", exception);
        }
        account.recordFinancialChange(now);
        return response;
    }

    private Position owned(Long accountId, Long positionId) {
        return positions.findById(positionId)
                .filter(p -> p.getAccountId().equals(accountId))
                .orElseThrow(() -> new BusinessException(ErrorCode.POSITION_NOT_FOUND));
    }
}
