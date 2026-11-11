package com.yogimangchi.trading.portfolio;

import com.yogimangchi.trading.error.BusinessException;
import com.yogimangchi.trading.error.ErrorCode;
import com.yogimangchi.trading.marketdata.LatestPriceStore;
import com.yogimangchi.trading.portfolio.PublicMemberPortfolioResponse.AllocationSnapshot;
import com.yogimangchi.trading.portfolio.PublicMemberPortfolioResponse.ClosedTradeSummary;
import com.yogimangchi.trading.portfolio.PublicMemberPortfolioResponse.PublicPositionItem;
import com.yogimangchi.trading.portfolio.PublicMemberPortfolioResponse.SymbolPerformanceItem;
import com.yogimangchi.trading.portfolio.PublicMemberPortfolioResponse.WalletSnapshot;
import com.yogimangchi.trading.position.entity.Position;
import com.yogimangchi.trading.position.repository.PositionRepository;
import com.yogimangchi.trading.tradingaccount.entity.TradingAccount;
import com.yogimangchi.trading.tradingaccount.entity.Wallet;
import com.yogimangchi.trading.tradingaccount.repository.TradingAccountRepository;
import com.yogimangchi.trading.tradingaccount.repository.WalletRepository;
import com.yogimangchi.trading.tradingaccount.service.AccountValuation;
import com.yogimangchi.trading.tradingaccount.service.LiquidationPriceEstimator;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PublicPortfolioService {
    private static final BigDecimal DEFAULT_SEED = new BigDecimal("10000");
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private final JdbcTemplate jdbc;
    private final TradingAccountRepository accounts;
    private final WalletRepository wallets;
    private final PositionRepository positions;
    private final AccountValuation valuation;
    private final LiquidationPriceEstimator liquidationPrices;

    public PublicPortfolioService(
            JdbcTemplate jdbc,
            TradingAccountRepository accounts,
            WalletRepository wallets,
            PositionRepository positions,
            AccountValuation valuation,
            LiquidationPriceEstimator liquidationPrices) {
        this.jdbc = jdbc;
        this.accounts = accounts;
        this.wallets = wallets;
        this.positions = positions;
        this.valuation = valuation;
        this.liquidationPrices = liquidationPrices;
    }

    private record SymbolAggregate(
            long id,
            String symbol,
            String quoteAsset,
            long fillCount,
            BigDecimal turnover,
            BigDecimal gross,
            BigDecimal fees,
            BigDecimal adjustment) { }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 5)
    public PublicMemberPortfolioResponse getMemberPortfolio(Long memberId) {
        if (memberId == null || memberId <= 0) {
            throw new BusinessException(ErrorCode.INVALID_HISTORY_REQUEST);
        }
        var accountRows = jdbc.queryForList("""
                SELECT id
                FROM trading.trading_account
                WHERE member_id = ?
                  AND guest_account = false
                  AND account_type = 'MOCK'
                  AND status IN ('ACTIVE', 'BANKRUPT')
                ORDER BY id DESC
                LIMIT 1
                """, memberId);
        if (accountRows.isEmpty()) {
            return PublicMemberPortfolioResponse.empty(memberId);
        }
        long accountId = ((Number) accountRows.get(0).get("id")).longValue();
        TradingAccount account = accounts.findById(accountId).orElse(null);
        Wallet wallet = wallets.findById(accountId).orElse(null);
        if (account == null || wallet == null
                || (account.getStatus() != TradingAccount.Status.ACTIVE
                        && account.getStatus() != TradingAccount.Status.BANKRUPT)) {
            return PublicMemberPortfolioResponse.empty(memberId);
        }

        var roundRows = jdbc.queryForList("""
                SELECT id, round_number, initial_balance, start_realized_pnl, start_fees_paid, start_adjustment
                FROM trading.member_trading_round
                WHERE account_id = ?
                  AND status = 'ACTIVE'
                ORDER BY id DESC
                LIMIT 1
                """, accountId);
        Long roundId = null;
        int roundNumber = 1;
        BigDecimal initialSeed = DEFAULT_SEED;
        BigDecimal startRealizedPnl = BigDecimal.ZERO;
        if (!roundRows.isEmpty()) {
            var round = roundRows.get(0);
            roundId = ((Number) round.get("id")).longValue();
            roundNumber = ((Number) round.get("round_number")).intValue();
            if (round.get("initial_balance") instanceof BigDecimal init && init.signum() > 0) {
                initialSeed = init;
            }
            if (round.get("start_realized_pnl") instanceof BigDecimal sr) {
                startRealizedPnl = sr;
            }
        }

        List<Position> open = positions.findByAccountIdAndStatusOrderByIdAsc(accountId, Position.Status.OPEN);
        AccountValuation.Value value = valuation.calculate(wallet, open);
        var estimates = liquidationPrices.estimate(open, value.prices(), account.isIsolated());

        Map<Long, String> symbolNames = loadSymbolNames(open);

        BigDecimal balance = wallet.getBalance();
        BigDecimal availableBalance = value.availableBalance() != null ? value.availableBalance() : BigDecimal.ZERO;
        BigDecimal usedMargin = wallet.getUsedMargin();
        BigDecimal reservedMargin = wallet.getReservedMargin();
        BigDecimal unrealizedPnl = value.fresh() && value.unrealizedPnl() != null ? value.unrealizedPnl() : BigDecimal.ZERO;
        BigDecimal totalEquity = value.fresh() && value.equity() != null ? value.equity() : balance;
        BigDecimal roundRealizedPnl = wallet.getRealizedPnl().subtract(startRealizedPnl);
        BigDecimal totalPnl = totalEquity.subtract(initialSeed);
        BigDecimal totalRoiPct = initialSeed.signum() > 0
                ? totalPnl.multiply(HUNDRED).divide(initialSeed, 4, RoundingMode.HALF_EVEN)
                : BigDecimal.ZERO;

        WalletSnapshot walletSnapshot = new WalletSnapshot(
                plain(balance),
                plain(availableBalance),
                plain(usedMargin),
                plain(reservedMargin),
                plain(totalEquity),
                plain(unrealizedPnl),
                plain(roundRealizedPnl),
                plain(totalPnl),
                plain(totalRoiPct),
                value.fresh());

        int longCount = 0;
        int shortCount = 0;
        BigDecimal longMargin = BigDecimal.ZERO;
        BigDecimal shortMargin = BigDecimal.ZERO;
        List<PublicPositionItem> positionItems = new ArrayList<>(open.size());

        for (Position position : open) {
            if (position.getSide() == Position.Side.LONG) {
                longCount++;
                longMargin = longMargin.add(position.getMargin());
            } else {
                shortCount++;
                shortMargin = shortMargin.add(position.getMargin());
            }
            var snapshot = value.prices().get(position.getTradingSymbolId());
            boolean fresh = snapshot != null && snapshot.status() == LatestPriceStore.Status.FRESH;
            BigDecimal mark = fresh ? snapshot.latestPrice().orElseThrow().domainMarkPrice() : null;
            BigDecimal posUnrealized = fresh ? position.unrealizedPnl(mark) : null;
            String roePct = posUnrealized != null && position.getMargin().signum() > 0
                    ? plain(posUnrealized.multiply(HUNDRED).divide(position.getMargin(), 2, RoundingMode.HALF_EVEN))
                    : null;
            String marginRatioPct = balance.signum() > 0
                    ? plain(position.getMargin().multiply(HUNDRED).divide(balance, 2, RoundingMode.HALF_EVEN))
                    : "0";
            var estimate = estimates.get(position.getId());
            String liquidationPrice = estimate != null && estimate.price() != null ? plain(estimate.price()) : null;

            positionItems.add(new PublicPositionItem(
                    position.getId(),
                    symbolNames.getOrDefault(position.getTradingSymbolId(), String.valueOf(position.getTradingSymbolId())),
                    position.getTradingSymbolId(),
                    position.getSide().name(),
                    position.getLeverage(),
                    plain(position.getQuantity()),
                    plain(position.getEntryPrice()),
                    plain(mark),
                    liquidationPrice,
                    plain(position.getMargin()),
                    plain(posUnrealized),
                    roePct,
                    marginRatioPct));
        }

        BigDecimal usedMarginRatioPct = balance.signum() > 0
                ? usedMargin.multiply(HUNDRED).divide(balance, 2, RoundingMode.HALF_EVEN)
                : BigDecimal.ZERO;
        BigDecimal availableCashRatioPct = balance.signum() > 0
                ? availableBalance.multiply(HUNDRED).divide(balance, 2, RoundingMode.HALF_EVEN)
                : BigDecimal.ZERO;
        BigDecimal totalSideMargin = longMargin.add(shortMargin);
        BigDecimal longRatioPct = totalSideMargin.signum() > 0
                ? longMargin.multiply(HUNDRED).divide(totalSideMargin, 2, RoundingMode.HALF_EVEN)
                : BigDecimal.ZERO;
        BigDecimal shortRatioPct = totalSideMargin.signum() > 0
                ? HUNDRED.subtract(longRatioPct)
                : BigDecimal.ZERO;

        AllocationSnapshot allocationSnapshot = new AllocationSnapshot(
                plain(usedMarginRatioPct),
                plain(availableCashRatioPct),
                plain(longMargin),
                plain(shortMargin),
                plain(longRatioPct),
                plain(shortRatioPct),
                longCount,
                shortCount);

        List<SymbolPerformanceItem> symbolPerformances = aggregateSymbols(accountId, roundId, open, value.prices());
        ClosedTradeSummary closedTradeSummary = computeClosedTradeSummary(accountId, roundId);

        return new PublicMemberPortfolioResponse(
                memberId,
                true,
                roundId,
                roundNumber,
                plain(initialSeed),
                walletSnapshot,
                allocationSnapshot,
                List.copyOf(positionItems),
                symbolPerformances,
                closedTradeSummary);
    }

    private Map<Long, String> loadSymbolNames(List<Position> open) {
        if (open.isEmpty()) return Map.of();
        var ids = open.stream().map(Position::getTradingSymbolId).distinct().toList();
        String placeholders = String.join(",", Collections.nCopies(ids.size(), "?"));
        Map<Long, String> map = new HashMap<>();
        jdbc.query("SELECT id, symbol FROM trading.trading_symbol WHERE id IN (" + placeholders + ")",
                (org.springframework.jdbc.core.RowCallbackHandler) r -> map.put(r.getLong("id"), r.getString("symbol")),
                ids.toArray());
        return map;
    }

    private List<SymbolPerformanceItem> aggregateSymbols(
            long accountId,
            Long roundId,
            List<Position> open,
            Map<Long, LatestPriceStore.Snapshot> marks) {
        String roundFilter = roundId == null ? "" : " AND o.round_id = ?";
        Object[] args = roundId == null ? new Object[]{accountId} : new Object[]{accountId, roundId};
        var aggregates = jdbc.query("""
                SELECT s.id, s.symbol, s.quote_asset,
                       COUNT(*) AS fill_count,
                       COALESCE(SUM(f.price * f.quantity), 0) AS turnover,
                       COALESCE(SUM(f.realized_pnl), 0) AS gross,
                       COALESCE(SUM(f.fee), 0) AS fees,
                       COALESCE(SUM(f.settlement_adjustment), 0) AS adjustment
                FROM trading.trading_order o
                JOIN trading.fill f ON f.order_id = o.id
                JOIN trading.trading_symbol s ON s.id = o.trading_symbol_id
                WHERE o.account_id = ?
                  AND o.status = 'FILLED'
                  AND o.action IN ('OPEN', 'CLOSE', 'LIQUIDATE')
                """ + roundFilter + " GROUP BY s.id, s.symbol, s.quote_asset ORDER BY s.id",
                (r, n) -> new SymbolAggregate(
                        r.getLong("id"),
                        r.getString("symbol"),
                        r.getString("quote_asset"),
                        r.getLong("fill_count"),
                        r.getBigDecimal("turnover"),
                        r.getBigDecimal("gross"),
                        r.getBigDecimal("fees"),
                        r.getBigDecimal("adjustment")),
                args);

        var bySymbol = new TreeMap<Long, SymbolAggregate>();
        for (var a : aggregates) {
            bySymbol.put(a.id(), a);
        }
        var missing = open.stream()
                .map(Position::getTradingSymbolId)
                .distinct()
                .filter(id -> !bySymbol.containsKey(id))
                .toList();
        if (!missing.isEmpty()) {
            String placeholders = String.join(",", Collections.nCopies(missing.size(), "?"));
            jdbc.query("SELECT id, symbol, quote_asset FROM trading.trading_symbol WHERE id IN (" + placeholders + ")",
                    (org.springframework.jdbc.core.RowCallbackHandler) r -> bySymbol.put(
                            r.getLong("id"),
                            new SymbolAggregate(
                                    r.getLong("id"),
                                    r.getString("symbol"),
                                    r.getString("quote_asset"),
                                    0L,
                                    BigDecimal.ZERO,
                                    BigDecimal.ZERO,
                                    BigDecimal.ZERO,
                                    BigDecimal.ZERO)),
                    missing.toArray());
        }

        BigDecimal totalTurnover = BigDecimal.ZERO;
        for (var a : aggregates) {
            totalTurnover = totalTurnover.add(a.turnover());
        }

        List<SymbolPerformanceItem> result = new ArrayList<>(bySymbol.size());
        for (var a : bySymbol.values()) {
            var exposure = open.stream().filter(p -> p.getTradingSymbolId().equals(a.id())).toList();
            var snapshot = marks.get(a.id());
            boolean fresh = exposure.isEmpty() || (snapshot != null && snapshot.status() == LatestPriceStore.Status.FRESH);
            BigDecimal unrealized = fresh
                    ? exposure.stream()
                            .map(p -> p.unrealizedPnl(snapshot.latestPrice().orElseThrow().domainMarkPrice()))
                            .reduce(BigDecimal.ZERO, BigDecimal::add)
                    : null;
            BigDecimal sharePct = totalTurnover.signum() == 0
                    ? BigDecimal.ZERO
                    : a.turnover().multiply(HUNDRED).divide(totalTurnover, 8, RoundingMode.HALF_EVEN);
            BigDecimal economic = a.gross().subtract(a.fees());
            BigDecimal cash = economic.add(a.adjustment());
            String unrealizedStr = plain(unrealized);
            String grossStr = plain(a.gross());
            String economicStr = plain(economic);
            String feesStr = plain(a.fees());
            String turnoverStr = plain(a.turnover());

            result.add(new SymbolPerformanceItem(
                    a.id(),
                    a.symbol(),
                    a.quoteAsset(),
                    a.fillCount(),
                    turnoverStr,
                    turnoverStr,
                    plain(sharePct),
                    grossStr,
                    grossStr,
                    economicStr,
                    economicStr,
                    feesStr,
                    feesStr,
                    plain(a.adjustment()),
                    plain(cash),
                    unrealizedStr,
                    unrealizedStr,
                    exposure.isEmpty() ? "NO_OPEN_EXPOSURE" : (snapshot == null ? "MISSING" : snapshot.status().name())));
        }
        return List.copyOf(result);
    }

    private ClosedTradeSummary computeClosedTradeSummary(long accountId, Long roundId) {
        String roundFilter = roundId == null ? "" : " AND round_id = ?";
        Object[] args = roundId == null ? new Object[]{accountId} : new Object[]{accountId, roundId};
        var row = jdbc.queryForMap("""
                SELECT
                    COUNT(*) AS closed_count,
                    COUNT(*) FILTER (WHERE realized_pnl > 0) AS win_count,
                    COUNT(*) FILTER (WHERE realized_pnl < 0) AS loss_count
                FROM trading.position
                WHERE account_id = ?
                  AND status IN ('CLOSED', 'LIQUIDATED')
                  AND (close_reason IS NULL OR close_reason NOT IN ('MEMBER_RESTART', 'MEMBER_WITHDRAWAL'))
                """ + roundFilter, args);
        long closedCount = ((Number) row.get("closed_count")).longValue();
        long winCount = ((Number) row.get("win_count")).longValue();
        long lossCount = ((Number) row.get("loss_count")).longValue();
        String winRatePct = closedCount > 0
                ? plain(BigDecimal.valueOf(winCount).multiply(HUNDRED).divide(BigDecimal.valueOf(closedCount), 2, RoundingMode.HALF_EVEN))
                : "0";
        return new ClosedTradeSummary(closedCount, winCount, lossCount, winRatePct);
    }

    private static String plain(BigDecimal value) {
        return value == null ? null : value.stripTrailingZeros().toPlainString();
    }
}
