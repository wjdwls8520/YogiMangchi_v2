package com.yogimangchi.trading.tradinground;

import com.yogimangchi.trading.error.*;
import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping(value="/api/v1/trading/account",produces="application/json")
@SecurityRequirement(name="memberBearer")
public class MemberRoundController {
    private final MemberRounds rounds;
    public MemberRoundController(MemberRounds rounds){this.rounds=rounds;}
    @PostMapping("/restart")
    @Operation(summary="Restart own member simulation",description="Member JWT and Idempotency-Key8-100 required. AccountLock serializes trading/restart/withdrawal. Administrative closure creates no Fill/PnL/fee. New round10000USDT; Guest403. Same successful key returns original result; different key within24h429 with nextAvailableAt. No body balances/memberId/roundId trusted. Atomic rollback; account contention409.")
    public ResponseEntity<MemberRounds.Restart> restart(@AuthenticationPrincipal TradingPrincipal p,@RequestHeader(value="Idempotency-Key",required=false) String key){return ok(rounds.restart(account(p),key));}
    @GetMapping("/rounds/current")
    @Operation(summary="Own current round and restart availability",description="Current account valuation uses server prices/freshness; lifetime Wallet totals are separate from round realizedPnl/feesPaid/settlementAdjustment deltas. Legacy initialBalance is null, never inferred from balance.")
    public ResponseEntity<MemberRounds.Summary> current(@AuthenticationPrincipal TradingPrincipal p){return ok(rounds.current(account(p)));}
    @GetMapping("/rounds")
    @Operation(summary="Own rounds newest first",description="cursorId is exclusive round ID; limit1-100(default20). nextCursorId null ends pagination. No other member access.")
    public ResponseEntity<MemberRounds.Page> list(@AuthenticationPrincipal TradingPrincipal p,@RequestParam(required=false) Long cursorId,@RequestParam(defaultValue="20") int limit){return ok(rounds.list(account(p),cursorId,limit));}
    @GetMapping("/rounds/{roundId:[0-9]+}")
    @Operation(summary="Own round summary",description="Completed rounds use immutable persisted finalWallet snapshots, never current prices. Administrative closure and capital resets are not realized trading returns. Wrong owner/missing404; withdrawn cannot authenticate.")
    public ResponseEntity<MemberRounds.Summary> summary(@AuthenticationPrincipal TradingPrincipal p,@PathVariable Long roundId){return ok(rounds.summary(account(p),roundId));}
    @GetMapping("/rounds/{roundId:[0-9]+}/orders")
    @Operation(summary="Own round order ledger",description="cursorId exclusive item ID,limit1-100(default20),nextCursorId. Decimal strings, ISO timestamps. Includes canceled administrative orders. Read-only: existing order APIs always use current round; unknown owner404.")
    public ResponseEntity<RoundLedger.Page<RoundLedger.Order>> orders(@AuthenticationPrincipal TradingPrincipal p,@PathVariable Long roundId,@RequestParam(required=false) Long cursorId,@RequestParam(defaultValue="20") int limit){return ok(rounds.orders(account(p),roundId,cursorId,limit));}
    @GetMapping("/rounds/{roundId:[0-9]+}/fills")
    @Operation(summary="Own round immutable Fill ledger",description="cursorId exclusive item ID,limit1-100(default20). Reset does not create synthetic fills; previous executed prices/PnL/fees remain unchanged. Wrong owner404.")
    public ResponseEntity<RoundLedger.Page<RoundLedger.Fill>> fills(@AuthenticationPrincipal TradingPrincipal p,@PathVariable Long roundId,@RequestParam(required=false) Long cursorId,@RequestParam(defaultValue="20") int limit){return ok(rounds.fills(account(p),roundId,cursorId,limit));}
    @GetMapping("/rounds/{roundId:[0-9]+}/positions")
    @Operation(summary="Own round position lifecycles",description="cursorId exclusive item ID,limit1-100(default20). Includes administrative CLOSED positions: closeReason MEMBER_RESTART/MEMBER_WITHDRAWAL, null exitPrice and no new Fill/PnL/fee. Historical values are not repriced. Wrong owner404.")
    public ResponseEntity<RoundLedger.Page<RoundLedger.Position>> positions(@AuthenticationPrincipal TradingPrincipal p,@PathVariable Long roundId,@RequestParam(required=false) Long cursorId,@RequestParam(defaultValue="20") int limit){return ok(rounds.positions(account(p),roundId,cursorId,limit));}
    private static Long account(TradingPrincipal p){if(p.memberId()==null)throw new BusinessException(ErrorCode.MEMBER_ACCOUNT_REQUIRED);if(p.accountId()==null)throw new BusinessException(ErrorCode.TRADING_ACCOUNT_REQUIRED);return p.accountId();}
    private static <T> ResponseEntity<T> ok(T data){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(data);}
}
