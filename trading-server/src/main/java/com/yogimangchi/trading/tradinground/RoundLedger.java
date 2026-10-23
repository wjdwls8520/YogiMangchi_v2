package com.yogimangchi.trading.tradinground;
import java.time.Instant;
import java.util.List;
import io.swagger.v3.oas.annotations.media.Schema;
/** Read-only round projections; values preserve the original ledger, not live repricing. */
public final class RoundLedger {
    private RoundLedger() { }
    public record Page<T>(List<T> content,Long nextCursorId) { }
    public record Order(Long id,Long roundId,Long positionId,Long tradingSymbolId,String type,String action,String side,String status,String quantity,String filledPrice,String limitPrice,int leverage,Instant createdAt,Instant completedAt,String reason) { }
    public record Fill(Long id,Long roundId,Long orderId,String price,String quantity,String realizedPnl,String fee,String settlementAdjustment,Instant executedAt) { }
    public record Position(Long id,Long roundId,Long tradingSymbolId,String side,String status,String quantity,String initialQuantity,String entryPrice,@Schema(description="Null for administrative closure: no synthetic exit price") String exitPrice,String realizedPnl,String margin,int leverage,Instant openedAt,Instant closedAt,@Schema(description="MEMBER_RESTART/MEMBER_WITHDRAWAL distinguish administrative endings from real executed closes") String closeReason,String retiredQuantity,String retiredEntryNotional,String retiredMargin) { }
}
