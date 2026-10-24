package com.yogimangchi.trading.performance;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;

@Schema(description="Full selected Fill range, never a page of history. Decimal values are strings. LONG/SHORT combined per symbol. No symbol return percentage: collateral reuse and leverage changes do not define a sound denominator.")
public record SymbolPerformanceResponse(Scope scope, Totals totals, List<Symbol> symbols,
        @Schema(description="Account-level restart funding in this range; never attributed to a symbol or counted as trading profit") String capitalAdjustment,
        @Schema(description="Available only for an unfiltered whole member round with verified initial capital") RoundReturn roundReturn,
        Instant capturedAt) {
    public record Scope(Instant fromInclusive,Instant beforeExclusive,Long roundId,Long tradingSymbolId,
            String turnoverDefinition,String unrealizedScope) { }
    public record Totals(long fillCount,String turnover,String grossRealizedPnl,String fees,
            String settlementAdjustment,String economicTradingPnl,String cashTradingPnl) { }
    public record Symbol(Long tradingSymbolId,String symbol,String quoteAsset,long fillCount,String turnover,
            @Schema(description="Percent of turnover in this entire selected range; zero if total turnover is zero") String turnoverSharePercent,
            String grossRealizedPnl,String fees,String settlementAdjustment,String economicTradingPnl,String cashTradingPnl,
            @Schema(description="Current OPEN exposure only, independent of the historical period. Null unless all this symbol's position marks are FRESH") String currentUnrealizedPnl,
            String valuationStatus,Instant priceEventTime,Instant priceReceivedAt,Instant valuedAt) { }
    public record RoundReturn(String status,String initialCapital,String capitalAdjustment,String cashPerformance,
            @Schema(description="100*(ending equity-initial capital-capital adjustments)/initial capital, for the whole verified round. No average ROE.") String returnPercent,
            Instant valuedAt) { }
}
