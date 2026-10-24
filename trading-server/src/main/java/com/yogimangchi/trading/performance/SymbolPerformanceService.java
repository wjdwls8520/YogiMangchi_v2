package com.yogimangchi.trading.performance;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.marketdata.*;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.service.AccountLock;
import java.math.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import static com.yogimangchi.trading.performance.SymbolPerformanceResponse.*;

@Service
public class SymbolPerformanceService {
    private final AccountLock locks;
    private final JdbcTemplate jdbc;
    private final PositionRepository positions;
    private final WalletRepository wallets;
    private final LatestPriceStore prices;
    public SymbolPerformanceService(AccountLock locks,JdbcTemplate jdbc,PositionRepository positions,WalletRepository wallets,LatestPriceStore prices) {
        this.locks=locks;this.jdbc=jdbc;this.positions=positions;this.wallets=wallets;this.prices=prices;
    }
    private record Aggregate(long id,String symbol,String quote,long count,BigDecimal turnover,BigDecimal gross,BigDecimal fee,BigDecimal adjustment) { }
    @Transactional(timeout=5)
    public SymbolPerformanceResponse aggregate(Long accountId,Instant from,Instant before,Long roundId,Long symbolId) {
        validate(from,before,roundId,symbolId);
        locks.lock(accountId); // Coherent ledger/positions snapshot under the existing financial boundary.
        jdbc.execute("SET LOCAL statement_timeout = '4s'");
        Instant now=Instant.now().truncatedTo(ChronoUnit.MICROS);
        Instant start=from==null?Instant.EPOCH:from,end=before==null?now:before;
        if(!start.isBefore(end)) invalid();
        Map<String,Object> round=null;
        if(roundId!=null) {
            var rows=jdbc.queryForList("select * from trading.member_trading_round where account_id=? and id=?",accountId,roundId);
            if(rows.isEmpty()) throw new BusinessException(ErrorCode.ROUND_NOT_FOUND);
            round=rows.get(0);
        }
        String filter=(roundId==null?"":" and o.round_id=?")+(symbolId==null?"":" and o.trading_symbol_id=?");
        List<Object> args=new ArrayList<>(List.of(accountId,at(start),at(end)));
        if(roundId!=null)args.add(roundId);if(symbolId!=null)args.add(symbolId);
        var aggregates=jdbc.query("""
            select s.id,s.symbol,s.quote_asset,count(*) fill_count,sum(f.price*f.quantity) turnover,
                   sum(f.realized_pnl) gross,sum(f.fee) fees,sum(f.settlement_adjustment) adjustment
            from trading.trading_order o join trading.fill f on f.order_id=o.id
            join trading.trading_symbol s on s.id=o.trading_symbol_id
            where o.account_id=? and f.executed_at>=? and f.executed_at<? and o.status='FILLED'
              and o.action in ('OPEN','CLOSE','LIQUIDATE')
            """+filter+" group by s.id order by s.id",(r,n)->new Aggregate(r.getLong("id"),r.getString("symbol"),r.getString("quote_asset"),r.getLong("fill_count"),r.getBigDecimal("turnover"),r.getBigDecimal("gross"),r.getBigDecimal("fees"),r.getBigDecimal("adjustment")),args.toArray());
        Set<Long> roundPositions=roundId==null?Set.of():new HashSet<>(jdbc.queryForList(
                "select id from trading.position where account_id=? and round_id=? and status='OPEN'",Long.class,accountId,roundId));
        var open=positions.findByAccountIdAndStatusOrderByIdAsc(accountId,Position.Status.OPEN).stream()
                .filter(p -> symbolId==null||symbolId.equals(p.getTradingSymbolId()))
                .filter(p -> roundId==null||roundPositions.contains(p.getId())).toList();
        var bySymbol=new TreeMap<Long,Aggregate>();aggregates.forEach(a -> bySymbol.put(a.id(),a));
        // Include current positions without a Fill inside the requested historical period, in one metadata query.
        var missing=open.stream().map(Position::getTradingSymbolId).distinct().filter(id -> !bySymbol.containsKey(id)).toList();
        if(!missing.isEmpty()) jdbc.query("select id,symbol,quote_asset from trading.trading_symbol where id in ("+String.join(",",Collections.nCopies(missing.size(),"?"))+")",
                (org.springframework.jdbc.core.RowCallbackHandler)r -> bySymbol.put(r.getLong(1),new Aggregate(r.getLong(1),r.getString(2),r.getString(3),0,BigDecimal.ZERO,BigDecimal.ZERO,BigDecimal.ZERO,BigDecimal.ZERO)),missing.toArray());
        BigDecimal turnover=BigDecimal.ZERO,gross=BigDecimal.ZERO,fees=BigDecimal.ZERO,adjustment=BigDecimal.ZERO;
        long count=0;
        for(var a:aggregates) {turnover=turnover.add(a.turnover());gross=gross.add(a.gross());fees=fees.add(a.fee());adjustment=adjustment.add(a.adjustment());count+=a.count();}
        var marks=prices.findAll(open.stream().map(Position::getTradingSymbolId).collect(java.util.stream.Collectors.toSet()));
        List<Symbol> result=new ArrayList<>();
        for(var a:bySymbol.values()) {
            var exposure=open.stream().filter(p -> p.getTradingSymbolId().equals(a.id())).toList();
            var snapshot=marks.get(a.id());
            boolean fresh=exposure.isEmpty()||snapshot.status()==LatestPriceStore.Status.FRESH;
            BigDecimal unrealized=fresh?exposure.stream().map(p -> p.unrealizedPnl(snapshot.latestPrice().orElseThrow().domainMarkPrice())).reduce(BigDecimal.ZERO,BigDecimal::add):null;
            var mark=snapshot==null?Optional.<LatestMarkPrice>empty():snapshot.latestPrice();
            result.add(new Symbol(a.id(),a.symbol(),a.quote(),a.count(),text(a.turnover()),text(turnover.signum()==0?BigDecimal.ZERO:a.turnover().multiply(BigDecimal.valueOf(100)).divide(turnover,8,RoundingMode.HALF_EVEN)),
                text(a.gross()),text(a.fee()),text(a.adjustment()),text(a.gross().subtract(a.fee())),text(a.gross().subtract(a.fee()).add(a.adjustment())),text(unrealized),
                exposure.isEmpty()?"NO_OPEN_EXPOSURE":snapshot.status().name(),mark.map(LatestMarkPrice::eventTime).orElse(null),mark.map(LatestMarkPrice::receivedAt).orElse(null),now));
        }
        BigDecimal capital=capital(accountId,start,end,roundId);
        RoundReturn returns=null;
        if(round!=null&&from==null&&before==null&&symbolId==null) returns=roundReturn(round,accountId,open,marks,now);
        return new SymbolPerformanceResponse(new Scope(start,end,roundId,symbolId,"OPEN+CLOSE+LIQUIDATE actual Fill price*quantity; each leg once","CURRENT_OPEN_EXPOSURE; historical period does not filter current valuation"),
            new Totals(count,text(turnover),text(gross),text(fees),text(adjustment),text(gross.subtract(fees)),text(gross.subtract(fees).add(adjustment))),List.copyOf(result),text(capital),returns,now);
    }
    private BigDecimal capital(Long accountId,Instant start,Instant end,Long roundId) {
        List<Object> args=new ArrayList<>(List.of(accountId,at(start),at(end)));
        String sql="select coalesce(sum(capital_adjustment),0) from trading.member_restart where account_id=? and restarted_at>=? and restarted_at<?";
        if(roundId!=null){sql+=" and new_round_id=?";args.add(roundId);}
        BigDecimal value=jdbc.queryForObject(sql,BigDecimal.class,args.toArray());
        if(roundId==null) value=value.add(jdbc.queryForObject("select coalesce(sum(capital_adjustment),0) from trading.guest_retry where account_id=? and reset_at>=? and reset_at<?",BigDecimal.class,accountId,at(start),at(end)));
        return value;
    }
    private RoundReturn roundReturn(Map<String,Object> round,Long accountId,List<Position> open,Map<Long,LatestPriceStore.Snapshot> marks,Instant now) {
        BigDecimal initial=(BigDecimal)round.get("initial_balance");
        if(initial==null) return new RoundReturn("LEGACY_UNVERIFIED",null,null,null,null,now);
        boolean completed="COMPLETED".equals(round.get("status"));
        BigDecimal equity;
        Instant valued=now;
        if(completed) {
            equity=jdbc.queryForObject("select (final_wallet->>'balance')::numeric from trading.member_trading_round where id=?",BigDecimal.class,round.get("id"));
            valued=((java.sql.Timestamp)round.get("ended_at")).toInstant();
        } else {
            if(marks.values().stream().anyMatch(s -> s.status()!=LatestPriceStore.Status.FRESH)) return new RoundReturn("PRICE_UNAVAILABLE",text(initial),"0",null,null,now);
            equity=wallets.findById(accountId).orElseThrow().getBalance();
            for(var p:open)equity=equity.add(p.unrealizedPnl(marks.get(p.getTradingSymbolId()).latestPrice().orElseThrow().domainMarkPrice()));
        }
        // Restart funding occurs before the new round begins. There are no within-round cash flows in this product.
        BigDecimal cash=equity.subtract(initial);
        return new RoundReturn(completed?"FINAL":"CURRENT",text(initial),"0",text(cash),text(cash.multiply(BigDecimal.valueOf(100)).divide(initial,8,RoundingMode.HALF_EVEN)),valued);
    }
    private static void validate(Instant from,Instant before,Long round,Long symbol) {
        if(round!=null&&round<=0||symbol!=null&&symbol<=0||!validTime(from)||!validTime(before)||from!=null&&before!=null&&!from.isBefore(before))invalid();
    }
    private static boolean validTime(Instant t) {return t==null||!t.isBefore(Instant.EPOCH)&&t.isBefore(Instant.parse("9999-12-31T23:59:59.999999Z"))&&t.getNano()%1000==0;}
    private static void invalid(){throw new BusinessException(ErrorCode.INVALID_HISTORY_REQUEST);}
    private static OffsetDateTime at(Instant t){return t.atOffset(ZoneOffset.UTC);}
    private static String text(BigDecimal n){return n==null?null:n.toPlainString();}
}
