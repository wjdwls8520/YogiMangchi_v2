package com.yogimangchi.trading.tradehistory.service;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.order.entity.TradingOrder;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.tradehistory.dto.*;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Authenticated, bounded projections of the financial ledger. No Entity is exposed or modified. */
@Service
public class TradeHistoryService {
    private final JdbcTemplate jdbc;
    private final AccountLock locks;
    public TradeHistoryService(JdbcTemplate jdbc, AccountLock locks) { this.jdbc=jdbc; this.locks=locks; }

    @Transactional(timeout=5)
    public List<FillHistoryResponse> fills(Long accountId, Long beforeId, int limit, Long symbolId,
            Position.Side side, TradingOrder.Action action, TradingOrder.Type type, Instant from, Instant before) {
        validate(beforeId,limit,symbolId,from,before);
        locks.lock(accountId);
        StringBuilder sql=new StringBuilder("select f.id,f.order_id,o.position_id,coalesce(p.merged_into_position_id,p.id) lifecycle_id,o.trading_symbol_id,o.type,o.action,o.side,o.leverage,f.quantity,f.price,f.realized_pnl,f.fee,f.settlement_adjustment,f.margin_mode,f.price_event_time,f.executed_at from trading.fill f join trading.trading_order o on o.id=f.order_id join trading.position p on p.id=o.position_id where o.account_id=? and f.id<?");
        List<Object> args=new ArrayList<>(List.of(accountId,beforeId==null ? Long.MAX_VALUE : beforeId));
        add(sql,args,"o.trading_symbol_id",symbolId); add(sql,args,"o.side",side);
        add(sql,args,"o.action",action); add(sql,args,"o.type",type);
        times(sql,args,"f.executed_at",from,before);
        sql.append(" order by f.id desc limit ?"); args.add(limit);
        return jdbc.query(sql.toString(),(r,row) -> new FillHistoryResponse(r.getLong("id"),r.getLong("order_id"),r.getLong("position_id"),r.getLong("lifecycle_id"),
                r.getLong("trading_symbol_id"),r.getString("type"),r.getString("action"),r.getString("side"),r.getInt("leverage"),
                decimal(r,"quantity"),decimal(r,"price"),decimal(r,"realized_pnl"),decimal(r,"fee"),decimal(r,"settlement_adjustment"),
                r.getString("margin_mode"),r.getTimestamp("price_event_time").toInstant(),r.getTimestamp("executed_at").toInstant()),args.toArray());
    }

    @Transactional(timeout=5)
    public ClosedPositionPage closed(Long accountId, String cursor, int limit, Long symbolId,
            Position.Side side, Position.Status status, Instant from, Instant before) {
        validate(null,limit,symbolId,from,before);
        if (status!=null && status!=Position.Status.CLOSED && status!=Position.Status.LIQUIDATED) invalid();
        Cursor key=decode(cursor);
        locks.lock(accountId);
        StringBuilder sql=new StringBuilder("select id,trading_symbol_id,side,status,initial_quantity,entry_price,exit_price,leverage,initial_margin,realized_pnl,opened_margin_mode,opened_at,closed_at from trading.position where account_id=? and status in ('CLOSED','LIQUIDATED') and close_reason is null");
        List<Object> args=new ArrayList<>(List.of(accountId));
        if (key!=null) { sql.append(" and (closed_at,id)<(?,?)"); args.add(at(key.time())); args.add(key.id()); }
        add(sql,args,"trading_symbol_id",symbolId); add(sql,args,"side",side); add(sql,args,"status",status);
        times(sql,args,"closed_at",from,before);
        sql.append(" order by closed_at desc,id desc limit ?"); args.add(limit+1);
        var rows=jdbc.query(sql.toString(),(r,row) -> new ClosedPositionResponse(r.getLong("id"),r.getLong("trading_symbol_id"),r.getString("side"),r.getString("status"),
                decimal(r,"initial_quantity"),decimal(r,"entry_price"),decimal(r,"exit_price"),r.getInt("leverage"),decimal(r,"initial_margin"),decimal(r,"realized_pnl"),
                "0","0",decimal(r,"realized_pnl"),r.getString("opened_margin_mode"),r.getString("opened_margin_mode"),r.getTimestamp("opened_at").toInstant(),r.getTimestamp("closed_at").toInstant()),args.toArray());
        boolean more=rows.size()>limit;
        var page=rows.stream().limit(limit).toList();
        if (page.isEmpty()) return new ClosedPositionPage(List.of(),null);
        var ids=page.stream().map(ClosedPositionResponse::positionId).toList();
        String placeholders=String.join(",",Collections.nCopies(ids.size(),"?"));
        List<Object> costArgs=new ArrayList<>(List.of(accountId)); costArgs.addAll(ids); costArgs.addAll(ids);
        var costs=new HashMap<Long,Costs>();
        jdbc.query("select coalesce(p.merged_into_position_id,p.id) lifecycle_id,sum(f.fee) fees,sum(f.settlement_adjustment) adjustment,(array_agg(f.margin_mode order by f.id desc))[1] mode from trading.position p join trading.trading_order o on o.position_id=p.id join trading.fill f on f.order_id=o.id where o.account_id=? and (p.id in ("+placeholders+") or p.merged_into_position_id in ("+placeholders+")) group by coalesce(p.merged_into_position_id,p.id)",
                (org.springframework.jdbc.core.RowCallbackHandler) r -> costs.put(r.getLong("lifecycle_id"),new Costs(r.getBigDecimal("fees"),r.getBigDecimal("adjustment"),r.getString("mode"))),costArgs.toArray());
        var items=page.stream().map(p -> {
            var c=costs.getOrDefault(p.positionId(),new Costs(BigDecimal.ZERO,BigDecimal.ZERO,p.openedMarginMode()));
            return new ClosedPositionResponse(p.positionId(),p.tradingSymbolId(),p.side(),p.status(),p.initialQuantity(),p.entryPrice(),p.exitPrice(),p.leverage(),p.initialMargin(),p.realizedPnl(),
                    c.fee().toPlainString(),c.adjustment().toPlainString(),new BigDecimal(p.realizedPnl()).subtract(c.fee()).add(c.adjustment()).toPlainString(),p.openedMarginMode(),c.mode(),p.openedAt(),p.closedAt());
        }).toList();
        var last=items.get(items.size()-1);
        return new ClosedPositionPage(items,more ? encode(new Cursor(last.closedAt(),last.positionId())) : null);
    }

    private record Costs(BigDecimal fee,BigDecimal adjustment,String mode) { }
    private record Cursor(Instant time,long id) { }
    private static String encode(Cursor cursor) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString((cursor.time()+"|"+cursor.id()).getBytes(StandardCharsets.UTF_8));
    }
    private static Cursor decode(String value) {
        if (value==null) return null;
        try {
            if (value.length()>150 || value.isBlank()) throw new IllegalArgumentException();
            String[] parts=new String(Base64.getUrlDecoder().decode(value),StandardCharsets.UTF_8).split("\\|",-1);
            if (parts.length!=2) throw new IllegalArgumentException();
            var cursor=new Cursor(Instant.parse(parts[0]),Long.parseLong(parts[1]));
            if (cursor.id()<=0 || !validTime(cursor.time())) throw new IllegalArgumentException();
            return cursor;
        } catch (RuntimeException e) { throw new BusinessException(ErrorCode.INVALID_HISTORY_REQUEST); }
    }
    private static void validate(Long beforeId,int limit,Long symbolId,Instant from,Instant before) {
        if (beforeId!=null && beforeId<=0 || limit<1 || limit>100 || symbolId!=null && symbolId<=0
                || from!=null && !validTime(from) || before!=null && !validTime(before)
                || from!=null && before!=null && !from.isBefore(before)) invalid();
    }
    private static boolean validTime(Instant time) {
        return !time.isBefore(Instant.EPOCH) && time.isBefore(Instant.parse("9999-12-31T23:59:59.999999Z")) && time.getNano()%1000==0;
    }
    private static void invalid() { throw new BusinessException(ErrorCode.INVALID_HISTORY_REQUEST); }
    private static void add(StringBuilder sql,List<Object> args,String column,Object value) {
        if (value!=null) { sql.append(" and ").append(column).append("=?"); args.add(value instanceof Enum<?> e ? e.name() : value); }
    }
    private static void times(StringBuilder sql,List<Object> args,String column,Instant from,Instant before) {
        if (from!=null) { sql.append(" and ").append(column).append(">=?"); args.add(at(from)); }
        if (before!=null) { sql.append(" and ").append(column).append("<?"); args.add(at(before)); }
    }
    private static OffsetDateTime at(Instant instant) { return instant.atOffset(ZoneOffset.UTC); }
    private static String decimal(ResultSet result,String column) throws SQLException { return result.getBigDecimal(column).toPlainString(); }
}
