package com.yogimangchi.trading.tradingaccount.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description="Own member Futures account; initial balance is0 USDT (V1 real Futures allocation), distinct from Guest10000. Repeated opening does not reset or credit the wallet. Guest history is never merged.")
public record MemberAccountResponse(Long accountId,Long memberId,String status,String quoteAsset,String balance) { }
