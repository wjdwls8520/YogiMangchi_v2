package com.yogimangchi.trading.portfolio;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Read-only public member portfolio snapshot for the member's current active round.")
public record PublicMemberPortfolioResponse(
        Long memberId,
        boolean accountExists,
        Long roundId,
        int roundNumber,
        String initialSeed,
        WalletSnapshot wallet,
        AllocationSnapshot allocation,
        List<PublicPositionItem> positions,
        List<SymbolPerformanceItem> symbolPerformances,
        ClosedTradeSummary closedTradeSummary) {

    public record WalletSnapshot(
            String balance,
            String availableBalance,
            String usedMargin,
            String reservedMargin,
            String totalEquity,
            String unrealizedPnl,
            String realizedPnl,
            String totalPnl,
            String totalRoiPct,
            boolean priceFresh) { }

    public record AllocationSnapshot(
            String usedMarginRatioPct,
            String availableCashRatioPct,
            String longMarginUsdt,
            String shortMarginUsdt,
            String longRatioPct,
            String shortRatioPct,
            int longPositionCount,
            int shortPositionCount) { }

    public record PublicPositionItem(
            Long id,
            String symbol,
            Long tradingSymbolId,
            String side,
            int leverage,
            String quantity,
            String entryPrice,
            String markPrice,
            String liquidationPrice,
            String margin,
            String unrealizedPnl,
            String roePct,
            String marginRatioPct) { }

    public record SymbolPerformanceItem(
            Long tradingSymbolId,
            String symbol,
            String quoteAsset,
            long fillCount,
            String executedNotional,
            String turnover,
            String turnoverSharePercent,
            String realizedPnl,
            String grossRealizedPnl,
            String economicPnl,
            String economicTradingPnl,
            String feesPaid,
            String fees,
            String settlementAdjustment,
            String cashTradingPnl,
            String unrealizedPnl,
            String currentUnrealizedPnl,
            String valuationStatus) { }

    public record ClosedTradeSummary(
            long closedPositionCount,
            long winCount,
            long lossCount,
            String winRatePct) { }

    public static PublicMemberPortfolioResponse empty(Long memberId) {
        return new PublicMemberPortfolioResponse(
                memberId,
                false,
                null,
                0,
                "10000",
                new WalletSnapshot("0", "0", "0", "0", "0", "0", "0", "0", "0", true),
                new AllocationSnapshot("0", "0", "0", "0", "0", "0", 0, 0),
                List.of(),
                List.of(),
                new ClosedTradeSummary(0L, 0L, 0L, "0"));
    }
}
