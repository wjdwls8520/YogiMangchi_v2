package com.yogimangchi.trading.execution;

import com.yogimangchi.trading.order.dto.CreateOrderRequest;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.HexFormat;

/** Existing persisted command format, shared by execution and read-only reconciliation. */
public final class TradingCommandFingerprint {
    private TradingCommandFingerprint() { }
    public static String open(CreateOrderRequest request) {
        return hash("OPEN|"+request.type()+"|"+request.tradingSymbolId()+"|"+request.side()+"|"+decimal(request.quantity())+"|"+request.leverage()
                +(request.limitPrice()==null?"":"|"+decimal(request.limitPrice())));
    }
    public static String close(Long position,BigDecimal quantity) {
        return hash("CLOSE|"+position+(quantity==null?"":"|"+decimal(quantity)));
    }
    public static String limitClose(Long position,BigDecimal quantity,BigDecimal limit) {
        return hash("LIMIT_CLOSE|"+position+"|"+(quantity==null?"ALL":decimal(quantity))+"|"+decimal(limit));
    }
    public static String stopLoss(Long position,Long expectedVersion,BigDecimal stop) {
        return hash(position+"|"+expectedVersion+"|"+(stop==null?"DELETE":decimal(stop)));
    }
    private static String decimal(BigDecimal value){return value.stripTrailingZeros().toPlainString();}
    private static String hash(String value){
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}
        catch(NoSuchAlgorithmException exception){throw new IllegalStateException(exception);}
    }
}
