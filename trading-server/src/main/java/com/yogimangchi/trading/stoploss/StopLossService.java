package com.yogimangchi.trading.stoploss;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yogimangchi.trading.error.*;
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
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StopLossService {
    private final AccountLock locks; private final PositionRepository positions; private final TradingEngineGate gate;
    private final LatestPriceStore prices; private final IsolatedMargin isolated; private final TradingSymbolRepository symbols;
    private final JdbcTemplate jdbc; private final ObjectMapper json; private final TradingEvents events;
    public StopLossService(AccountLock locks,PositionRepository positions,TradingEngineGate gate,LatestPriceStore prices,
            IsolatedMargin isolated,TradingSymbolRepository symbols,JdbcTemplate jdbc,ObjectMapper json,TradingEvents events) {
        this.locks=locks;this.positions=positions;this.gate=gate;this.prices=prices;this.isolated=isolated;
        this.symbols=symbols;this.jdbc=jdbc;this.json=json;this.events=events;
    }
    @Transactional
    public StopLossResponse get(Long accountId,Long positionId) {
        locks.lock(accountId);return StopLossResponse.from(owned(accountId,positionId));
    }
    @Transactional
    public StopLossResponse put(Long accountId,Long positionId,String key,StopLossRequest request) {
        if(request==null) throw new BusinessException(ErrorCode.INVALID_STOP_LOSS);
        try {TradingMath.validatePrice(request.stopPrice());}
        catch(IllegalArgumentException exception){throw new BusinessException(ErrorCode.INVALID_STOP_LOSS);}
        return change(accountId,positionId,key,request.expectedVersion(),request.stopPrice());
    }
    @Transactional
    public StopLossResponse delete(Long accountId,Long positionId,String key,Long expectedVersion) {
        return change(accountId,positionId,key,expectedVersion,null);
    }
    private StopLossResponse change(Long accountId,Long positionId,String key,Long expected,BigDecimal stop) {
        if(key==null || !key.matches("[A-Za-z0-9_-]{8,100}")) throw new BusinessException(ErrorCode.INVALID_IDEMPOTENCY_KEY);
        if(expected==null || expected<0) throw new BusinessException(ErrorCode.INVALID_STOP_LOSS);
        gate.enterTradingTransaction(); var account=locks.lock(accountId);
        String hash=fingerprint(positionId+"|"+expected+"|"+(stop==null?"DELETE":stop.stripTrailingZeros().toPlainString()));
        var old=jdbc.queryForList("select request_fingerprint,response::text from trading.position_stop_loss_command where account_id=? and request_key=?",accountId,key);
        if(!old.isEmpty()) {
            if(!hash.equals(old.get(0).get("request_fingerprint"))) throw new BusinessException(ErrorCode.IDEMPOTENCY_CONFLICT);
            try {return json.readValue(old.get(0).get("response").toString(),StopLossResponse.class);}
            catch(JsonProcessingException exception){throw new IllegalStateException("Invalid retained stop loss command",exception);}
        }
        var position=owned(accountId,positionId);
        if(position.getStopLossVersion()!=expected) throw new BusinessException(ErrorCode.STOP_LOSS_VERSION_CONFLICT);
        if(position.getStatus()!=Position.Status.OPEN) throw new BusinessException(ErrorCode.POSITION_NOT_OPEN);
        gate.requireAccountClear(accountId);
        if(account.getStatus()!=TradingAccount.Status.ACTIVE) throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        if(!account.isIsolated()) throw new BusinessException(ErrorCode.MARGIN_MIGRATION_REQUIRED);
        if(stop!=null) {
            if(symbols.findById(position.getTradingSymbolId()).filter(s->s.getStatus()==TradingSymbolStatus.ACTIVE).isEmpty())
                throw new BusinessException(ErrorCode.SYMBOL_NOT_AVAILABLE);
            var snapshot=prices.find(position.getTradingSymbolId());
            if(snapshot.status()!=LatestPriceStore.Status.FRESH) throw new BusinessException(ErrorCode.PRICE_NOT_FRESH);
            gate.requireCaughtUp(Map.of(position.getTradingSymbolId(),snapshot));
            BigDecimal mark=snapshot.latestPrice().orElseThrow().domainMarkPrice();
            if(isolated.risk(position,mark).atRisk()) throw new BusinessException(ErrorCode.ACCOUNT_AT_RISK);
            if(position.getSide()==Position.Side.LONG ? stop.compareTo(mark)>=0 : stop.compareTo(mark)<=0)
                throw new BusinessException(ErrorCode.STOP_LOSS_NOT_PROTECTIVE);
            try {
                if(isolated.risk(position,stop).atRisk()) throw new BusinessException(ErrorCode.STOP_LOSS_BEYOND_LIQUIDATION);
            } catch(IllegalArgumentException | ArithmeticException invalidRange) {
                throw new BusinessException(ErrorCode.INVALID_STOP_LOSS);
            }
        }
        Instant now=Instant.now().truncatedTo(ChronoUnit.MICROS);
        if(stop==null) position.cancelStopLoss(now); else position.configureStopLoss(stop,now);
        // Version and arming time serialize under the same account/ingress fence as exposure changes.
        positions.flush(); events.recordStopLoss(position);
        var response=StopLossResponse.from(position);
        try {jdbc.update("insert into trading.position_stop_loss_command(account_id,request_key,position_id,request_fingerprint,response) values(?,?,?,?,?::jsonb)",accountId,key,positionId,hash,json.writeValueAsString(response));}
        catch(JsonProcessingException exception){throw new IllegalStateException("Cannot retain stop loss command",exception);}
        account.recordFinancialChange(now);
        return response;
    }
    private Position owned(Long account,Long position) {
        return positions.findById(position).filter(p->p.getAccountId().equals(account))
                .orElseThrow(()->new BusinessException(ErrorCode.POSITION_NOT_FOUND));
    }
    private String fingerprint(String value) {
        try {return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException exception){throw new IllegalStateException(exception);}
    }
}
