package com.yogimangchi.trading.commandresult;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.*;
import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.execution.*;
import com.yogimangchi.trading.fill.repository.FillRepository;
import com.yogimangchi.trading.order.dto.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.order.repository.TradingOrderRepository;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.stoploss.StopLossResponse;
import com.yogimangchi.trading.tradingaccount.dto.GuestRetryResponse;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.repository.TradingAccountRepository;
import com.yogimangchi.trading.tradinground.MemberRounds;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** A bounded committed read snapshot. No AccountLock, ingress fence or mutation service invocation. */
@Service
public class CommandResultQueryService {
    private final TradingAccountRepository accounts;private final TradingOrderRepository orders;private final FillRepository fills;
    private final JdbcTemplate jdbc;private final ObjectMapper json;
    public CommandResultQueryService(TradingAccountRepository accounts,TradingOrderRepository orders,FillRepository fills,JdbcTemplate jdbc,ObjectMapper json){
        this.accounts=accounts;this.orders=orders;this.fills=fills;this.jdbc=jdbc;this.json=json;
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ,timeout=3)
    public CommandResultResponse query(Long accountId,CommandResultRequest query){
        if(query==null||query.operation()==null)throw invalid();
        if(query.idempotencyKey()==null||!query.idempotencyKey().matches("[A-Za-z0-9_-]{8,100}"))throw new BusinessException(ErrorCode.INVALID_IDEMPOTENCY_KEY);
        var account=owner(accountId);
        JsonNode request=query.request();Object result;var kind=CommandResultResponse.ResultKind.ORIGINAL_SNAPSHOT;
        switch(query.operation()){
            case OPEN,CLOSE,LIMIT_CLOSE -> {
                String fingerprint=orderFingerprint(query.operation(),request);
                var order=orders.findByAccountIdAndIdempotencyKey(accountId,query.idempotencyKey());
                if(order.isPresent()){
                    match(fingerprint,order.get().getRequestFingerprint());
                    result=OrderResponse.from(order.get(),fills.findByOrderId(order.get().getId()).orElse(null));
                }else result=null;
                kind=CommandResultResponse.ResultKind.ORDER_CURRENT;
            }
            case STOP_LOSS_PUT,STOP_LOSS_DELETE -> {
                boolean put=query.operation()==CommandResultRequest.Operation.STOP_LOSS_PUT;
                shape(request,put?Set.of("positionId","stopPrice","expectedVersion"):Set.of("positionId","expectedVersion"));
                long position=integer(request,"positionId",1,Long.MAX_VALUE),version=integer(request,"expectedVersion",0,Long.MAX_VALUE);
                BigDecimal stop=put?decimal(request,"stopPrice",true):null;if(put)price(stop);
                String fingerprint=TradingCommandFingerprint.stopLoss(position,version,stop);
                var rows=jdbc.queryForList("select request_fingerprint,response::text from trading.position_stop_loss_command where account_id=? and request_key=?",accountId,query.idempotencyKey());
                if(rows.isEmpty())result=null;else{
                    match(fingerprint,(String)rows.get(0).get("request_fingerprint"));
                    try{result=json.readValue(rows.get(0).get("response").toString(),StopLossResponse.class);}
                    catch(JsonProcessingException failure){throw new IllegalStateException("Invalid retained stop command result",failure);}
                }
            }
            case MEMBER_RESTART -> {
                empty(request);if(account.isGuestAccount()||account.getMemberId()==null)throw new BusinessException(ErrorCode.MEMBER_ACCOUNT_REQUIRED);
                var rows=jdbc.query("select s.new_round_id,r.round_number,s.balance_before+s.capital_adjustment balance,s.restarted_at,s.canceled_order_count,s.closed_position_count from trading.member_restart s join trading.member_trading_round r on r.id=s.new_round_id where s.account_id=? and s.request_key=?",
                        (r,n)->new MemberRounds.Restart(r.getLong("new_round_id"),r.getInt("round_number"),r.getBigDecimal("balance").toPlainString(),r.getTimestamp("restarted_at").toInstant(),r.getTimestamp("restarted_at").toInstant().plusSeconds(86400),r.getInt("canceled_order_count"),r.getInt("closed_position_count")),accountId,query.idempotencyKey());
                result=rows.isEmpty()?null:rows.get(0);
            }
            case GUEST_RETRY -> {
                empty(request);if(!account.isGuestAccount()||account.getMemberId()!=null)throw new BusinessException(ErrorCode.GUEST_ACCOUNT_REQUIRED);
                var rows=jdbc.query("select id,balance_after,canceled_order_count,closed_position_count,reset_at from trading.guest_retry where account_id=? and request_key=?",
                        (r,n)->new GuestRetryResponse(r.getLong("id"),accountId,"ACTIVE","USDT",r.getBigDecimal("balance_after").toPlainString(),r.getInt("canceled_order_count"),r.getInt("closed_position_count"),r.getTimestamp("reset_at").toInstant()),accountId,query.idempotencyKey());
                result=rows.isEmpty()?null:rows.get(0);
            }
            default -> throw invalid();
        }
        return new CommandResultResponse(result==null?CommandResultResponse.Status.NOT_OBSERVED:CommandResultResponse.Status.FOUND,query.operation(),Instant.now(),result==null?null:kind,result);
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ,timeout=3)
    public OrderResponse order(Long accountId,Long orderId){
        owner(accountId);if(orderId==null||orderId<=0)throw invalid();
        var order=orders.findById(orderId).filter(o->o.getAccountId().equals(accountId))
                .orElseThrow(()->new BusinessException(ErrorCode.ORDER_NOT_FOUND));
        return OrderResponse.from(order,fills.findByOrderId(orderId).orElse(null));
    }
    private TradingAccount owner(Long accountId){
        if(accountId==null)throw new BusinessException(ErrorCode.ACCOUNT_NOT_FOUND);
        var account=accounts.findById(accountId).orElseThrow(()->new BusinessException(ErrorCode.ACCOUNT_NOT_FOUND));
        if(account.getStatus()==TradingAccount.Status.WITHDRAWN)throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        return account;
    }
    private static String orderFingerprint(CommandResultRequest.Operation operation,JsonNode r){
        if(operation==CommandResultRequest.Operation.OPEN){
            shape(r,Set.of("type","tradingSymbolId","side","quantity","leverage","limitPrice"));
            var type=enumeration(r,"type",TradingOrder.Type.class);var side=enumeration(r,"side",Position.Side.class);
            long symbol=integer(r,"tradingSymbolId",1,Long.MAX_VALUE);int leverage=(int)integer(r,"leverage",1,TradingMath.MAX_LEVERAGE);
            var quantity=decimal(r,"quantity",true);quantity(quantity);var limit=decimal(r,"limitPrice",false);
            if(type==TradingOrder.Type.LIMIT)price(limit);else if(limit!=null)throw invalid();
            return TradingCommandFingerprint.open(new CreateOrderRequest(type,symbol,side,quantity,leverage,limit));
        }
        boolean limit=operation==CommandResultRequest.Operation.LIMIT_CLOSE;
        shape(r,limit?Set.of("positionId","quantity","limitPrice"):Set.of("positionId","quantity"));
        long position=integer(r,"positionId",1,Long.MAX_VALUE);var quantity=decimal(r,"quantity",false);if(quantity!=null)quantity(quantity);
        if(!limit)return TradingCommandFingerprint.close(position,quantity);
        var price=decimal(r,"limitPrice",true);price(price);return TradingCommandFingerprint.limitClose(position,quantity,price);
    }
    private static void shape(JsonNode r,Set<String> allowed){
        if(r==null||!r.isObject())throw invalid();var names=r.fieldNames();while(names.hasNext())if(!allowed.contains(names.next()))throw invalid();
    }
    private static void empty(JsonNode r){if(r!=null&&!r.isNull())shape(r,Set.of());}
    private static long integer(JsonNode r,String field,long min,long max){
        var value=r.get(field);if(value==null||!value.isIntegralNumber()||!value.canConvertToLong()||value.longValue()<min||value.longValue()>max)throw invalid();return value.longValue();
    }
    private static BigDecimal decimal(JsonNode r,String field,boolean required){
        var value=r.get(field);if(value==null||value.isNull()){if(required)throw invalid();return null;}
        if(!value.isTextual()||value.textValue().length()>80)throw invalid();
        try{return new BigDecimal(value.textValue().strip());}catch(NumberFormatException failure){throw invalid();}
    }
    private static <T extends Enum<T>> T enumeration(JsonNode r,String field,Class<T> type){
        var value=r.get(field);if(value==null||!value.isTextual())throw invalid();try{return Enum.valueOf(type,value.textValue());}catch(IllegalArgumentException e){throw invalid();}
    }
    private static void quantity(BigDecimal q){try{TradingMath.validateQuantity(q);}catch(IllegalArgumentException e){throw invalid();}}
    private static void price(BigDecimal p){try{TradingMath.validatePrice(p);}catch(IllegalArgumentException e){throw invalid();}}
    private static void match(String expected,String recorded){if(!expected.equals(recorded))throw new BusinessException(ErrorCode.IDEMPOTENCY_CONFLICT);}
    private static BusinessException invalid(){return new BusinessException(ErrorCode.INVALID_COMMAND_RESULT_REQUEST);}
}
