package com.yogimangchi.trading.commandresult;

import com.yogimangchi.trading.tradingaccount.security.TradingPrincipal;
import com.yogimangchi.trading.order.dto.OrderResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value="/api/v1/trading/account",produces="application/json")
@SecurityRequirement(name="guestBearer") @SecurityRequirement(name="memberBearer")
public class CommandResultController {
    private final CommandResultQueryService queries;
    public CommandResultController(CommandResultQueryService queries){this.queries=queries;}
    @PostMapping("/command-results/query")
    @Operation(summary="Read an owned command result without retrying financial execution",description="No ingress/risk gate and no financial write. Original operation/key/request must match the server fingerprint. FOUND order uses current committed OrderResponse; SL/restart/retry use their original durable responses. NOT_OBSERVED is inconclusive, including while the original request may still be in flight. Never automatically allocate a new key. Auth/ownership and withdrawal policy apply; BANKRUPT can read retained history. 400 invalid shape/key, 401 credential, 403 wrong account type, 409 hash/operation conflict within the existing key namespace or withdrawn account. Order, SL, restart and retry retain their separate namespaces; a key found only in another family does not establish this operation's result. Existing financial records/keys have no separate automatic expiry.")
    public ResponseEntity<CommandResultResponse> query(@AuthenticationPrincipal TradingPrincipal principal,@RequestBody CommandResultRequest request){
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(queries.query(principal.accountId(),request));
    }
    @GetMapping("/orders/{orderId:[0-9]+}")
    @Operation(summary="Read an owned committed order, including cancellation result",description="Read-only OrderResponse at one consistent committed snapshot. No ingress/risk gate, execution or new key. Use known orderId for keyless cancellation recovery; PENDING is not proof that an in-flight cancellation cannot later commit. 401 credential, 404 unknown/other owner, 409 withdrawn account. No financial data is created.")
    public ResponseEntity<OrderResponse> order(@AuthenticationPrincipal TradingPrincipal principal,@PathVariable Long orderId){
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(queries.order(principal.accountId(),orderId));
    }
}
